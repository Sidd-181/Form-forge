"use strict";

const { getAuth } = require("@clerk/express");
const { User } = require("./models");
const { ZodError } = require("zod");

const requireAuth = async (req, res, next) => {
    const { userId } = getAuth(req);
    if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }

    const user = await User.findOne({ clerkUserId: userId }).select("_id");
    if (!user) {
        res.status(403).json({ error: "Your account profile is not linked yet. Refresh and try again." });
        return;
    }

    res.locals.userId = String(user._id);
    res.locals.clerkUserId = userId;
    next();
};

const errorHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
        res.status(400).json({ error: "Validation failed", issues: err.flatten().fieldErrors });
        return;
    }
    if (err?.type === "entity.parse.failed" || err?.name === "ValidationError" || err?.name === "CastError") {
        res.status(400).json({ error: "Invalid request" });
        return;
    }
    if (err?.status === 413) {
        res.status(413).json({ error: "Request body is too large" });
        return;
    }
    if (err?.code === 11000) {
        res.status(409).json({ error: "Already exists" });
        return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
};

module.exports = { requireAuth, errorHandler };
