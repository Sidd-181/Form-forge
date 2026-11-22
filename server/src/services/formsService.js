"use strict";

const mongoose = require("mongoose");
const path = require("node:path");
const { Form, FormResponse, FormUpload } = require("../models");
const { deleteFormUploads, deleteUnreferencedUploadsForForm } = require("../uploadCleanup");

const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "uploads");

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
    return Form.create({
        ...body,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
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
    form.set(content);
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
    await form.deleteOne();
    return true;
}

async function listResponses(formId, ownerId) {
    const form = await findOwnedForm(formId, ownerId);
    if (!form)
        return null;
    return FormResponse.find({ form: form._id }).sort({ createdAt: -1 });
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
    listForms,
    listResponses,
    patchForm,
    setFormStatus,
};
