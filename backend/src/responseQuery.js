"use strict";

const { z } = require("zod");

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid date");

const responseQuerySchema = z.object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().refine(value => [10, 25, 50, 100].includes(value), "Choose a page size of 10, 25, 50, or 100").default(25),
    q: z.string().trim().max(200).default(""),
    from: dateString.optional(),
    to: dateString.optional(),
    fromOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
    toOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
    questionId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
    answer: z.string().trim().max(200).optional(),
    status: z.enum(["all", "read", "unread"]).default("all"),
    sortBy: z.string().regex(/^(submittedAt|[A-Za-z0-9_-]{1,40})$/).default("submittedAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    format: z.enum(["csv", "excel"]).default("csv"),
}).superRefine((query, ctx) => {
    if (query.from && query.to && query.from > query.to)
        ctx.addIssue({ code: "custom", path: ["to"], message: "End date must be on or after start date" });
    if (query.answer && !query.questionId)
        ctx.addIssue({ code: "custom", path: ["questionId"], message: "Select a question to filter by answer" });
    if (query.page * query.pageSize > 1_000_000)
        ctx.addIssue({ code: "custom", path: ["page"], message: "Requested page is too far into the result set" });
});

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateFilter(query) {
    const createdAt = {};
    if (query.from) {
        const start = new Date(`${query.from}T00:00:00.000Z`);
        start.setTime(start.getTime() - query.fromOffsetMinutes * 60_000);
        createdAt.$gte = start;
    }
    if (query.to) {
        const nextDay = new Date(`${query.to}T00:00:00.000Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        nextDay.setTime(nextDay.getTime() - query.toOffsetMinutes * 60_000);
        createdAt.$lt = nextDay;
    }
    return Object.keys(createdAt).length ? { createdAt } : {};
}

function buildResponseFilter(formId, query, fields) {
    const clauses = [{ form: formId }, dateFilter(query)];
    if (query.status === "read")
        clauses.push({ status: "read" });
    else if (query.status === "unread")
        clauses.push({ $or: [{ status: "unread" }, { status: { $exists: false } }] });

    if (query.questionId && query.answer) {
        const field = fields.find(item => item.id === query.questionId);
        const expression = { $regex: escapeRegex(query.answer), $options: "i" };
        const answerPath = field.type === "file" ? `answers.${field.id}.name` : `answers.${field.id}`;
        const answerClauses = [{ [answerPath]: expression }];
        if (["number", "rating"].includes(field.type) && Number.isFinite(Number(query.answer)))
            answerClauses.push({ [`answers.${field.id}`]: Number(query.answer) });
        clauses.push({ $or: answerClauses });
    }

    if (query.q) {
        const expression = { $regex: escapeRegex(query.q), $options: "i" };
        const answerClauses = fields.map(field => ({
            [field.type === "file" ? `answers.${field.id}.name` : `answers.${field.id}`]: expression,
        }));
        const numeric = Number(query.q);
        if (Number.isFinite(numeric)) {
            for (const field of fields.filter(item => ["number", "rating"].includes(item.type)))
                answerClauses.push({ [`answers.${field.id}`]: numeric });
        }
        clauses.push({ $or: answerClauses.length ? answerClauses : [{ _id: { $exists: false } }] });
    }

    return { $and: clauses.filter(clause => Object.keys(clause).length) };
}

function validateResponseFields(query, fields) {
    if (query.questionId && !fields.some(field => field.id === query.questionId))
        return "Question filter is not part of this form";
    if (query.sortBy !== "submittedAt" && !fields.some(field => field.id === query.sortBy))
        return "Sort field is not part of this form";
    return null;
}

function buildResponseSort(query, fields = []) {
    const sortField = fields.find(field => field.id === query.sortBy);
    const key = query.sortBy === "submittedAt"
        ? "createdAt"
        : `answers.${query.sortBy}${sortField?.type === "file" ? ".name" : ""}`;
    return { [key]: query.sortOrder === "asc" ? 1 : -1, _id: query.sortOrder === "asc" ? 1 : -1 };
}

function answerValue(value) {
    if (Array.isArray(value))
        return value.map(answerValue).join(", ");
    if (value && typeof value === "object")
        return String(value.name ?? "");
    return value == null ? "" : String(value);
}

function csvCell(value) {
    let text = String(value ?? "");
    if (/^[\u0000-\u0020]*[=+\-@]/.test(text) && !Number.isFinite(Number(text.trim())))
        text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function xmlText(value) {
    return String(value ?? "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

module.exports = {
    answerValue,
    buildResponseFilter,
    buildResponseSort,
    csvCell,
    responseQuerySchema,
    validateResponseFields,
    xmlText,
};
