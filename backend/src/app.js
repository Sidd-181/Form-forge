"use strict";

require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env") });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { clerkMiddleware } = require("@clerk/express");
const auth = require("./routes/auth");
const forms = require("./routes/forms");
const publicRoutes = require("./routes/public").default;
const settings = require("./routes/settings").default;
const googleSheets = require("./routes/googleSheets");
const { errorHandler } = require("./middleware");
const { connectToDatabase } = require("./database");
const { startGoogleSheetsDeliveryWorker } = require("./services/googleSheetsWorker");

const app = express();
const { CLIENT_ORIGIN = "http://localhost:5173" } = process.env;
const allowedOrigins = CLIENT_ORIGIN.split(",").map(origin => origin.trim()).filter(Boolean);
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim();

function getConfigurationError() {
    if (!process.env.MONGODB_URI?.trim())
        return "MONGODB_URI is required";
    if (!clerkPublishableKey)
        return "CLERK_PUBLISHABLE_KEY is required";
    if (!process.env.CLERK_SECRET_KEY?.trim())
        return "CLERK_SECRET_KEY is required";
    return null;
}

app.use(helmet(), cors({ origin: allowedOrigins }), express.json({ limit: "1mb" }));
app.use(clerkMiddleware({ publishableKey: clerkPublishableKey }));

app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
});

const createRateLimiter = (windowMs, limit) => rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/api/auth", createRateLimiter(15 * 60_000, 30));
app.use("/api/settings", createRateLimiter(15 * 60_000, 60));
app.use("/api/integrations", createRateLimiter(15 * 60_000, 60));
app.use("/api/public", createRateLimiter(60_000, 60));

app.use("/api", async (_req, res, next) => {
    const configurationError = getConfigurationError();
    if (configurationError) {
        console.error(`Invalid server configuration: ${configurationError}`);
        res.status(500).json({
            error: "Server configuration error",
            details: configurationError
        });
        return;
    }

    try {
        await connectToDatabase();
        startGoogleSheetsDeliveryWorker();
        next();
    }
    catch (error) {
        console.error("MongoDB connection failed:", error.message);
        res.status(503).json({ error: "Database unavailable" });
    }
});

app.use("/api/auth", auth);
app.use("/api/forms", forms);
app.use("/api/settings", settings);
app.use("/api/integrations/google-sheets", googleSheets);
app.use("/api/public", publicRoutes);
app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);

module.exports = app;
module.exports.getConfigurationError = getConfigurationError;
