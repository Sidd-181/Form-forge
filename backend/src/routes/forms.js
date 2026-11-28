"use strict";

const { Router } = require("express");
const { requireAuth } = require("../middleware");
const controller = require("../controllers/formsController");

const router = Router();
router.use(requireAuth);
router.get("/", controller.list);
router.get("/activity", controller.activity);
router.post("/", controller.create);
router.get("/:id", controller.get);
router.get("/:id/files/:fileId", controller.downloadFile);
router.patch("/:id", controller.patch);
router.post("/:id/status", controller.setStatus);
router.post("/:id/duplicate", controller.duplicate);
router.delete("/:id", controller.remove);
router.get("/:id/responses", controller.listResponses);
router.get("/:id/responses/export", controller.exportResponses);
router.patch("/:id/responses/:rid/status", controller.updateResponseStatus);
router.delete("/:id/responses", controller.deleteResponses);
router.delete("/:id/responses/:rid", controller.deleteResponse);

module.exports = router;
