const express = require("express");
const router = express.Router();
const MessageController = require("../Controller/messageController");
const authMiddleware = require("../Auth/authentication");

router.use(authMiddleware);

router.route("/")
    .get(MessageController.getAllMessages)
    .post(MessageController.createMessage);

router.route("/:id")
    .get(MessageController.getMessageById)
    .put(MessageController.updateMessage)
    .delete(MessageController.deleteMessage);

module.exports = router;