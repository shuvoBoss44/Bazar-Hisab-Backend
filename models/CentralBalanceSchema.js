const mongoose = require("mongoose");

const centralBalanceSchema = new mongoose.Schema({
    balance: {
        type: Number,
        required: [true, "Central balance is required"],
        default: 0,
    },
    lastUpdated: {
        type: Date,
        default: Date.now,
    },
});

const CentralBalance = mongoose.model("CentralBalance", centralBalanceSchema);

module.exports = CentralBalance;