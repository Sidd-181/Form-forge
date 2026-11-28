import assert from "node:assert/strict";
import { before, test } from "node:test";
import { dirname, resolve } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const React = frontendRequire("react");
const { renderToStaticMarkup } = frontendRequire("react-dom/server");
import { ApiError, api, setAuthTokenGetter } from "../frontend/src/services/api.js";
import { firstInvalidField, validateAll, validateField, validateFieldDefinition, validateFormContent, normalizeFormSteps, visibleSteps, visibleFields, conditionMatches } from "../frontend/src/services/validation.js";
import { submissionReservationFilter } from "../backend/src/submissionLimit.js";
import { getAllowedFileType, MAX_UPLOAD_SIZE, maxFileSizeForField } from "../backend/src/uploadPolicy.js";
import { checkAnswers, fieldSchema, formBody, formPatchBody } from "../backend/src/validate.js";
import { createLatestSaveQueue } from "../frontend/src/services/saveQueue.js";
import { loadDashboard, responseDeleted, responsesDeleted, store } from "../frontend/src/store/index.js";
import { answerForResponseField, fieldsForResponse, responseFieldColumns } from "../frontend/src/services/responses.js";
import { removeStoredUploads } from "../backend/src/uploadCleanup.js";
const serverRequire = createRequire(new URL("../backend/package.json", import.meta.url));
const { Form, FormResponse } = serverRequire("./src/models.js");
const { buildResponseFilter, buildResponseSort, csvCell, responseQuerySchema, validateResponseFields, xmlText } = serverRequire("./src/responseQuery.js");
const { answerCellValue, columnName, quoteSheetTitle } = serverRequire("./src/services/googleSheets.js");
const { isTransientMongoNetworkError } = serverRequire("./src/services/googleSheetsWorker.js");
let FormRenderer;
before(async () => {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../frontend");
  const vite = await createServer({ configFile: false, root: projectRoot, plugins: [] });
  try {
    ({ default: FormRenderer } = await vite.ssrLoadModule("/src/components/FormRenderer.jsx"));
  } finally {
    await vite.close();
  }
});
test("upload cleanup is idempotent and rejects paths outside the upload directory", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "formforge-uploads-"));
  try {
    await writeFile(resolve(directory, "stored.png"), "data");
    await removeStoredUploads([{ storageName: "stored.png" }, { storageName: "already-removed.pdf" }], directory);
    await assert.rejects(readFile(resolve(directory, "stored.png")));
    await assert.rejects(removeStoredUploads([{ storageName: "..\\outside.png" }], directory), /Invalid upload storage name/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("public file upload policy checks the signature, MIME type, and size", () => {
  const MB = 1024 * 1024;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(getAllowedFileType("image/png", png, png.length)?.extension, ".png");
  assert.equal(getAllowedFileType("image/jpeg", png, png.length), null);
  assert.equal(getAllowedFileType("image/png", png, MAX_UPLOAD_SIZE + 1), null);
  assert.equal(maxFileSizeForField(1), Math.min(MAX_UPLOAD_SIZE, MB));
  assert.equal(getAllowedFileType("image/png", png, maxFileSizeForField(1) + 1, maxFileSizeForField(1)), null);
  assert.equal(getAllowedFileType("image/png", Buffer.alloc(0), 0), null);
});
test("file answers require a real-looking upload reference and frontend rejects missing files", () => {
  const fileField = fieldSchema.parse({ id: "attachment", type: "file", label: "Attachment", required: true });
  assert.equal(checkAnswers([fileField], { attachment: "report.pdf" }).errors.attachment, "Upload a valid file");
  const fileAnswer = { fileId: "16f2a0cb-e2af-4e78-8f36-06b94f14f1b1" };
  assert.deepEqual(checkAnswers([fileField], { attachment: fileAnswer }).errors, {});
  assert.equal(checkAnswers([fileField], { attachment: { fileId: "16f2a0cb-e2af-4e78-8f36-06b94f14f1b" } }).errors.attachment, "Upload a valid file");
  assert.equal(validateField(fileField, void 0), "This field is required");
  assert.equal(validateField(fileField, { ...fileAnswer, name: "report.pdf", size: 12, mimeType: "application/pdf" }), null);
});
test("server ignores required hidden step fields when conditional answers skip them", () => {
  const fields = [
    { id: "choice", type: "multiple_choice", label: "Choice", required: true, stepId: "details", options: ["Yes", "No"] },
    { id: "extra", type: "short_text", label: "Extra", required: true, stepId: "extra", showIf: { fieldId: "choice", operator: "equals", value: "Yes" } },
  ];
  const steps = [
    { id: "details", title: "Details" },
    { id: "extra", title: "Extra", showIf: { fieldId: "choice", operator: "equals", value: "Yes" } },
  ];
  assert.deepEqual(checkAnswers(fields, { choice: "No" }, steps).errors, {});
  assert.equal(checkAnswers(fields, { choice: "Yes" }, steps).errors.extra, "This field is required");
});
test("field IDs cannot become Mongo operators and date answers use real ISO calendar dates", () => {
  const field = { id: "user-name_1", type: "date", label: "Date", required: true };
  assert.equal(fieldSchema.safeParse({ ...field, id: "answer.key" }).success, false);
  assert.equal(fieldSchema.safeParse(field).success, true);
  assert.equal(validateFieldDefinition({ ...field, id: "answer.$key" }), "Field ID may contain only letters, numbers, underscores, and hyphens");
  assert.equal(validateField(field, "2024-02-29"), null);
  assert.equal(checkAnswers([field], { [field.id]: "2024-02-29" }).errors[field.id], undefined);
  assert.equal(validateField(field, "2023-02-29"), "Enter a valid date");
  assert.equal(checkAnswers([field], { [field.id]: "2023-02-29" }).errors[field.id], "Enter a valid date");
  assert.equal(validateField(field, "2024-02-29T00:00:00Z"), "Enter a valid date");
});
test("backend and frontend enforce choice options and answer restrictions consistently", () => {
  const blankOptions = { id: "choice", type: "dropdown", label: "Choice", required: false, options: [" ", "Yes"] };
  const duplicateOptions = { ...blankOptions, options: ["Yes", " yes "] };
  const validOptions = { ...blankOptions, options: ["Yes", "No"] };
  assert.equal(fieldSchema.safeParse(blankOptions).success, false);
  assert.equal(validateFieldDefinition(blankOptions), "Options cannot be empty");
  assert.equal(fieldSchema.safeParse(duplicateOptions).success, false);
  assert.equal(validateFieldDefinition(duplicateOptions), "Options must be unique");
  assert.equal(fieldSchema.safeParse(validOptions).success, true);
  assert.equal(validateFieldDefinition(validOptions), null);
  assert.equal(validateFormContent({ title: "Form", description: "", accent: "#4f46e5", fields: [validOptions] }), null);
  assert.notEqual(validateFormContent({ title: " ", description: "", accent: "#4f46e5", fields: [] }), null);
  assert.notEqual(validateFormContent({ title: "Form", description: "x".repeat(2001), accent: "#4f46e5", fields: [] }), null);
  const textField = fieldSchema.parse({ id: "text", type: "short_text", label: "Text", required: false });
  const tooLong = "x".repeat(5001);
  assert.equal(checkAnswers([textField], { text: tooLong }).errors.text, validateField(textField, tooLong));
  assert.equal(validateField(textField, 12), "Enter text");
  const ratingField = fieldSchema.parse({ id: "rating", type: "rating", label: "Rating", required: true });
  assert.deepEqual(checkAnswers([ratingField], { rating: 4 }), { errors: {}, clean: { rating: 4 } });
  assert.equal(validateField(ratingField, 4), null);
  assert.equal(checkAnswers([{ ...ratingField, type: "checkbox" }], { rating: "yes" }).errors.rating, "Choose a valid checkbox value");
  assert.equal(validateField({ ...ratingField, type: "checkbox" }, "yes"), "Choose a valid checkbox value");
});
test("legacy forms normalize to one step and conditional steps and fields evaluate consistently", () => {
  const legacy = normalizeFormSteps({
    title: "Legacy",
    description: "",
    accent: "#4f46e5",
    fields: [{ id: "choice", type: "multiple_choice", label: "Choice", required: false, options: ["Yes", "No"] }],
  });
  assert.equal(legacy.steps.length, 1);
  assert.equal(legacy.fields[0].stepId, legacy.steps[0].id);

  const form = normalizeFormSteps({
    title: "Conditional",
    description: "",
    accent: "#4f46e5",
    steps: [
      { id: "details", title: "Details", showIf: null },
      { id: "extra", title: "Extra", showIf: { fieldId: "choice", operator: "equals", value: "Yes" } },
    ],
    fields: [
      { id: "choice", stepId: "details", type: "multiple_choice", label: "Choice", required: false, options: ["Yes", "No"] },
      { id: "extra-field", stepId: "extra", type: "short_text", label: "Extra", required: true, showIf: { fieldId: "choice", operator: "equals", value: "Yes" } },
    ],
  });
  assert.deepEqual(visibleSteps(form, { choice: "Yes" }).map(step => step.id), ["details", "extra"]);
  assert.deepEqual(visibleSteps(form, { choice: "No" }).map(step => step.id), ["details"]);
  assert.equal(visibleFields(form, { choice: "No" }, "extra").length, 0);
  assert.equal(conditionMatches({ fieldId: "choice", operator: "not_equals", value: "Yes" }, { choice: "No" }), true);
});
test("form autosave accepts partial bodies while preserving field ID validation", () => {
  const field = { id: "name", type: "short_text", label: "Name", required: false };
  assert.deepEqual(formPatchBody.parse({ title: "Updated" }), { title: "Updated" });
  assert.deepEqual(formPatchBody.parse({
    title: "Form",
    description: "",
    fields: [field],
    accent: "#4f46e5"
  }).fields, [field]);
  assert.equal(formPatchBody.safeParse({ fields: [field, field] }).success, false);
  assert.equal(formBody.safeParse({ title: "Form", fields: [field, field], accent: "#4f46e5" }).success, false);
});
test("autosave serializes requests and persists the newest snapshot after an in-flight save", async () => {
  const calls = [];
  const releases = [];
  const queue = createLatestSaveQueue((snapshot) => {
    calls.push(snapshot.revision);
    return new Promise((resolve) => releases.push(resolve));
  });
  queue.setLatest({ revision: 1 });
  const saving = queue.flush();
  await new Promise((resolve) => setImmediate(resolve));
  queue.setLatest({ revision: 2 });
  assert.deepEqual(calls, [1]);
  releases[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [1, 2]);
  releases[1]();
  await saving;
  assert.equal(queue.isSaved(), true);
});
test("autosave retries the newest snapshot if an older in-flight save fails", async () => {
  const calls = [];
  const pending = [];
  const queue = createLatestSaveQueue((snapshot) => {
    calls.push(snapshot.revision);
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  });
  queue.setLatest({ revision: 1 });
  const saving = queue.flush();
  await new Promise((resolve) => setImmediate(resolve));
  queue.setLatest({ revision: 2 });
  pending[0].reject(new Error("stale save failed"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [1, 2]);
  pending[1].resolve();
  await saving;
  assert.equal(queue.isSaved(), true);
});
test("flush persists updates queued at the completion boundary of an in-flight save", async () => {
  const calls = [];
  let queue;
  let racingFlush;
  queue = createLatestSaveQueue(snapshot => {
    calls.push(snapshot.revision);
    if (snapshot.revision === 1) {
      return {
        then(resolve) {
          resolve();
          queueMicrotask(() => {
            queue.setLatest({ revision: 2 });
            racingFlush = queue.flush();
          });
        },
      };
    }
    return Promise.resolve();
  });
  queue.setLatest({ revision: 1 });
  await queue.flush();
  await racingFlush;
  assert.deepEqual(calls, [1, 2]);
  assert.equal(queue.isSaved(), true);
});
test("API requests share auth, body handling, blob parsing, and server error messages", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  setAuthTokenGetter(async () => "test-token");
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1)
      return new Response(JSON.stringify({ id: "form-1" }), { status: 200, headers: { "content-type": "application/json" } });
    if (calls.length === 2)
      return new Response(JSON.stringify({ error: "Form is closed" }), { status: 404, headers: { "content-type": "application/json" } });
    if (calls.length === 3)
      return new Response(JSON.stringify({ fileId: "file-1" }), { status: 201, headers: { "content-type": "application/json" } });
    return new Response("file-data", { status: 200 });
  };
  try {
    assert.deepEqual(await api.getForm("form/1"), { id: "form-1" });
    assert.match(calls[0].url, /forms\/form%2F1$/);
    assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
    await assert.rejects(api.getPublicForm("form-1"), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 404);
      assert.equal(error.message, "Form is closed");
      return true;
    });
    assert.deepEqual(await api.uploadFile("form-1", "attachment", new Blob(["data"], { type: "image/png" })), { fileId: "file-1" });
    assert.ok(calls[2].options.body instanceof FormData);
    assert.equal(calls[2].options.headers["Content-Type"], undefined);
    assert.deepEqual(await (await api.downloadFile("form-1", "file-1")).text(), "file-data");
  } finally {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(async () => null);
  }
});
test("response API sends paginated filters and authenticated management actions", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  setAuthTokenGetter(async () => "response-token");
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1)
      return new Response(JSON.stringify({ items: [], total: 0, filteredTotal: 0 }), { status: 200 });
    if (calls.length === 2)
      return new Response(JSON.stringify({ id: "response-1", status: "read" }), { status: 200 });
    if (calls.length === 3)
      return new Response(JSON.stringify({ deletedCount: 1 }), { status: 200 });
    return new Response("export-data", { status: 200 });
  };
  try {
    await api.listResponses("form-1", { page: 2, pageSize: 10, q: "Ada" });
    assert.match(calls[0].url, /responses\?page=2&pageSize=10&q=Ada$/);
    assert.equal(calls[0].options.headers.Authorization, "Bearer response-token");
    await api.updateResponseStatus("form-1", "response-1", "read");
    assert.deepEqual(JSON.parse(calls[1].options.body), { status: "read" });
    await api.deleteResponses("form-1", ["response-1"]);
    assert.deepEqual(JSON.parse(calls[2].options.body), { responseIds: ["response-1"] });
    assert.equal(await (await api.exportResponses("form-1", { status: "unread", format: "excel" })).text(), "export-data");
    assert.match(calls[3].url, /responses\/export\?status=unread&format=excel$/);
  } finally {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(async () => null);
  }
});
test("workspace data is cleared when authentication changes or ends", async () => {
  store.dispatch({ type: "auth/profile/pending", meta: { arg: "first-user" } });
  store.dispatch({ type: "auth/profile/fulfilled", payload: { id: "first-user" }, meta: { arg: "first-user" } });
  store.dispatch({
    type: "app/load/fulfilled",
    payload: {
      forms: [{ id: "private-form", responseCount: 1 }],
      responses: [{ id: "private-response", formId: "private-form" }]
    },
    meta: { arg: "first-user" }
  });
  store.dispatch({ type: "auth/profile/pending", meta: { arg: "another-user" } });
  assert.deepEqual(store.getState().forms, []);
  assert.deepEqual(store.getState().responses, []);
  const staleLoad = await store.dispatch(loadDashboard("first-user"));
  assert.equal(staleLoad.meta.condition, true);
  store.dispatch({
    type: "app/load/fulfilled",
    payload: { forms: [{ id: "private-form" }], responses: [] },
    meta: { arg: "first-user" }
  });
  assert.deepEqual(store.getState().forms, []);
  store.dispatch({ type: "auth/profile/fulfilled", payload: { id: "another-user" }, meta: { arg: "another-user" } });
  store.dispatch({ type: "app/clearAuthProfile" });
  assert.deepEqual(store.getState().forms, []);
  assert.equal(store.getState().auth.user, null);
});
test("form and response queries have indexes that support owner and date sorting", () => {
  const indexKeys = schema => schema.indexes().map(([keys]) => keys);
  assert.ok(indexKeys(Form.schema).some(keys => keys.owner === 1 && keys.updatedAt === -1));
  assert.ok(indexKeys(FormResponse.schema).some(keys => keys.form === 1 && keys.createdAt === -1));
  assert.ok(indexKeys(FormResponse.schema).some(keys => keys.form === 1 && keys.status === 1 && keys.createdAt === -1));
  assert.ok(indexKeys(FormResponse.schema).some(keys => keys.createdAt === -1));
  assert.equal(FormResponse.schema.path("status").defaultValue, "unread");
});
test("response query validation caps pagination and validates date and answer filters", () => {
  assert.deepEqual(responseQuerySchema.parse({}), {
    page: 1, pageSize: 25, q: "", fromOffsetMinutes: 0, toOffsetMinutes: 0,
    status: "all", sortBy: "submittedAt", sortOrder: "desc", format: "csv"
  });
  assert.equal(responseQuerySchema.safeParse({ pageSize: "11" }).success, false);
  assert.equal(responseQuerySchema.safeParse({ from: "2026-02-30" }).success, false);
  assert.equal(responseQuerySchema.safeParse({ from: "2026-03-02", to: "2026-03-01" }).success, false);
  assert.equal(responseQuerySchema.safeParse({ answer: "Ada" }).success, false);
  assert.equal(responseQuerySchema.safeParse({ page: "100000", pageSize: "25" }).success, false);
});
test("response filters are form-scoped, date-bounded, status-aware and regex-safe", () => {
  const query = responseQuerySchema.parse({
    from: "2026-04-02", to: "2026-04-02", questionId: "name", answer: ".*", status: "unread", sortBy: "name", sortOrder: "asc"
  });
  const fields = [{ id: "name", type: "short_text" }, { id: "age", type: "number" }];
  const filter = buildResponseFilter("form-id", query, fields);
  assert.deepEqual(filter.$and[0], { form: "form-id" });
  assert.deepEqual(filter.$and[1].createdAt, {
    $gte: new Date("2026-04-02T00:00:00.000Z"),
    $lt: new Date("2026-04-03T00:00:00.000Z")
  });
  assert.deepEqual(filter.$and[2].$or, [{ status: "unread" }, { status: { $exists: false } }]);
  assert.equal(filter.$and[3].$or[0]["answers.name"].$regex, "\\.\\*");
  assert.deepEqual(buildResponseSort(query), { "answers.name": 1, _id: 1 });
  assert.equal(validateResponseFields(query, fields), null);
  assert.equal(validateResponseFields({ ...query, sortBy: "foreign" }, fields), "Sort field is not part of this form");
  const localDateQuery = responseQuerySchema.parse({ from: "2026-04-02", fromOffsetMinutes: "-330" });
  assert.equal(buildResponseFilter("form-id", localDateQuery, fields).$and[1].createdAt.$gte.toISOString(), "2026-04-02T05:30:00.000Z");
  const fileQuery = responseQuerySchema.parse({ questionId: "attachment", answer: "report", sortBy: "attachment" });
  const fileFields = [{ id: "attachment", type: "file" }];
  const fileFilter = buildResponseFilter("form-id", fileQuery, fileFields);
  assert.equal(fileFilter.$and[1].$or[0]["answers.attachment.name"].$regex, "report");
  assert.deepEqual(buildResponseSort(fileQuery, fileFields), { "answers.attachment.name": -1, _id: -1 });
});
test("response export escapes CSV formulas and SpreadsheetML text", () => {
  assert.equal(csvCell('=HYPERLINK("https://example.test")'), `"'=HYPERLINK(""https://example.test"")"`);
  assert.equal(csvCell(" \t=HYPERLINK(\"https://example.test\")"), `"' \t=HYPERLINK(""https://example.test"")"`);
  assert.equal(csvCell("-12"), "-12");
  assert.equal(xmlText(`<tag a="b">&'`), "&lt;tag a=&quot;b&quot;&gt;&amp;&apos;");
  assert.equal(xmlText("bad\u0000control"), "badcontrol");
});
test("Google Sheets answer and worksheet helpers serialize values safely", () => {
  assert.equal(answerCellValue(["Yes", "Maybe"]), "Yes, Maybe");
  assert.equal(answerCellValue({ name: "Ada" }), "Ada");
  assert.equal(answerCellValue({ nested: true }), '{"nested":true}');
  assert.equal(columnName(27), "AA");
  assert.equal(quoteSheetTitle("Client's data"), "'Client''s data'");
});
test("Google Sheets worker recognizes transient MongoDB network errors", () => {
  assert.equal(isTransientMongoNetworkError({ name: "MongoNetworkError" }), true);
  assert.equal(isTransientMongoNetworkError({ cause: { code: "ECONNRESET" } }), true);
  assert.equal(isTransientMongoNetworkError(new Error("invalid delivery")), false);
});
test("successful response deletion updates dashboard counts and activity immediately", () => {
  store.dispatch({ type: "auth/profile/pending", meta: { arg: "response-test-user" } });
  store.dispatch({ type: "auth/profile/fulfilled", payload: { id: "response-test-user" }, meta: { arg: "response-test-user" } });
  store.dispatch({
    type: "app/load/fulfilled",
    payload: {
      forms: [{ id: "form-1", responseCount: 1 }],
      responses: [{ id: "response-1", formId: "form-1" }]
    },
    meta: { arg: "response-test-user" }
  });
  store.dispatch(responseDeleted({ formId: "form-1", responseId: "response-1" }));
  assert.equal(store.getState().forms.find((form) => form.id === "form-1")?.responseCount, 0);
  assert.equal(store.getState().responses.some((response) => response.id === "response-1"), false);
});
test("bulk response deletion adjusts counts by the confirmed deletion total", () => {
  store.dispatch({ type: "auth/profile/pending", meta: { arg: "bulk-response-user" } });
  store.dispatch({ type: "auth/profile/fulfilled", payload: { id: "bulk-response-user" }, meta: { arg: "bulk-response-user" } });
  store.dispatch({
    type: "app/load/fulfilled",
    payload: {
      forms: [{ id: "bulk-form", responseCount: 4 }],
      responses: [
        { id: "response-1", formId: "bulk-form" },
        { id: "response-2", formId: "bulk-form" },
      ]
    },
    meta: { arg: "bulk-response-user" }
  });
  store.dispatch(responsesDeleted({ formId: "bulk-form", responseIds: ["response-1", "already-deleted"], deletedCount: 1 }));
  assert.equal(store.getState().forms.find(form => form.id === "bulk-form")?.responseCount, 3);
  assert.deepEqual(store.getState().responses.map(response => response.id), ["response-2"]);
});
test("historical responses keep deleted and renamed field labels for display and CSV columns", () => {
  const currentFields = [{ id: "name", type: "short_text", label: "Preferred name", required: false }];
  const olderField = { id: "name", type: "short_text", label: "Full name", required: false };
  const olderResponse = { answers: { name: "Ada" }, fieldSnapshots: [olderField] };
  const columns = responseFieldColumns([olderResponse], currentFields);
  assert.deepEqual(columns.map((field) => field.label), ["Preferred name", "Full name"]);
  assert.equal(fieldsForResponse(olderResponse, currentFields)[0].label, "Full name");
  assert.equal(answerForResponseField(olderResponse, olderField, currentFields), "Ada");
  assert.equal(answerForResponseField(olderResponse, currentFields[0], currentFields), "");
  assert.deepEqual(fieldsForResponse({ answers: { name: "Grace" } }, currentFields), currentFields);
});
test("radio groups render unique labelled input IDs and first-invalid selection points to the group", () => {
  const fields = [
    { id: "color", type: "multiple_choice", label: "Color", options: ["Red", "Blue"], required: true },
    { id: "agree", type: "checkbox", label: "Agreement", placeholder: "I agree", required: true }
  ];
  const errors = validateAll(fields, {});
  assert.equal(firstInvalidField(fields, errors)?.id, "color");
  const props = {
    form: { title: "Form", description: "", accent: "#4f46e5", fields },
    onSubmit: async () => {
    }
  };
  const markup = renderToStaticMarkup(React.createElement(FormRenderer, props));
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(markup, /<legend id="field-[^-]+-0-label"[^>]*>Color/);
  const firstRadioId = markup.match(/<input id="([^"]+)" type="radio"/)?.[1];
  assert.ok(firstRadioId);
  assert.match(markup, new RegExp(`<label for="${firstRadioId}">Red<\\/label>`));
  assert.match(markup, /<fieldset[^>]*><legend id="field-[^-]+-1-label"[^>]*>Agreement/);
  const checkboxId = markup.match(/<input id="([^"]+)" type="checkbox"/)?.[1];
  assert.ok(checkboxId);
  assert.match(markup, new RegExp(`<label for="${checkboxId}">I agree<\\/label>`));
  assert.doesNotMatch(markup, /<label[^>]*>\s*<input/);
});
test("concurrent conditional reservations never exceed the configured submission limit", async () => {
  const filter = submissionReservationFilter("form-id", /* @__PURE__ */ new Date("2026-01-01T00:00:00Z"));
  assert.deepEqual(filter.submissionLimit, { $gt: 0 });
  assert.deepEqual(filter.$expr, { $lt: [{ $ifNull: ["$submissionCount", 0] }, "$submissionLimit"] });
  assert.equal(filter.status, "published");
  const limit = 7;
  const form = { status: "published", submissionLimit: limit, submissionCount: 0 };
  const reserveAtomically = async () => {
    await Promise.resolve();
    if (form.status !== "published" || !(form.submissionCount < form.submissionLimit)) return false;
    form.submissionCount += 1;
    return true;
  };
  const results = await Promise.all(Array.from({ length: 60 }, () => reserveAtomically()));
  assert.equal(results.filter(Boolean).length, limit);
  assert.equal(form.submissionCount, limit);
});
