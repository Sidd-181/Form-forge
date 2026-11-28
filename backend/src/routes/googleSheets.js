"use strict";

const { randomBytes, createHash } = require("node:crypto");
const { Router } = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const { requireAuth } = require("../middleware");
const {
    Form,
    FormResponse,
    GoogleOAuthState,
    GoogleSheetsConnection,
    GoogleSheetsIntegration,
} = require("../models");
const {
    GoogleApiError,
    GOOGLE_SCOPES,
    decryptSecret,
    encryptSecret,
    exchangeAuthorizationCode,
    googleIdentity,
    getOAuthConfig: loadOAuthConfig,
    listSpreadsheets,
    stateHash,
    getSpreadsheet,
} = require("../services/googleSheets");

const router = Router();
const callbackReturnPath = z.string().regex(/^\/app\/forms\/[A-Za-z0-9_-]+\/(?:edit|share)$/);
const integrationBody = z.object({
    enabled: z.boolean(),
    spreadsheetId: z.string().min(1).max(300),
    sheetId: z.number().int().nonnegative(),
});

function isConfigured() {
    try {
        loadOAuthConfig();
        return true;
    }
    catch {
        return false;
    }
}

function frontendRedirect(returnTo, status) {
    const origin = process.env.CLIENT_ORIGIN?.split(",")[0]?.trim() || "http://localhost:5173";
    const target = new URL(returnTo || "/app/settings", origin);
    target.searchParams.set("googleSheets", status);
    return target.toString();
}

function handleErrors(handler) {
    return async (req, res, next) => {
        try {
            await handler(req, res);
        }
        catch (error) {
            if (error instanceof GoogleApiError) {
                res.status(error.status >= 400 && error.status < 500 ? error.status : 502)
                    .json({ error: error.message });
                return;
            }
            if (error instanceof z.ZodError) {
                res.status(400).json({ error: "Invalid Google Sheets integration request" });
                return;
            }
            console.error("Google Sheets integration request failed:", error);
            res.status(502).json({ error: error?.message ?? "Google Sheets request failed" });
        }
    };
}

router.get("/callback", async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const savedState = state
        ? await GoogleOAuthState.findOneAndDelete({
            stateHash: stateHash(state),
            expiresAt: { $gt: new Date() },
        })
        : null;
    if (!savedState) {
        res.redirect(frontendRedirect("/app/settings", "error"));
        return;
    }
    if (typeof req.query.error === "string" || typeof req.query.code !== "string") {
        res.redirect(frontendRedirect(savedState.returnTo, "error"));
        return;
    }

    try {
        const tokens = await exchangeAuthorizationCode(req.query.code, savedState.codeVerifier);
        const email = await googleIdentity(tokens.access_token);
        const existing = await GoogleSheetsConnection.findOne({ owner: savedState.owner })
            .select("+refreshTokenEncrypted");
        const refreshToken = tokens.refresh_token
            ?? (existing ? decryptSecret(existing.refreshTokenEncrypted) : null);
        if (!refreshToken)
            throw new Error("Google did not provide offline access; reconnect and grant access");

        await GoogleSheetsConnection.findOneAndUpdate({ owner: savedState.owner }, {
            $set: {
                email,
                accessTokenEncrypted: encryptSecret(tokens.access_token),
                refreshTokenEncrypted: encryptSecret(refreshToken),
                expiresAt: new Date(Date.now() + Math.max(0, Number(tokens.expires_in) || 0) * 1000),
            },
        }, { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true });
        res.redirect(frontendRedirect(savedState.returnTo, "connected"));
    }
    catch (error) {
        console.error("Google OAuth callback failed:", error);
        res.redirect(frontendRedirect(savedState.returnTo, "error"));
    }
});

router.use(requireAuth);

router.get("/connection", handleErrors(async (_req, res) => {
    const connection = await GoogleSheetsConnection.findOne({ owner: res.locals.userId }).select("email updatedAt");
    res.json({
        configured: isConfigured(),
        connected: Boolean(connection),
        email: connection?.email ?? "",
        connectedAt: connection?.updatedAt ?? null,
    });
}));

router.post("/connect", handleErrors(async (req, res) => {
    const { returnTo = "/app/settings" } = z.object({
        returnTo: callbackReturnPath.optional(),
    }).parse(req.body ?? {});
    const config = loadOAuthConfig();
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    await GoogleOAuthState.create({
        owner: res.locals.userId,
        stateHash: stateHash(state),
        codeVerifier,
        returnTo,
        expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
    }).toString();
    res.json({ authorizationUrl: authorization.toString() });
}));

router.delete("/connection", handleErrors(async (_req, res) => {
    await GoogleSheetsConnection.deleteOne({ owner: res.locals.userId });
    await GoogleSheetsIntegration.updateMany({ owner: res.locals.userId }, { $set: { enabled: false } });
    res.status(204).end();
}));

