"use strict";

const { createCipheriv, createDecipheriv, randomBytes, createHash } = require("node:crypto");
const { GoogleSheetsConnection } = require("../models");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
];

class GoogleApiError extends Error {
    constructor(status, message) {
        super(message);
        this.name = "GoogleApiError";
        this.status = status;
    }
}

function encryptionKey() {
    const encoded = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, ""))
        throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    return key;
}

function encryptSecret(value, key = encryptionKey()) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(value, key = encryptionKey()) {
    const [version, encodedIv, encodedTag, encodedCiphertext] = String(value).split(":");
    if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext)
        throw new Error("Stored Google credential has an unsupported format");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
    return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, "base64")),
        decipher.final(),
    ]).toString("utf8");
}

function getOAuthConfig() {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
    if (!clientId || !clientSecret || !redirectUri)
        throw new Error("Google OAuth client ID, client secret, and redirect URI must be configured on the backend");
    encryptionKey();
    return { clientId, clientSecret, redirectUri };
}

function stateHash(state) {
    return createHash("sha256").update(state).digest("hex");
}

async function parseResponse(response) {
    const text = await response.text();
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error("Google returned an invalid response");
    }
}

async function exchangeAuthorizationCode(code, codeVerifier) {
    const config = getOAuthConfig();
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            code_verifier: codeVerifier,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: config.redirectUri,
            grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(15000),
    });
    const data = await parseResponse(response);
    if (!response.ok)
        throw new Error(`Google authorization failed (${response.status}): ${String(data?.error_description ?? data?.error ?? "token exchange rejected").slice(0, 200)}`);
    if (typeof data?.access_token !== "string" || typeof data?.refresh_token !== "string")
        throw new Error("Google did not return the required offline access credentials; reconnect and grant access");
    return data;
}

async function googleIdentity(accessToken) {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
    });
    const data = await parseResponse(response);
    if (!response.ok || typeof data?.email !== "string")
        throw new Error("Could not verify the connected Google account");
    return data.email;
}

async function refreshAccessToken(connection) {
    const config = getOAuthConfig();
    const refreshToken = decryptSecret(connection.refreshTokenEncrypted);
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(15000),
    });
    const data = await parseResponse(response);
    if (!response.ok || typeof data?.access_token !== "string") {
        const reason = String(data?.error_description ?? data?.error ?? "token refresh rejected").slice(0, 200);
        throw new Error(`Google access token refresh failed (${response.status}): ${reason}`);
    }
    connection.accessTokenEncrypted = encryptSecret(data.access_token);
    if (typeof data.refresh_token === "string")
        connection.refreshTokenEncrypted = encryptSecret(data.refresh_token);
    connection.expiresAt = new Date(Date.now() + Math.max(0, Number(data.expires_in) || 0) * 1000);
    await connection.save();
    return data.access_token;
}

async function getAccessToken(connection, forceRefresh = false) {
    if (forceRefresh || !connection.expiresAt || connection.expiresAt.getTime() <= Date.now() + 60_000)
        return refreshAccessToken(connection);
    return decryptSecret(connection.accessTokenEncrypted);
}

async function authorizedGoogleRequest(connection, url, options = {}) {
    let accessToken = await getAccessToken(connection);
    const makeRequest = token => fetch(url, {
        ...options,
        headers: { ...options.headers, authorization: `Bearer ${token}` },
        signal: options.signal ?? AbortSignal.timeout(20000),
    });
    let response = await makeRequest(accessToken);
    if (response.status === 401) {
        accessToken = await getAccessToken(connection, true);
        response = await makeRequest(accessToken);
    }
    return response;
}

async function googleApi(connection, url, options) {
    const response = await authorizedGoogleRequest(connection, url, options);
    const data = await parseResponse(response);
    if (!response.ok) {
        const message = String(data?.error?.message ?? data?.error_description ?? "Google Sheets request failed").slice(0, 300);
        throw new GoogleApiError(response.status, message);
    }
    return data;
}

async function connectionForOwner(ownerId) {
    return GoogleSheetsConnection.findOne({ owner: ownerId })
        .select("+accessTokenEncrypted +refreshTokenEncrypted");
}

async function listSpreadsheets(ownerId) {
    const connection = await connectionForOwner(ownerId);
    if (!connection)
        throw new Error("Connect a Google account before choosing a spreadsheet");
    const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        orderBy: "name",
        pageSize: "1000",
        fields: "files(id,name,modifiedTime),nextPageToken",
    });
    const data = await googleApi(connection, `${DRIVE_FILES_URL}?${params}`);
    return (data.files ?? []).map(file => ({
        id: file.id,
        name: file.name,
        modifiedTime: file.modifiedTime ?? null,
    }));
}

