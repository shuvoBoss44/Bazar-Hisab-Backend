const CustomError = require("../Controller/customError");
const mongoose = require("mongoose");

class MessageController {
    static async createMessage(req, res, next) {
        try {
            const { transactionId, message, items, totalPrice, purchaser, sharedUsers } = req.body;
            if (!transactionId || !message || !items || !totalPrice || !purchaser) {
                throw new CustomError("All required fields must be provided", 400);
            }
            const newMessage = await Message.create({ transactionId, message, items, totalPrice, purchaser, sharedUsers });
            res.status(201).json({ status: "success", data: newMessage });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to create message", 500));
        }
    }

    static async getAllMessages(req, res, next) {
        try {
            const messages = await Message.find().populate("purchaser sharedUsers").sort({ createdAt: -1 });
            res.status(200).json({ status: "success", data: messages });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to fetch messages", 500));
        }
    }

    static async getMessageById(req, res, next) {
        try {
            const { id } = req.params;
            if (!mongoose.isValidObjectId(id)) throw new CustomError("Invalid message ID", 400);
            const message = await Message.findById(id).populate("purchaser sharedUsers");
            if (!message) throw new CustomError("Message not found", 404);
            res.status(200).json({ status: "success", data: message });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to fetch message", 500));
        }
    }

    static async updateMessage(req, res, next) {
        try {
            const { id } = req.params;
            const updates = req.body;
            if (!mongoose.isValidObjectId(id)) throw new CustomError("Invalid message ID", 400);
            const message = await Message.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
            if (!message) throw new CustomError("Message not found", 404);
            res.status(200).json({ status: "success", data: message });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to update message", 500));
        }
    }

    static async deleteMessage(req, res, next) {
        try {
            const { id } = req.params;
            if (!mongoose.isValidObjectId(id)) throw new CustomError("Invalid message ID", 400);
            const message = await Message.findByIdAndDelete(id);
            if (!message) throw new CustomError("Message not found", 404);
            res.status(204).json({ status: "success", message: "Message deleted successfully" });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to delete message", 500));
        }
    }
}

module.exports = MessageController;