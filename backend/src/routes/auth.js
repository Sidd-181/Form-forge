"use strict";

const { Router } = require("express");
const mongoose = require("mongoose");
const { clerkClient, getAuth } = require("@clerk/express");
const { User, publicUser } = require("../models");
const { requireAuth } = require("../middleware");

const r = Router();

r.post("/profile", async (req, res) => {
    const { userId } = getAuth(req);
    if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }

    const clerkUser = await clerkClient.users.getUser(userId);
    const primaryEmail = clerkUser.emailAddresses.find(email => email.id === clerkUser.primaryEmailAddressId);
    if (!primaryEmail) {
        res.status(403).json({ error: "Add an email address to your Clerk account before continuing." });
        return;
    }

    const email = primaryEmail.emailAddress.trim().toLowerCase();
    const emailVerified = primaryEmail.verification?.status === "verified";
    let user = clerkUser.externalId && mongoose.isValidObjectId(clerkUser.externalId)
        ? await User.findById(clerkUser.externalId)
        : null;
    if (!user)
        user = await User.findOne({ clerkUserId: userId });

    if (!user && !emailVerified) {
        res.status(403).json({ error: "Verify your email address before continuing." });
        return;
    }
    if (!user)
        user = await User.findOne({ email });

    if (user?.clerkUserId && user.clerkUserId !== userId) {
        res.status(409).json({ error: "This account is already linked to another sign-in." });
        return;
    }

    if (user && emailVerified && user.email !== email) {
        const duplicate = await User.exists({ email, _id: { $ne: user._id } });
        if (duplicate) {
            res.status(409).json({ error: "That email address is already in use." });
            return;
        }
        user.email = email;
    }

    if (!user) {
        const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || email.split("@")[0];
        user = new User({ name, email, clerkUserId: userId });
    }
    else {
        user.clerkUserId = userId;
        if (!user.name?.trim())
            user.name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || email.split("@")[0];
    }

    await user.save();
    res.json(publicUser(user));
});

r.get("/me", requireAuth, async (_req, res) => {
    const user = await User.findById(res.locals.userId);
    if (!user) {
        res.status(404).json({ error: "Account profile not found" });
        return;
    }
    res.json(publicUser(user));
});

module.exports = r;