async function getSpreadsheet(ownerId, spreadsheetId) {
    const connection = await connectionForOwner(ownerId);
    if (!connection)
        throw new Error("Connect a Google account before choosing a worksheet");
    const url = `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("spreadsheetId,properties(title),sheets(properties(sheetId,title,index))")}`;
    const data = await googleApi(connection, url);
    return {
        id: data.spreadsheetId,
        title: data.properties?.title ?? "",
        sheets: (data.sheets ?? []).map(item => ({
            id: item.properties.sheetId,
            title: item.properties.title,
            index: item.properties.index,
        })),
    };
}

function quoteSheetTitle(title) {
    return `'${String(title).replace(/'/g, "''")}'`;
}

function columnName(number) {
    let result = "";
    for (let value = number; value > 0; value = Math.floor((value - 1) / 26))
        result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
    return result;
}

function answerCellValue(value) {
    if (value == null)
        return "";
    if (Array.isArray(value))
        return value.map(answerCellValue).join(", ");
    if (typeof value === "object")
        return typeof value.name === "string" ? value.name : JSON.stringify(value);
    return String(value);
}

function uniqueHeader(label, index, occupied) {
    const base = String(label ?? "").trim() || `Question ${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (occupied.has(candidate.toLocaleLowerCase()))
        candidate = `${base} (${suffix++})`;
    occupied.add(candidate.toLocaleLowerCase());
    return candidate;
}

async function appendResponseToSheet(ownerId, integration, fields, answers) {
    const connection = await connectionForOwner(ownerId);
    if (!connection)
        throw new Error("The Google account is disconnected; reconnect it and retry this delivery");
    const spreadsheet = await getSpreadsheet(ownerId, integration.spreadsheetId);
    const sheet = spreadsheet.sheets.find(item => item.id === integration.sheetId);
    if (!sheet)
        throw new Error("The configured worksheet no longer exists; select a worksheet and retry");

    const quotedTitle = quoteSheetTitle(sheet.title);
    const headerRange = `${quotedTitle}!1:1`;
    const headerResult = await googleApi(connection, `${SHEETS_URL}/${encodeURIComponent(integration.spreadsheetId)}/values/${encodeURIComponent(headerRange)}?majorDimension=ROWS`);
    const headers = Array.from(headerResult.values?.[0] ?? [], value => String(value ?? ""));
    const usedColumns = new Set();
    const occupiedLabels = new Set(headers.map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
    const fieldColumns = [];
    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        const label = String(field.label ?? "").trim() || `Question ${index + 1}`;
        const match = headers.findIndex((header, column) =>
            !usedColumns.has(column) && header.trim().toLocaleLowerCase() === label.toLocaleLowerCase());
        if (match >= 0) {
            usedColumns.add(match);
            fieldColumns.push(match);
            continue;
        }
        const column = headers.length;
        headers.push(uniqueHeader(label, index, occupiedLabels));
        usedColumns.add(column);
        fieldColumns.push(column);
    }

    if (headers.length) {
        const updateRange = `${quotedTitle}!A1:${columnName(headers.length)}1`;
        await googleApi(connection, `${SHEETS_URL}/${encodeURIComponent(integration.spreadsheetId)}/values/${encodeURIComponent(updateRange)}?valueInputOption=RAW`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ values: [headers] }),
        });
    }

    const row = Array(headers.length).fill("");
    fields.forEach((field, index) => {
        row[fieldColumns[index]] = answerCellValue(answers?.[field.id]);
    });
    const appendRange = `${quotedTitle}!A1:${columnName(headers.length)}1`;
    const appendResult = await googleApi(connection, `${SHEETS_URL}/${encodeURIComponent(integration.spreadsheetId)}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: [row] }),
    });
    if (appendResult?.updates?.updatedRows !== 1)
        throw new Error("Google Sheets did not confirm that the response row was appended");
}

module.exports = {
    GOOGLE_SCOPES,
    GoogleApiError,
    answerCellValue,
    columnName,
    decryptSecret,
    encryptSecret,
    exchangeAuthorizationCode,
    getOAuthConfig,
    googleIdentity,
    listSpreadsheets,
    appendResponseToSheet,
    quoteSheetTitle,
    stateHash,
};
