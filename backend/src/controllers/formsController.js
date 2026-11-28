"use strict";

const { z } = require("zod");
const { formBody, formPatchBody } = require("../validate");
const { responseQuerySchema } = require("../responseQuery");
const formsService = require("../services/formsService");

const notFound = res => res.status(404).json({ error: "Form not found" });

async function list(_req, res) {
    res.json(await formsService.listForms(res.locals.userId));
}

async function activity(_req, res) {
    res.json(await formsService.listActivity(res.locals.userId));
}

async function create(req, res) {
    const body = formBody.parse(req.body);
    const form = await formsService.createForm(res.locals.userId, body);
    res.status(201).json(form);
}

async function get(req, res) {
    const form = await formsService.getForm(req.params.id, res.locals.userId);
    if (!form)
        return notFound(res);
    res.json(form);
}

async function downloadFile(req, res, next) {
    const result = await formsService.getFormFile(req.params.id, req.params.fileId, res.locals.userId);
    if (result === undefined)
        return notFound(res);
    if (!result) {
        res.status(404).json({ error: "File not found" });
        return;
    }
    res.download(result.filePath, result.file.originalName, error => {
        if (error)
            next(error);
    });
}

async function patch(req, res) {
    const body = formPatchBody.parse(req.body);
    const form = await formsService.patchForm(req.params.id, res.locals.userId, body);
    if (!form)
        return notFound(res);
    res.json(form);
}

async function setStatus(req, res) {
    const { status } = z.object({ status: z.enum(["draft", "published"]) }).parse(req.body);
    const result = await formsService.setFormStatus(req.params.id, res.locals.userId, status);
    if (!result.form)
        return notFound(res);
    if (result.error) {
        res.status(400).json({ error: result.error });
        return;
    }
    res.json(result.form);
}

async function duplicate(req, res) {
    const form = await formsService.duplicateForm(req.params.id, res.locals.userId);
    if (!form)
        return notFound(res);
    res.status(201).json(form);
}

async function remove(req, res) {
    if (!await formsService.deleteForm(req.params.id, res.locals.userId))
        return notFound(res);
    res.status(204).end();
}

async function listResponses(req, res) {
    if (Object.keys(req.query).length === 0) {
        const responses = await formsService.listAllResponses(req.params.id, res.locals.userId);
        if (!responses)
            return notFound(res);
        res.json(responses);
        return;
    }
    const query = responseQuerySchema.parse(req.query);
    const responses = await formsService.listResponses(req.params.id, res.locals.userId, query);
    if (!responses)
        return notFound(res);
    if (responses.invalidField) {
        res.status(400).json({ error: responses.invalidField });
        return;
    }
    res.json(responses);
}

async function exportResponses(req, res) {
    const query = responseQuerySchema.parse(req.query);
    const result = await formsService.streamResponseExport(req.params.id, res.locals.userId, query, res);
    if (result === null)
        return notFound(res);
    if (result?.invalidField)
        res.status(400).json({ error: result.invalidField });
}

async function deleteResponse(req, res) {
    const deleted = await formsService.deleteResponse(req.params.id, req.params.rid, res.locals.userId);
    if (deleted === null)
        return notFound(res);
    if (!deleted) {
        res.status(404).json({ error: "Response not found" });
        return;
    }
    res.status(204).end();
}

async function updateResponseStatus(req, res) {
    const { status } = z.object({ status: z.enum(["read", "unread"]) }).parse(req.body);
    const response = await formsService.updateResponseStatus(req.params.id, req.params.rid, res.locals.userId, status);
    if (response === null)
        return notFound(res);
    if (!response) {
        res.status(404).json({ error: "Response not found" });
        return;
    }
    res.json(response);
}

async function deleteResponses(req, res) {
    const { responseIds } = z.object({
        responseIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1).max(500)
            .refine(ids => new Set(ids).size === ids.length, "Response IDs must be unique"),
    }).parse(req.body);
    const result = await formsService.deleteResponses(req.params.id, responseIds, res.locals.userId);
    if (!result)
        return notFound(res);
    res.json(result);
}

module.exports = {
    activity, create, deleteResponse, deleteResponses, downloadFile, duplicate, exportResponses,
    get, list, listResponses, patch, remove, setStatus, updateResponseStatus,
};
