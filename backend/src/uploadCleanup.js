"use strict";

const { unlink } = require("node:fs/promises");
const path = require("node:path");
const { FormUpload, FormResponse } = require("./models");

const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "uploads");

function uploadPath(storageName, directory) {
    if (typeof storageName !== "string" || path.basename(storageName) !== storageName)
        throw new Error("Invalid upload storage name");
    return path.join(directory, storageName);
}

async function removeStoredUploads(uploads, directory = uploadDir) {
    for (const upload of uploads) {
        try {
            await unlink(uploadPath(upload.storageName, directory));
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
}

async function deleteFormUploads(formIds) {
    if (!formIds.length)
        return;
    const uploads = await FormUpload.find({ form: { $in: formIds } }).select("_id storageName").lean();
    await removeStoredUploads(uploads);
    if (uploads.length)
        await FormUpload.deleteMany({ _id: { $in: uploads.map(upload => upload._id) } });
}

async function deleteUnreferencedUploadsForForm(formId) {
    const references = await FormResponse.aggregate([
        { $match: { form: formId } },
        { $project: { answers: { $objectToArray: { $ifNull: ["$answers", {}] } } } },
        { $unwind: "$answers" },
        { $match: { "answers.v.fileId": { $type: "string" } } },
        { $group: { _id: "$answers.v.fileId" } },
    ]);
    const referencedFileIds = new Set(references.map(reference => reference._id));
    const uploads = await FormUpload.find({ form: formId }).select("_id fileId storageName").lean();
    const unused = uploads.filter(upload => !referencedFileIds.has(upload.fileId));
    if (!unused.length)
        return;
    await removeStoredUploads(unused);
    await FormUpload.deleteMany({ _id: { $in: unused.map(upload => upload._id) } });
}

module.exports = { deleteFormUploads, deleteUnreferencedUploadsForForm, removeStoredUploads };
