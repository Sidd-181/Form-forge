"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicUser = exports.GoogleOAuthState = exports.GoogleSheetsConnection = exports.GoogleSheetsIntegration = exports.FormUpload = exports.FormResponse = exports.Form = exports.User = void 0;
const mongoose_1 = __importStar(require("mongoose"));
// Expose `id`, hide internals when sending JSON to the client.
const toJSON = {
    versionKey: false,
    transform: (_doc, ret) => {
        ret.id = String(ret._id);
        if (ret.createdAt && ret.form)
            ret.submittedAt = ret.createdAt;
        delete ret._id;
        delete ret.passwordHash;
        delete ret.owner;
        if (ret.form)
            ret.formId = String(ret.form);
        delete ret.form;
        return ret;
    },
};
const User = mongoose_1.default.model('User', new mongoose_1.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    clerkUserId: { type: String, unique: true, sparse: true },
    passwordHash: { type: String },
    workspaceName: { type: String, default: '', trim: true },
    notifications: { newResponse: { type: Boolean, default: true }, weeklyDigest: { type: Boolean, default: false } },
    defaultAccent: { type: String, default: '#4f46e5' },
}, { timestamps: true, toJSON }));
exports.User = User;
const fieldSchema = new mongoose_1.Schema({
    id: { type: String, required: true },
    type: { type: String, required: true, enum: ['short_text', 'long_text', 'email', 'number', 'phone', 'dropdown', 'multiple_choice', 'checkbox', 'date', 'rating', 'file'] },
    label: { type: String, default: '' }, description: String, placeholder: String,
    required: { type: Boolean, default: false }, options: [String], min: Number, max: Number,
    stepId: { type: String, default: null },
    showIf: {
        fieldId: { type: String, default: null },
        operator: { type: String, enum: ['equals', 'not_equals'], default: null },
        value: { type: String, default: null },
    },
}, { _id: false });
const stepSchema = new mongoose_1.Schema({
    id: { type: String, required: true },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    showIf: {
        fieldId: { type: String, default: null },
        operator: { type: String, enum: ['equals', 'not_equals'], default: null },
        value: { type: String, default: null },
    },
}, { _id: false });
const formSchema = new mongoose_1.Schema({
    owner: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    fields: [fieldSchema],
    steps: [stepSchema],
    accent: { type: String, default: '#4f46e5' },
    submissionLimit: { type: Number, default: null },
    submissionCount: { type: Number },
    expiresAt: { type: Date, default: null },
    views: { type: Number, default: 0 },
}, { timestamps: true, toJSON });
formSchema.index({ owner: 1, updatedAt: -1 });
const Form = mongoose_1.default.model('Form', formSchema);
exports.Form = Form;
const googleSheetsDeliverySchema = new mongoose_1.Schema({
    status: { type: String, enum: ['pending', 'syncing', 'success', 'failed'], default: 'pending' },
    spreadsheetId: { type: String, required: true },
    spreadsheetTitle: { type: String, default: '' },
    sheetId: { type: Number, required: true },
    sheetTitle: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    manualRetries: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lastAttemptAt: { type: Date, default: null },
    syncedAt: { type: Date, default: null },
    lockUntil: { type: Date, default: null },
    error: { type: String, default: '' },
}, { _id: false });
const responseSchema = new mongoose_1.Schema({
    form: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Form', required: true },
    answers: { type: mongoose_1.Schema.Types.Mixed, required: true },
    fieldSnapshots: { type: [fieldSchema], default: [] },
    completionSeconds: { type: Number, default: null },
    status: { type: String, enum: ['read', 'unread'], default: 'unread' },
    googleSheetsDelivery: { type: googleSheetsDeliverySchema, default: undefined },
}, { timestamps: { createdAt: true, updatedAt: false }, toJSON });
responseSchema.index({ form: 1, createdAt: -1 });
responseSchema.index({ form: 1, status: 1, createdAt: -1 });
responseSchema.index({ createdAt: -1 });
responseSchema.index({ 'googleSheetsDelivery.status': 1, 'googleSheetsDelivery.nextAttemptAt': 1 });
const FormResponse = mongoose_1.default.model('Response', responseSchema);
exports.FormResponse = FormResponse;
const GoogleSheetsIntegration = mongoose_1.default.model('GoogleSheetsIntegration', new mongoose_1.Schema({
    owner: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    form: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Form', required: true },
    enabled: { type: Boolean, default: false },
    spreadsheetId: { type: String, required: true },
    spreadsheetTitle: { type: String, default: '' },
    sheetId: { type: Number, required: true },
    sheetTitle: { type: String, default: '' },
}, { timestamps: true }));
GoogleSheetsIntegration.schema.index({ form: 1 }, { unique: true });
GoogleSheetsIntegration.schema.index({ owner: 1 });
exports.GoogleSheetsIntegration = GoogleSheetsIntegration;
const GoogleSheetsConnection = mongoose_1.default.model('GoogleSheetsConnection', new mongoose_1.Schema({
    owner: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    email: { type: String, default: '' },
    accessTokenEncrypted: { type: String, required: true, select: false },
    refreshTokenEncrypted: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
}, { timestamps: true }));
exports.GoogleSheetsConnection = GoogleSheetsConnection;
const GoogleOAuthState = mongoose_1.default.model('GoogleOAuthState', new mongoose_1.Schema({
    owner: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    stateHash: { type: String, required: true, unique: true },
    codeVerifier: { type: String, required: true },
    returnTo: { type: String, required: true },
    expiresAt: { type: Date, required: true },
}, { timestamps: true }));
GoogleOAuthState.schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
exports.GoogleOAuthState = GoogleOAuthState;
const FormUpload = mongoose_1.default.model('FormUpload', new mongoose_1.Schema({
    form: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Form', required: true, index: true },
    fieldId: { type: String, required: true },
    fileId: { type: String, required: true, unique: true },
    storageName: { type: String, required: true, unique: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
}, { timestamps: true }));
exports.FormUpload = FormUpload;
const publicUser = (u) => ({
    id: String(u._id), name: u.name, email: u.email, workspaceName: u.workspaceName ?? '', defaultAccent: u.defaultAccent ?? '#4f46e5',
    notifications: { newResponse: u.notifications?.newResponse ?? true, weeklyDigest: u.notifications?.weeklyDigest ?? false },
});
exports.publicUser = publicUser;