router.get("/spreadsheets", handleErrors(async (_req, res) => {
    res.json(await listSpreadsheets(res.locals.userId));
}));

router.get("/spreadsheets/:spreadsheetId/sheets", handleErrors(async (req, res) => {
    const spreadsheet = await getSpreadsheet(res.locals.userId, req.params.spreadsheetId);
    res.json(spreadsheet.sheets);
}));

router.get("/forms/:formId", handleErrors(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.formId)) {
        res.status(404).json({ error: "Form not found" });
        return;
    }
    const form = await Form.findOne({ _id: req.params.formId, owner: res.locals.userId }).select("_id");
    if (!form) {
        res.status(404).json({ error: "Form not found" });
        return;
    }
    const [integration, responses] = await Promise.all([
        GoogleSheetsIntegration.findOne({ form: form._id, owner: res.locals.userId }),
        FormResponse.find({ form: form._id, "googleSheetsDelivery.status": { $exists: true } })
            .sort({ createdAt: -1 })
            .limit(30)
            .select("createdAt googleSheetsDelivery"),
    ]);
    res.json({
        integration: integration ? {
            enabled: integration.enabled,
            spreadsheetId: integration.spreadsheetId,
            spreadsheetTitle: integration.spreadsheetTitle,
            sheetId: integration.sheetId,
            sheetTitle: integration.sheetTitle,
        } : null,
        deliveries: responses.map(response => ({
            id: String(response._id),
            submittedAt: response.createdAt,
            ...response.googleSheetsDelivery.toObject(),
        })),
    });
}));

router.put("/forms/:formId", handleErrors(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.formId)) {
        res.status(404).json({ error: "Form not found" });
        return;
    }
    const body = integrationBody.parse(req.body);
    const form = await Form.findOne({ _id: req.params.formId, owner: res.locals.userId }).select("_id");
    if (!form) {
        res.status(404).json({ error: "Form not found" });
        return;
    }
    const spreadsheet = await getSpreadsheet(res.locals.userId, body.spreadsheetId);
    const sheet = spreadsheet.sheets.find(item => item.id === body.sheetId);
    if (!sheet) {
        res.status(400).json({ error: "The selected worksheet does not exist in that spreadsheet" });
        return;
    }
    const integration = await GoogleSheetsIntegration.findOneAndUpdate({
        form: form._id,
        owner: res.locals.userId,
    }, {
        $set: {
            enabled: body.enabled,
            spreadsheetId: spreadsheet.id,
            spreadsheetTitle: spreadsheet.title,
            sheetId: sheet.id,
            sheetTitle: sheet.title,
        },
    }, { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true });
    res.json({
        enabled: integration.enabled,
        spreadsheetId: integration.spreadsheetId,
        spreadsheetTitle: integration.spreadsheetTitle,
        sheetId: integration.sheetId,
        sheetTitle: integration.sheetTitle,
    });
}));

router.post("/forms/:formId/deliveries/:deliveryId/retry", handleErrors(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.formId) || !mongoose.isValidObjectId(req.params.deliveryId)) {
        res.status(404).json({ error: "Delivery not found" });
        return;
    }
    const [form, connection, integration] = await Promise.all([
        Form.findOne({ _id: req.params.formId, owner: res.locals.userId }).select("_id"),
        GoogleSheetsConnection.exists({ owner: res.locals.userId }),
        GoogleSheetsIntegration.findOne({ form: req.params.formId, owner: res.locals.userId, enabled: true }),
    ]);
    if (!form) {
        res.status(404).json({ error: "Form not found" });
        return;
    }
    if (!connection || !integration) {
        res.status(409).json({ error: "Connect Google and enable this form's integration before retrying" });
        return;
    }
    const response = await FormResponse.findOneAndUpdate({
        _id: req.params.deliveryId,
        form: form._id,
        "googleSheetsDelivery.status": "failed",
    }, {
        $set: {
            "googleSheetsDelivery.status": "pending",
            "googleSheetsDelivery.spreadsheetId": integration.spreadsheetId,
            "googleSheetsDelivery.spreadsheetTitle": integration.spreadsheetTitle,
            "googleSheetsDelivery.sheetId": integration.sheetId,
            "googleSheetsDelivery.sheetTitle": integration.sheetTitle,
            "googleSheetsDelivery.attempts": 0,
            "googleSheetsDelivery.nextAttemptAt": new Date(),
            "googleSheetsDelivery.error": "",
        },
        $inc: { "googleSheetsDelivery.manualRetries": 1 },
        $unset: {
            "googleSheetsDelivery.lockUntil": 1,
            "googleSheetsDelivery.syncedAt": 1,
        },
    }, { returnDocument: "after" });
    if (!response) {
        res.status(404).json({ error: "Failed delivery not found" });
        return;
    }
    res.json({ ok: true });
}));

module.exports = router;
