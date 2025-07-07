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
            min: [0, 'Price cannot be negative']
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
        validate: {
            validator: function (v) {
                return v.length > 0; // At least one shared user
            },
            message: 'At least one shared user is required'
        }
    }],
    totalPrice: {
        type: Number,
        required: [true, 'Total price is required'],
    },
    centralBalanceAfter: {
        type: Number,
        required: [true, 'Central balance after transaction is required']
    },
    individualDeduction: {
        type: Number,
        required: [true, 'Individual deduction is required'],
    },
    edited: {
        type: Boolean,
        default: false
    },
    userBalanceBeforeTransaction: {
        type: Number,
        required: [true, 'Creator\'s balance before transaction is required'],
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    usersBalancesAtTransactionTime: {
        type: [{
            _id: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                required: true
            },
            name: {
                type: String,
                required: true
            },
            balanceAtTime: {
                type: Number,
                required: true
            }
        }],
        required: [true, 'Historical user balances snapshot is required'],
        default: []
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

// Optimized index
transactionSchema.index({ createdAt: -1, createdBy: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);