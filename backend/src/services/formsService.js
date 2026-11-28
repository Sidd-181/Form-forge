"use strict";

const mongoose = require("mongoose");
const path = require("node:path");
const { once } = require("node:events");
const { Form, FormResponse, FormUpload, GoogleSheetsIntegration } = require("../models");
const { deleteFormUploads, deleteUnreferencedUploadsForForm } = require("../uploadCleanup");
const { answerValue, buildResponseFilter, buildResponseSort, csvCell, validateResponseFields, xmlText } = require("../responseQuery");

const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "uploads");

function normalizeFormData(body) {
    const content = { ...body };
    let steps = Array.isArray(body.steps) ? body.steps.map(step => ({
        id: step.id,
        title: step.title ?? '',
        description: step.description ?? '',
        showIf: step.showIf ?? null,
    })) : [];
    if (!steps.length) {
        steps = [{ id: 'step_1', title: 'Step 1', description: '', showIf: null }];
    }
    const known = new Set(steps.map(step => step.id));
    const fields = (body.fields ?? []).map(field => ({
        ...field,
        stepId: field.stepId && known.has(field.stepId) ? field.stepId : steps[0].id,
        showIf: field.showIf ?? null,
    }));
    content.steps = steps;
    content.fields = fields;
    return content;
}

async function listForms(ownerId) {
    const forms = await Form.find({ owner: ownerId }).sort({ updatedAt: -1 });
    if (!forms.length)
        return [];
    const counts = await FormResponse.aggregate([
        { $match: { form: { $in: forms.map(form => form._id) } } },
        { $group: { _id: "$form", count: { $sum: 1 } } },
    ]);
    const countsById = new Map(counts.map(item => [String(item._id), item.count]));
    return forms.map(form => ({ ...form.toJSON(), responseCount: countsById.get(String(form._id)) ?? 0 }));
}

async function listActivity(ownerId) {
    const forms = await Form.find({ owner: ownerId }).select("_id").lean();
    if (!forms.length)
        return [];
    return FormResponse.find({ form: { $in: forms.map(form => form._id) } })
        .sort({ createdAt: -1 })
        .limit(20);
}

function findOwnedForm(formId, ownerId) {
    return mongoose.isValidObjectId(formId)
        ? Form.findOne({ _id: formId, owner: ownerId })
        : null;
}

async function createForm(ownerId, body) {
    const normalized = normalizeFormData(body);
    return Form.create({
        ...normalized,
        expiresAt: normalized.expiresAt ? new Date(normalized.expiresAt) : null,
        owner: ownerId,
    });
}

async function getForm(formId, ownerId) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return null;
    const responseCount = await FormResponse.countDocuments({ form: form._id });
    return { ...form.toJSON(), responseCount };
}

async function getFormFile(formId, fileId, ownerId) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return undefined;
    const file = await FormUpload.findOne({ form: form._id, fileId });
    if (!file)
        return null;
    if (path.basename(file.storageName) !== file.storageName)
        throw new Error("Invalid upload storage name");
    return { file, filePath: path.join(uploadDir, file.storageName) };
}

async function patchForm(formId, ownerId, body) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return null;
    const { expiresAt, ...content } = body;
    const hasStructure = content.fields !== undefined || content.steps !== undefined;
    if (hasStructure) {
        const current = form.toObject();
        form.set(normalizeFormData({
            ...current,
            ...content,
            fields: content.fields ?? current.fields,
            steps: content.steps ?? current.steps,
        }));
    }
    else {
        form.set(content);
    }
    if (expiresAt !== undefined)
        form.expiresAt = expiresAt ? new Date(expiresAt) : null;
    await form.save();
    return form;
}

async function setFormStatus(formId, ownerId, status) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return { form: null };
    if (status === "published" && form.fields.length === 0)
        return { form, error: "Add at least one field before publishing" };
    if (status === "published") {
        const normalized = normalizeFormData(form.toObject());
        if (normalized.steps.some(step => !normalized.fields.some(field => field.stepId === step.id)))
            return { form, error: "Every step must contain at least one question" };
    }
    form.status = status;
    await form.save();
    return { form };
}

async function duplicateForm(formId, ownerId) {
    const source = await findOwnedForm(formId, ownerId);
    if (!source)
        return null;
    return Form.create({
        owner: source.owner,
        title: `${source.title} (copy)`,
        description: source.description,
        accent: source.accent,
        fields: source.toObject().fields,
        steps: source.toObject().steps?.length ? source.toObject().steps : [{ id: 'step_1', title: 'Step 1', description: '', showIf: null }],
        submissionLimit: source.submissionLimit,
        expiresAt: source.expiresAt,
        status: "draft",
    });
}

async function deleteForm(formId, ownerId) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return false;
    form.status = "draft";
    await form.save();
    await deleteFormUploads([form._id]);
    await FormResponse.deleteMany({ form: form._id });
    await GoogleSheetsIntegration.deleteOne({ form: form._id, owner: ownerId });
    await form.deleteOne();
    return true;
}

function responseFields(form) {
    return form.fields.map(field => typeof field.toObject === "function" ? field.toObject() : { ...field });
}

