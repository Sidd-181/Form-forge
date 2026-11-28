"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formBody = exports.fieldSchema = exports.TYPES = void 0;
exports.checkAnswers = checkAnswers;
const zod_1 = require("zod");
exports.TYPES = ['short_text', 'long_text', 'email', 'number', 'phone', 'dropdown', 'multiple_choice', 'checkbox', 'date', 'rating', 'file'];
const conditionSchema = zod_1.z.object({
    fieldId: zod_1.z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    operator: zod_1.z.enum(['equals', 'not_equals']),
    value: zod_1.z.string().max(200),
}).nullable().optional();
exports.fieldSchema = zod_1.z.object({
    id: zod_1.z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), type: zod_1.z.enum(exports.TYPES), label: zod_1.z.string().max(300),
    description: zod_1.z.string().max(1000).optional(), placeholder: zod_1.z.string().max(300).optional(), required: zod_1.z.boolean(),
    options: zod_1.z.array(zod_1.z.string().max(200)).max(100).optional(), min: zod_1.z.number().optional(), max: zod_1.z.number().optional(),
    stepId: zod_1.z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
    showIf: conditionSchema,
}).superRefine((field, ctx) => {
    if (field.type === 'dropdown' || field.type === 'multiple_choice') {
        const options = field.options ?? [];
        if (options.length === 0)
            ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one option' });
        const seen = new Set();
        options.forEach((option, index) => {
            const normalized = option.trim().toLocaleLowerCase();
            if (!normalized)
                ctx.addIssue({ code: 'custom', path: ['options', index], message: 'Options cannot be empty' });
            else if (seen.has(normalized))
                ctx.addIssue({ code: 'custom', path: ['options', index], message: 'Options must be unique' });
            seen.add(normalized);
        });
    }
    if (field.type === 'short_text' || field.type === 'long_text') {
        if (field.min != null && (!Number.isInteger(field.min) || field.min < 0 || field.min > 5000)) {
            ctx.addIssue({ code: 'custom', path: ['min'], message: 'Text minimum must be between 0 and 5,000' });
        }
        if (field.max != null && (!Number.isInteger(field.max) || field.max < 0 || field.max > 5000)) {
            ctx.addIssue({ code: 'custom', path: ['max'], message: 'Text maximum must be between 0 and 5,000' });
        }
    }
    if (field.type === 'number') {
        if ((field.min != null && !Number.isFinite(field.min)) || (field.max != null && !Number.isFinite(field.max))) {
            ctx.addIssue({ code: 'custom', path: ['min'], message: 'Number bounds must be finite' });
        }
    }
    if (field.min != null && field.max != null && field.min > field.max) {
        ctx.addIssue({ code: 'custom', path: ['max'], message: 'Maximum must not be less than minimum' });
    }
    if (field.type === 'rating' && field.max != null && (!Number.isInteger(field.max) || field.max < 3 || field.max > 10)) {
        ctx.addIssue({ code: 'custom', path: ['max'], message: 'Rating maximum must be between 3 and 10' });
    }
    if (field.type === 'file' && field.max != null && (!Number.isFinite(field.max) || field.max < 1)) {
        ctx.addIssue({ code: 'custom', path: ['max'], message: 'File size maximum must be at least 1 MB' });
    }
});
const formBodyShape = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200), description: zod_1.z.string().max(2000).optional(),
    fields: zod_1.z.array(exports.fieldSchema).max(100), accent: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/),
    submissionLimit: zod_1.z.number().int().positive().nullable().optional(), expiresAt: zod_1.z.string().datetime().nullable().optional(),
    steps: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
        title: zod_1.z.string().max(200),
        description: zod_1.z.string().max(1000).optional(),
        showIf: conditionSchema,
    })).min(1).max(100).optional(),
});
const validateUniqueFieldIds = (form, ctx) => {
    if (!form.fields)
        return;
    const ids = new Set();
    form.fields.forEach((field, index) => {
        if (ids.has(field.id))
            ctx.addIssue({ code: 'custom', path: ['fields', index, 'id'], message: 'Field IDs must be unique' });
        ids.add(field.id);
    });
};
const validateSteps = (form, ctx) => {
    if (!form.steps)
        return;
    const stepIds = new Set();
    form.steps.forEach((step, index) => {
        if (stepIds.has(step.id))
            ctx.addIssue({ code: 'custom', path: ['steps', index, 'id'], message: 'Step IDs must be unique' });
        stepIds.add(step.id);
    });
    if (stepIds.size === 0)
        ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Add at least one step' });
    const fieldStepIds = new Set((form.fields ?? []).map(field => field.stepId).filter(Boolean));
    form.steps.forEach(step => {
        if ((form.fields ?? []).filter(field => field.stepId === step.id).length === 0)
            ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Steps cannot be empty' });
    });
    for (const field of form.fields ?? []) {
        if (field.stepId && !stepIds.has(field.stepId))
            ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Every field must belong to an existing step' });
    }
};
const validateFormStructure = (form, ctx) => {
    validateUniqueFieldIds(form, ctx);
    validateSteps(form, ctx);
};
exports.formBody = formBodyShape.superRefine(validateFormStructure);
exports.formPatchBody = formBodyShape.partial().superRefine(validateFormStructure);
function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function conditionMatches(condition, raw) {
    if (!condition?.fieldId)
        return true;
    const actual = raw[condition.fieldId];
    const normalized = actual === true ? 'true' : actual === false ? 'false' : String(actual ?? '');
    return condition.operator === 'not_equals'
        ? normalized !== condition.value
        : normalized === condition.value;
}
// Server-side re-validation of a submission against the form's field config. Never trust the client.
function checkAnswers(fields, raw, steps = []) {
    const errors = {};
    const clean = {};
    const visibleStepIds = steps.length
        ? new Set(steps.filter(step => conditionMatches(step.showIf, raw)).map(step => step.id))
        : null;
    for (const f of fields) {
        if (!conditionMatches(f.showIf, raw))
            continue;
        if (visibleStepIds && f.stepId && !visibleStepIds.has(f.stepId))
            continue;
        const v = raw[f.id];
        const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || v === false || (Array.isArray(v) && v.length === 0);
        if (empty) {
            if (f.required)
                errors[f.id] = 'This field is required';
            else if (f.type === 'checkbox' && v === false)
                clean[f.id] = 'No';
            continue;
        }
        const s = typeof v === 'string' ? v.trim() : '';
        const bad = (m) => { errors[f.id] = m; };
        switch (f.type) {
            case 'short_text':
            case 'long_text':
                if (typeof v !== 'string')
                    bad('Enter text');
                else if (s.length > 5000)
                    bad('Must be at most 5,000 characters');
                else if (f.min != null && s.length < f.min)
                    bad(`Must be at least ${f.min} characters`);
                else if (f.max != null && s.length > f.max)
                    bad(`Must be at most ${f.max} characters`);
                else
                    clean[f.id] = s;
                break;
            case 'email':
                typeof v === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? (clean[f.id] = s) : bad('Enter a valid email address');
                break;
            case 'phone':
                typeof v === 'string' && /^[+\d][\d\s()-]{5,19}$/.test(s) ? (clean[f.id] = s) : bad('Enter a valid phone number');
                break;
            case 'number': {
                const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
                if (!Number.isFinite(n))
                    bad('Enter a valid number');
                else if (f.min != null && n < f.min)
                    bad(`Must be at least ${f.min}`);
                else if (f.max != null && n > f.max)
                    bad(`Must be at most ${f.max}`);
                else
                    clean[f.id] = n;
                break;
            }
            case 'dropdown':
            case 'multiple_choice': {
                const option = typeof v === 'string' ? (f.options ?? []).find(o => o.trim() === s) : undefined;
                option ? (clean[f.id] = option.trim()) : bad('Choose one of the available options');
                break;
            }
            case 'checkbox':
                typeof v === 'boolean' ? (clean[f.id] = v ? 'Yes' : 'No') : bad('Choose a valid checkbox value');
                break;
            case 'date':
                isValidDate(v) ? (clean[f.id] = s) : bad('Enter a valid date');
                break;
            case 'rating': {
                const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
                Number.isInteger(n) && n >= 1 && n <= (f.max ?? 5) ? (clean[f.id] = n) : bad('Choose a rating');
                break;
            }
            case 'file': {
                const fileId = typeof v === 'object' && v !== null && !Array.isArray(v) ? v.fileId : null;
                typeof fileId === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(fileId) ? (clean[f.id] = { fileId }) : bad('Upload a valid file');
                break;
            }
        }
    }
    return { errors, clean };
}
