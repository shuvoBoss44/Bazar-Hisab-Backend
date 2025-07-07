const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    items: [{
        itemName: {
            type: String,
            required: [true, 'Item name is required'],
            trim: true,
            maxlength: [100, 'Item name cannot exceed 100 characters']
        },
        price: {
            type: Number,
            required: [true, 'Item price is required'],
            min: [0, 'Price cannot be negative'] // Item prices are always positive
        }
    }],
    createdBy: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Transaction must have a creator']
    },
    sharedUsers: [{
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'At least one shared user is required']
    }],
    totalPrice: {
        type: Number,
        required: [true, 'Total price is required'],
        // totalPrice can be 0 (e.g., free items) or represent a positive amount for balance removal
    },
    centralBalanceAfter: {
        type: Number,
        required: [true, 'Central balance after transaction is required']
    },
    individualDeduction: {
        type: Number,
        required: [true, 'Individual deduction is required'],
        // individualDeduction can be negative for Balance Removal
    },
    edited: {
        type: Boolean,
        default: false
    },
    userBalanceBeforeTransaction: {
        type: Number,
        required: false, // This is specifically the creator's balance before the transaction.
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    // --- NEW FIELD ADDED ---
    usersBalancesAtTransactionTime: {
        type: [{
            _id: { // We'll store the User's ObjectId here for reference/uniqueness
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                required: true
            },
            name: {
                type: String,
                required: true
            },
            balanceAtTime: { // This is the user's balance at the exact moment of the transaction
                type: Number,
                required: true
            }
        }],
        required: [true, 'Historical user balances snapshot is required'], // Mark as required since it's crucial for history
        default: [] // Default to an empty array
    }
}, {
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Populate referenced fields
transactionSchema.pre(/^find/, function (next) {
    this.populate({
        path: 'createdBy sharedUsers',
        select: 'name email balance'
    });
    // We don't populate 'usersBalancesAtTransactionTime' here
    // because it stores a snapshot of the balance as a direct value,
    // not a reference that needs further population.
    next();
});

// Index for faster queries
transactionSchema.index({ createdBy: 1, createdAt: -1 });
transactionSchema.index({ sharedUsers: 1 }); // Consider if this is still optimal, as we now store all user balances directly in transaction

module.exports = mongoose.model('Transaction', transactionSchema);