function responseRecord(response) {
    return {
        id: String(response._id),
        submittedAt: response.createdAt,
        status: response.status ?? "unread",
        answers: response.answers ?? {},
        fieldSnapshots: response.fieldSnapshots ?? [],
        completionSeconds: response.completionSeconds ?? null,
    };
}

async function listResponses(formId, ownerId, query) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return null;
    const fields = responseFields(form);
    const invalidField = validateResponseFields(query, fields);
    if (invalidField)
        return { invalidField };

    const filter = buildResponseFilter(form._id, query, fields);
    const [total, filteredTotal, responses] = await Promise.all([
        FormResponse.countDocuments({ form: form._id }),
        FormResponse.countDocuments(filter),
        FormResponse.find(filter)
            .select("answers fieldSnapshots completionSeconds status createdAt")
            .sort(buildResponseSort(query, fields))
            .skip((query.page - 1) * query.pageSize)
            .limit(query.pageSize)
            .lean(),
    ]);
    return { items: responses.map(responseRecord), total, filteredTotal, page: query.page, pageSize: query.pageSize };
}

async function listAllResponses(formId, ownerId) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return null;
    const responses = await FormResponse.find({ form: form._id })
        .select("answers fieldSnapshots completionSeconds status createdAt")
        .sort({ createdAt: -1 })
        .lean();
    return responses.map(responseRecord);
}

async function updateResponseStatus(formId, responseId, ownerId, status) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return null;
    if (!mongoose.isValidObjectId(responseId))
        return false;
    const response = await FormResponse.findOneAndUpdate(
        { _id: responseId, form: form._id },
        { $set: { status } },
        { returnDocument: "after" },
    ).select("answers fieldSnapshots completionSeconds status createdAt").lean();
    return response ? responseRecord(response) : false;
}

async function deleteResponses(formId, responseIds, ownerId) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return null;
    const ids = responseIds.filter(id => mongoose.isValidObjectId(id));
    if (!ids.length)
        return { deletedCount: 0 };
    const { deletedCount } = await FormResponse.deleteMany({ _id: { $in: ids }, form: form._id });
    if (deletedCount) {
        await Form.updateOne(
            { _id: form._id, submissionCount: { $gte: deletedCount } },
            { $inc: { submissionCount: -deletedCount } },
        );
        try {
            await deleteUnreferencedUploadsForForm(form._id);
        }
        catch (error) {
            console.error("Could not clean unused form uploads after bulk response deletion:", error);
        }
    }
    return { deletedCount };
}

async function streamResponseExport(formId, ownerId, query, res) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return null;
    const fields = responseFields(form);
    const invalidField = validateResponseFields(query, fields);
    if (invalidField)
        return { invalidField };

    const fileBase = (form.title || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "form";
    const excel = query.format === "excel";
    const filename = `${fileBase}-responses.${excel ? "xls" : "csv"}`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", excel ? "application/vnd.ms-excel; charset=utf-8" : "text/csv; charset=utf-8");

    const columns = ["Submitted at", ...fields.map(field => field.label || "Untitled question"), "Completion time (s)", "Status"];
    const write = async chunk => {
        if (!res.write(chunk))
            await once(res, "drain");
    };
    const csvRow = values => `${values.map(csvCell).join(",")}\r\n`;
    const excelRow = values => `<Row>${values.map(value => `<Cell><Data ss:Type="String">${xmlText(value)}</Data></Cell>`).join("")}</Row>`;

    if (excel) {
        await write('<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Responses"><Table>');
        await write(excelRow(columns));
    }
    else {
        await write("\uFEFF");
        await write(csvRow(columns));
    }

    const cursor = FormResponse.find(buildResponseFilter(form._id, query, fields))
        .select("answers completionSeconds status createdAt")
        .sort(buildResponseSort(query, fields))
        .lean()
        .cursor({ batchSize: 500 });
    for await (const response of cursor) {
        const values = [
            response.createdAt?.toISOString?.() ?? "",
            ...fields.map(field => answerValue(response.answers?.[field.id])),
            response.completionSeconds ?? "",
            response.status ?? "unread",
        ];
        await write(excel ? excelRow(values) : csvRow(values));
    }
    if (excel)
        await write("</Table></Worksheet></Workbook>");
    res.end();
    return true;
}

async function deleteResponse(formId, responseId, ownerId) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return null;
    if (!mongoose.isValidObjectId(responseId))
        return false;
    const { deletedCount } = await FormResponse.deleteOne({ _id: responseId, form: form._id });
    if (!deletedCount)
        return false;
    await Form.updateOne({ _id: form._id, submissionCount: { $gt: 0 } }, { $inc: { submissionCount: -1 } });
    try {
        await deleteUnreferencedUploadsForForm(form._id);
    }
    catch (error) {
        console.error("Could not clean unused form uploads after response deletion:", error);
    }
    return true;
}

module.exports = {
    createForm,
    deleteForm,
    deleteResponse,
    duplicateForm,
    getForm,
    getFormFile,
    listActivity,
    listAllResponses,
    listForms,
    listResponses,
    patchForm,
    setFormStatus,
    deleteResponses,
    streamResponseExport,
    updateResponseStatus,
};
