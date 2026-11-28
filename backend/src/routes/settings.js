"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const { clerkClient } = require("@clerk/express");
const models_1 = require("../models");
const middleware_1 = require("../middleware");
const { deleteFormUploads } = require("../uploadCleanup");
const { GoogleSheetsConnection, GoogleSheetsIntegration, GoogleOAuthState } = require("../models");
const r = (0, express_1.Router)();
r.use(middleware_1.requireAuth);
const current = (res) => models_1.User.findById(res.locals.userId);
r.patch('/', async (req, res) => {
    const b = zod_1.z.object({
        name: zod_1.z.string().trim().min(1).max(100), workspaceName: zod_1.z.string().trim().max(100),
        defaultAccent: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/),
        notifications: zod_1.z.object({ newResponse: zod_1.z.boolean(), weeklyDigest: zod_1.z.boolean() }).partial(),
    }).partial().parse(req.body);
    const u = await current(res);
    if (!u) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    if (b.name !== undefined)
        u.name = b.name;
    if (b.workspaceName !== undefined)
        u.workspaceName = b.workspaceName;
    if (b.defaultAccent !== undefined)
        u.defaultAccent = b.defaultAccent;
    if (b.notifications?.newResponse !== undefined)
        u.set('notifications.newResponse', b.notifications.newResponse);
    if (b.notifications?.weeklyDigest !== undefined)
        u.set('notifications.weeklyDigest', b.notifications.weeklyDigest);
    await u.save();
    res.json((0, models_1.publicUser)(u));
});
r.delete('/account', async (_req, res) => {
    const u = await current(res);
    if (!u) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    await models_1.Form.updateMany({ owner: u._id }, { status: 'draft' });
    const ids = (await models_1.Form.find({ owner: u._id }).select('_id')).map(f => f._id);
    await deleteFormUploads(ids);
    await clerkClient.users.deleteUser(res.locals.clerkUserId);
    await GoogleSheetsConnection.deleteOne({ owner: u._id });
    await GoogleSheetsIntegration.deleteMany({ owner: u._id });
    await GoogleOAuthState.deleteMany({ owner: u._id });
    await models_1.FormResponse.deleteMany({ form: { $in: ids } });
    await models_1.Form.deleteMany({ owner: u._id });
    await u.deleteOne();
    res.status(204).end();
});
exports.default = r;
