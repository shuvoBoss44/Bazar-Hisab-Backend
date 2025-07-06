const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", required: true },
    message: { type: String, required: true }, // Formatted message (e.g., "Alice bought [Groceries: $50.00]...")
    items: [
        {
            itemName: { type: String, required: true },
            price: { type: Number, required: true }
        }
    ],
    totalPrice: { type: Number, required: true },
    purchaser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sharedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    centralBalanceAfter: { type: Number, required: true },
    individualDeduction: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("Message", messageSchema);