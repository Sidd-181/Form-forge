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
let outsider;
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
  outsider = await User.create({
    name: "E2E Outsider",
    email: `formforge-e2e-outsider-${randomUUID()}@example.test`,
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
  if (outsider)
    await User.deleteOne({ _id: outsider._id });
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
  const origin = new URL(baseUrl).origin;
  const response = await fetch(`${origin}/api/forms`);
  assert.equal(response.status, 401);
  const privateResponses = await fetch(`${origin}/api/forms/${form.id}/responses`);
  assert.equal(privateResponses.status, 401);
});

test("response management paginates, filters, sorts, exports and enforces ownership", async () => {
  const { responseQuerySchema } = require("./src/responseQuery.js");
  const { answerValue } = require("./src/responseQuery.js");
  const snapshots = form.fields.map(field => typeof field.toObject === "function" ? field.toObject() : { ...field });
  const extras = await FormResponse.create(Array.from({ length: 11 }, (_, index) => ({
    form: form._id,
    answers: { name: `Test ${String(index + 1).padStart(2, "0")}` },
    fieldSnapshots: snapshots,
    createdAt: new Date("2026-04-02T12:00:00.000Z"),
  })));

  const query = responseQuerySchema.parse({ page: "1", pageSize: "10", sortBy: "submittedAt", sortOrder: "asc" });
  const firstPage = await formsService.listResponses(form.id, owner._id, query);
  const secondPage = await formsService.listResponses(form.id, owner._id, { ...query, page: 2 });
  assert.equal(firstPage.total, 12);
  assert.equal(firstPage.items.length, 10);
  assert.equal(secondPage.items.length, 2);

  const filtered = await formsService.listResponses(form.id, owner._id, responseQuerySchema.parse({
    questionId: "name", answer: "Test 07", status: "unread", sortBy: "name", sortOrder: "asc",
  }));
  assert.equal(filtered.filteredTotal, 1);
  assert.equal(filtered.items[0].answers.name, "Test 07");
  const date = extras[0].createdAt.toISOString().slice(0, 10);
  const dateFiltered = await formsService.listResponses(form.id, owner._id, responseQuerySchema.parse({ from: date, to: date }));
  assert.equal(dateFiltered.filteredTotal, 11);

  const sorted = await formsService.listResponses(form.id, owner._id, responseQuerySchema.parse({ sortBy: "name", sortOrder: "asc" }));
  assert.equal(sorted.items[0].answers.name, "Ada");
  const marked = await formsService.updateResponseStatus(form.id, sorted.items[0].id, owner._id, "read");
  assert.equal(marked.status, "read");
  const readOnly = await formsService.listResponses(form.id, owner._id, responseQuerySchema.parse({ status: "read" }));
  assert.equal(readOnly.filteredTotal, 1);

  const exportResponse = () => ({
    headers: {},
    chunks: [],
    setHeader(name, value) { this.headers[name] = value; },
    write(chunk) { this.chunks.push(String(chunk)); return true; },
    end() { this.ended = true; },
  });
  const csv = exportResponse();
  await formsService.streamResponseExport(form.id, owner._id, responseQuerySchema.parse({ questionId: "name", answer: "Ada" }), csv);
  assert.match(csv.headers["Content-Type"], /text\/csv/);
  assert.match(csv.chunks.join(""), /Name/);
  assert.match(csv.chunks.join(""), /Ada/);
  const excel = exportResponse();
  await formsService.streamResponseExport(form.id, owner._id, responseQuerySchema.parse({ questionId: "name", answer: "Ada", format: "excel" }), excel);
  assert.match(excel.headers["Content-Type"], /application\/vnd\.ms-excel/);
  assert.match(excel.chunks.join(""), /<Workbook/);
  assert.equal(answerValue(["Ada", "Grace"]), "Ada, Grace");

  assert.equal(await formsService.listResponses(form.id, outsider._id, query), null);
  assert.equal(await formsService.updateResponseStatus(form.id, marked.id, outsider._id, "unread"), null);
  assert.equal(await formsService.deleteResponses(form.id, extras.map(response => String(response._id)), outsider._id), null);
  assert.equal((await formsService.deleteResponses(form.id, extras.map(response => String(response._id)), owner._id)).deletedCount, 11);
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
