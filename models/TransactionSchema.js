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
        // Removed min: [0, ...] here because totalPrice could be 0 (e.g., free items)
        // or effectively represent the *positive amount* for a balance removal (frontend sends positive)
    },
    centralBalanceAfter: {
        type: Number,
        required: [true, 'Central balance after transaction is required']
    },
    individualDeduction: {
        type: Number,
        required: [true, 'Individual deduction is required'],
        // Removed min: [0, ...] here because it can be negative for Balance Removal
    },
    edited: {
        type: Boolean,
        default: false
    },
    userBalanceBeforeTransaction: {
        type: Number,
        required: false,
    },
    createdAt: {
        type: Date,
        default: Date.now
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
    next();
});

// Index for faster queries
transactionSchema.index({ createdBy: 1, createdAt: -1 });
transactionSchema.index({ sharedUsers: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);