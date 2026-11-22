"use strict";

const { z } = require("zod");
const { formBody, formPatchBody } = require("../validate");
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
    const responses = await formsService.listResponses(req.params.id, res.locals.userId);
    if (!responses)
        return notFound(res);
    res.json(responses);
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

module.exports = { activity, create, deleteResponse, downloadFile, duplicate, get, list, listResponses, patch, remove, setStatus };
