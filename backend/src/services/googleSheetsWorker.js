"use strict";

const { FormResponse, GoogleSheetsIntegration } = require("../models");
const { appendResponseToSheet } = require("./googleSheets");

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const LOCK_DURATION_MS = 2 * 60_000;
const BATCH_SIZE = 10;
const MONGO_NETWORK_ERROR_CODES = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
]);

function isTransientMongoNetworkError(error) {
    for (let current = error; current; current = current.cause) {
        if (/^Mongo(Network|ServerSelection|Topology)Error$/.test(current.name)
            || MONGO_NETWORK_ERROR_CODES.has(current.code))
            return true;
    }
    return false;
}

async function claimDelivery() {
    const now = new Date();
    return FormResponse.findOneAndUpdate({
        $or: [
            {
                "googleSheetsDelivery.status": "pending",
                "googleSheetsDelivery.nextAttemptAt": { $lte: now },
                "googleSheetsDelivery.attempts": { $lt: MAX_ATTEMPTS },
            },
            {
                "googleSheetsDelivery.status": "syncing",
                "googleSheetsDelivery.lockUntil": { $lte: now },
                "googleSheetsDelivery.attempts": { $lt: MAX_ATTEMPTS },
            },
        ],
    }, {
        $set: {
            "googleSheetsDelivery.status": "syncing",
            "googleSheetsDelivery.lastAttemptAt": now,
            "googleSheetsDelivery.lockUntil": new Date(now.getTime() + LOCK_DURATION_MS),
        },
        $inc: { "googleSheetsDelivery.attempts": 1 },
    }, {
        returnDocument: "after",
        sort: { "googleSheetsDelivery.nextAttemptAt": 1 },
    });
}

async function markExhaustedDeliveries() {
    const now = new Date();
    await FormResponse.updateMany({
        "googleSheetsDelivery.status": "syncing",
        "googleSheetsDelivery.lockUntil": { $lte: now },
        "googleSheetsDelivery.attempts": { $gte: MAX_ATTEMPTS },
    }, {
        $set: {
            "googleSheetsDelivery.status": "failed",
            "googleSheetsDelivery.error": "Delivery stopped after the maximum number of automatic attempts",
        },
        $unset: { "googleSheetsDelivery.lockUntil": 1 },
    });
}

async function finishDelivery(response, status, fields) {
    return FormResponse.updateOne({
        _id: response._id,
        "googleSheetsDelivery.status": "syncing",
        "googleSheetsDelivery.lockUntil": response.googleSheetsDelivery.lockUntil,
    }, {
        $set: {
            "googleSheetsDelivery.status": status,
            ...fields,
        },
        $unset: { "googleSheetsDelivery.lockUntil": 1 },
    });
}

async function deliver(response) {
    const delivery = response.googleSheetsDelivery;
    const integration = await GoogleSheetsIntegration.findOne({
        form: response.form,
        enabled: true,
    });
    if (!integration) {
        await finishDelivery(response, "failed", { "googleSheetsDelivery.error": "Google Sheets integration is disabled for this form" });
        return;
    }

    try {
        await appendResponseToSheet(
            integration.owner,
            integration,
            response.fieldSnapshots,
            response.answers,
        );
        await finishDelivery(response, "success", {
            "googleSheetsDelivery.error": "",
            "googleSheetsDelivery.syncedAt": new Date(),
        });
    }
    catch (error) {
        const message = String(error?.message ?? "Google Sheets delivery failed").slice(0, 500);
        const terminal = delivery.attempts >= MAX_ATTEMPTS;
        const nextAttemptAt = terminal
            ? undefined
            : new Date(Date.now() + RETRY_DELAYS_MS[delivery.attempts - 1]);
        const changes = {
            "googleSheetsDelivery.error": message,
        };
        if (nextAttemptAt)
            changes["googleSheetsDelivery.nextAttemptAt"] = nextAttemptAt;
        await finishDelivery(response, terminal ? "failed" : "pending", changes);
        if (terminal)
            console.error(`Google Sheets delivery ${response._id} failed after ${delivery.attempts} attempts: ${message}`);
        else
            console.warn(`Google Sheets delivery ${response._id} will retry: ${message}`);
    }
}

let workerTimer;
let workerRunning = false;
let mongoNetworkWarningActive = false;

async function runDeliveryWorker() {
    if (workerRunning)
        return;
    workerRunning = true;
    try {
        await markExhaustedDeliveries();
        for (let count = 0; count < BATCH_SIZE; count += 1) {
            const response = await claimDelivery();
            if (!response)
                break;
            await deliver(response);
        }
        mongoNetworkWarningActive = false;
    }
    catch (error) {
        if (isTransientMongoNetworkError(error)) {
            if (!mongoNetworkWarningActive) {
                console.warn("Google Sheets delivery worker temporarily cannot reach MongoDB; it will retry as the MongoDB driver reconnects:", error.message);
                mongoNetworkWarningActive = true;
            }
        }
        else {
            console.error("Google Sheets delivery worker failed:", error);
        }
    }
    finally {
        workerRunning = false;
    }
}

function startGoogleSheetsDeliveryWorker() {
    if (workerTimer)
        return;
    workerTimer = setInterval(() => { void runDeliveryWorker(); }, 10_000);
    workerTimer.unref?.();
    void runDeliveryWorker();
}

module.exports = {
    MAX_ATTEMPTS,
    isTransientMongoNetworkError,
    runDeliveryWorker,
    startGoogleSheetsDeliveryWorker,
};
