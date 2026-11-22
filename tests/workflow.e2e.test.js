import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
require("dotenv/config");
let mongoose;
let User;
let Form;
let FormResponse;
let FormUpload;
let connectToDatabase;
let deleteFormUploads;
let formsService;
let server;
let owner;
let form;
let uploadDir;
let baseUrl;
let uploadedFileId;

before(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), "formforge-e2e-"));
  process.env.UPLOAD_DIR = uploadDir;

  mongoose = require("mongoose");
  ({ User, Form, FormResponse, FormUpload } = require("./src/models.js"));
  ({ connectToDatabase } = require("./src/database.js"));
  ({ deleteFormUploads } = require("./src/uploadCleanup.js"));
  formsService = require("./src/services/formsService.js");
  await connectToDatabase();

  owner = await User.create({
    name: "E2E Test",
    email: `formforge-e2e-${randomUUID()}@example.test`,
  });
  form = await Form.create({
    owner: owner._id,
    title: "E2E upload workflow",
    status: "published",
    submissionLimit: 1,
    accent: "#4f46e5",
    fields: [
      { id: "name", type: "short_text", label: "Name", required: true },
      { id: "attachment", type: "file", label: "Attachment", required: true },
    ],
  });

  const app = require("./src/app.js");
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}/api/public/forms/${form.id}`;
});

after(async () => {
  if (server)
    await new Promise(resolve => server.close(resolve));
  if (form) {
    await FormResponse.deleteMany({ form: form._id });
    await deleteFormUploads([form._id]);
    await Form.deleteOne({ _id: form._id });
  }
  if (owner)
    await User.deleteOne({ _id: owner._id });
  if (mongoose?.connection.readyState)
    await mongoose.disconnect();
  if (uploadDir)
    await rm(uploadDir, { recursive: true, force: true });
});

test("public form validates, uploads, persists a response, and enforces its limit", async () => {
  const publicForm = await fetch(baseUrl);
  assert.equal(publicForm.status, 200);
  assert.equal((await publicForm.json()).title, form.title);

  const invalid = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: {} }),
  });
  assert.equal(invalid.status, 422);

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const uploadBody = new FormData();
  uploadBody.append("file", new Blob([png], { type: "image/png" }), "tiny.png");
  const uploaded = await fetch(`${baseUrl}/uploads/attachment`, { method: "POST", body: uploadBody });
  assert.equal(uploaded.status, 201);
  const upload = await uploaded.json();
  uploadedFileId = upload.fileId;

  const submitted = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      answers: { name: "Ada", attachment: { fileId: upload.fileId } },
      completionSeconds: 12,
    }),
  });
  assert.equal(submitted.status, 201);

  const response = await FormResponse.findOne({ form: form._id });
  assert.equal(response.answers.name, "Ada");
  assert.equal(response.answers.attachment.fileId, upload.fileId);
  assert.equal(await FormUpload.countDocuments({ form: form._id }), 1);
  assert.equal((await readdir(uploadDir)).length, 1);

  const closed = await fetch(baseUrl);
  assert.equal(closed.status, 410);
});

test("private form routes require authentication", async () => {
  const response = await fetch(`${new URL(baseUrl).origin}/api/forms`);
  assert.equal(response.status, 401);
});

test("form services enforce ownership and clean up records on deletion", async () => {
  const [listed] = await formsService.listForms(owner._id);
  assert.equal(listed.id, form.id);
  assert.equal(listed.responseCount, 1);
  assert.equal(await formsService.getForm(form.id, new mongoose.Types.ObjectId()), null);

  const file = await formsService.getFormFile(form.id, uploadedFileId, owner._id);
  assert.ok(file);
  assert.equal(path.basename(file.filePath), file.file.storageName);

  const copy = await formsService.duplicateForm(form.id, owner._id);
  assert.equal(copy.status, "draft");
  assert.equal(await formsService.deleteForm(copy.id, owner._id), true);

  const response = await FormResponse.findOne({ form: form._id });
  assert.equal(await formsService.deleteResponse(form.id, String(response._id), owner._id), true);
  assert.equal(await FormUpload.countDocuments({ form: form._id }), 0);
  assert.equal(await formsService.deleteForm(form.id, owner._id), true);
  assert.equal(await formsService.getForm(form.id, owner._id), null);
});
