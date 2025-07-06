const User = require("../models/UserSchema");
const CentralBalance = require("../models/CentralBalanceSchema");
const Transaction = require("../models/TransactionSchema");
const Message = require("../models/messageSchema");
const CustomError = require("./customError"); // Assuming customError.js is in the same directory
const mongoose = require("mongoose");

class TransactionController {
  static async createTransaction(req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { items, sharedUserIds } = req.body;
      const createdBy = req.user._id; // This is a Mongoose ObjectId

      if (!items?.length || !Array.isArray(items)) throw new CustomError("At least one item is required", 400);
      if (items.some(item => !item.itemName?.trim() || isNaN(item.price) || item.price <= 0)) throw new CustomError("All items must have valid name and positive price", 400);

      const isBalanceAddition = items[0].itemName === "Balance Addition";
      const isBalanceRemoval = items[0].itemName === "Balance Removal";
      const isBalanceTransaction = isBalanceAddition || isBalanceRemoval;

      const total = items.reduce((sum, item) => sum + Number(item.price), 0);

      let finalSharedUsers;
      let individualDeduction;

      // Convert createdBy ObjectId to string for consistent comparison
      const createdByString = createdBy.toString();

      if (isBalanceTransaction) {
        // For balance transactions, only the creator is involved in the "share" logic
        // Ensure sharedUserIds[0] exists before calling .toString()
        if (sharedUserIds.length > 1 || sharedUserIds[0]?.toString() !== createdByString) {
          throw new CustomError("Balance transactions can only involve the creator as the shared user.", 400);
        }
        // Store as Mongoose ObjectIds for the schema
        finalSharedUsers = [createdBy];
        individualDeduction = total;
        if (isBalanceRemoval) individualDeduction = -total;
      } else {
        // For regular shopping transactions
        if (!sharedUserIds?.length || !Array.isArray(sharedUserIds)) throw new CustomError("At least one user must be selected for shopping transactions", 400);
        // Ensure sharedUserIds are converted to Mongoose ObjectIds for the schema
        finalSharedUsers = [...new Set(sharedUserIds.map(id => new mongoose.Types.ObjectId(id)))];
        individualDeduction = total / finalSharedUsers.length;
      }

      // Validate all user IDs
      // Create an array of string IDs for the `$in` query
      const allInvolvedUserStrings = [...new Set([
        ...finalSharedUsers.map(id => id.toString()), // Ensure these are strings if they're still ObjectIds
        createdByString // Already a string
      ])];

      const users = await User.find({ _id: { $in: allInvolvedUserStrings } }).session(session);
      if (!users || users.length !== allInvolvedUserStrings.length) {
        throw new CustomError("One or more invalid user IDs involved in transaction", 400);
      }

      let centralBalanceDoc = await CentralBalance.findOne().session(session);
      if (!centralBalanceDoc) {
        centralBalanceDoc = await CentralBalance.create([{ balance: 0, lastUpdated: Date.now() }], { session });
        centralBalanceDoc = centralBalanceDoc[0];
      }

      // Adjust central balance
      if (isBalanceAddition) {
        centralBalanceDoc.balance += total;
      } else {
        centralBalanceDoc.balance -= total;
      }
      centralBalanceDoc.lastUpdated = Date.now();
      await centralBalanceDoc.save({ session });

      // Adjust user balances
      if (isBalanceAddition) {
        const creatorUser = users.find(u => u._id.toString() === createdByString); // Use createdByString
        if (!creatorUser) throw new CustomError("Creator user not found after fetching all users.", 404);
        creatorUser.balance += total;
        await creatorUser.save({ session });
      } else if (isBalanceRemoval) {
        const creatorUser = users.find(u => u._id.toString() === createdByString); // Use createdByString
        if (!creatorUser) throw new CustomError("Creator user not found after fetching all users.", 404);
        if (creatorUser.balance < total) {
          throw new CustomError(`Insufficient balance for ${creatorUser.name} to remove ${total.toFixed(2)} tk. Current balance: ${creatorUser.balance.toFixed(2)} tk.`, 400);
        }
        creatorUser.balance -= total;
        await creatorUser.save({ session });
      } else {
        // For shopping, deduct from all shared users (which are now ObjectIds)
        await User.updateMany({ _id: { $in: finalSharedUsers } }, { $inc: { balance: -individualDeduction } }, { session });
      }

      const [transaction] = await Transaction.create([{
        items,
        sharedUsers: finalSharedUsers, // These are already ObjectIds
        createdBy: createdBy,          // This is an ObjectId
        totalPrice: total,
        centralBalanceAfter: centralBalanceDoc.balance,
        individualDeduction: individualDeduction,
        userBalanceBeforeTransaction: users.find(u => u._id.toString() === createdByString)?.balance // Snapshot for creator, use createdByString
      }], { session });

      // Find purchaser by comparing string IDs
      const purchaser = users.find(u => u._id.toString() === createdByString);
      if (!purchaser) {
        // This should theoretically not be hit if previous checks passed
        throw new CustomError("Purchaser user object not found for message creation.", 500);
      }

      await Message.create([{
        transactionId: transaction._id,
        message: `${purchaser.name} ${isBalanceAddition ? "added" : (isBalanceRemoval ? "removed" : "bought")} [${items.map(i => `${i.itemName}: $${i.price.toFixed(2)}`).join(", ")}]`,
        items,
        totalPrice: total,
        purchaser: createdBy, // Store ObjectId
        sharedUsers: finalSharedUsers, // Store ObjectIds
        centralBalanceAfter: centralBalanceDoc.balance,
        individualDeduction: individualDeduction
      }], { session });

      await session.commitTransaction();
      res.status(201).json({
        status: "success",
        data: { transaction: await Transaction.findById(transaction._id).populate("createdBy sharedUsers").session(null), centralBalance: centralBalanceDoc.balance }
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error in createTransaction:", err); // Log the actual error
      next(err.statusCode ? err : new CustomError(err.message || "Transaction creation failed", 500));
    } finally {
      session.endSession();
    }
  }


  static async getAllTransactions(req, res, next) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const totalTransactions = await Transaction.countDocuments();
      const transactions = await Transaction.find()
        .populate("createdBy sharedUsers")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const centralBalanceDoc = await CentralBalance.findOne();

      res.status(200).json({
        status: "success",
        data: {
          transactions,
          centralBalance: centralBalanceDoc?.balance || 0,
          totalPages: Math.ceil(totalTransactions / limit),
          currentPage: page,
        },
      });
    } catch (err) {
      next(err.statusCode ? err : new CustomError(err.message || "Failed to fetch transactions", 500));
    }
  }

  static async getTransactionById(req, res, next) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) throw new CustomError("Invalid transaction ID", 400);
      const transaction = await Transaction.findById(id).populate("createdBy sharedUsers");
      if (!transaction) throw new CustomError("Transaction not found", 404);

      // The frontend already checks for creator authorization.
      // If you want shared users to also view, keep this line.
      // If only creator can view, simplify.
      if (!transaction.createdBy._id.equals(req.user._id) && !transaction.sharedUsers.some(u => u._id.equals(req.user._id))) {
        // This check is fine if non-creators who are shared users can also view.
        // Otherwise, change to: `if (!transaction.createdBy._id.equals(req.user._id)) { ... }`
        throw new CustomError("Unauthorized access to transaction", 403);
      }
      res.status(200).json({ status: "success", data: { transaction } });
    } catch (err) {
      next(err.statusCode ? err : new CustomError(err.message || "Failed to fetch transaction", 500));
    }
  }

  static async updateTransaction(req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id: transactionId } = req.params;
      const { items, sharedUsers } = req.body; // sharedUsers is an array of IDs from frontend
      const requestingUserId = req.user._id;

      // 1. Basic Input Validation
      if (!mongoose.isValidObjectId(transactionId)) throw new CustomError("Invalid transaction ID", 400);
      if (!items?.length || !Array.isArray(items)) throw new CustomError("At least one item is required", 400);
      if (items.some(item => !item.itemName?.trim() || isNaN(item.price) || item.price <= 0)) throw new CustomError("All items must have valid name and positive price", 400);

      // 2. Fetch Original Transaction
      const originalTransaction = await Transaction.findById(transactionId).session(session);
      if (!originalTransaction) throw new CustomError("Transaction not found", 404);

      // 3. Authorization Check
      if (originalTransaction.createdBy._id.toString() !== requestingUserId.toString()) {
        throw new CustomError("Unauthorized to update this transaction", 403);
      }

      // 4. Determine Old Transaction Type and its Effective Values
      const wasOriginalBalanceAddition = originalTransaction.items[0]?.itemName === "Balance Addition";
      const wasOriginalBalanceRemoval = originalTransaction.items[0]?.itemName === "Balance Removal";
      const wasOriginalBalanceTransaction = wasOriginalBalanceAddition || wasOriginalBalanceRemoval;

      const oldTotal = originalTransaction.totalPrice; // This is always positive in DB for balance add/rem
      const oldIndividualDeduction = originalTransaction.individualDeduction; // Can be negative for removal

      // 5. Revert Old Transaction's Impact
      let centralBalanceDoc = await CentralBalance.findOne().session(session);
      if (!centralBalanceDoc) throw new CustomError("Central balance document not found. Please contact support.", 500);

      if (wasOriginalBalanceAddition) {
        // Revert Balance Addition: deduct total from central, deduct total from creator's balance
        centralBalanceDoc.balance -= oldTotal;
        await User.findByIdAndUpdate(originalTransaction.createdBy, { $inc: { balance: -oldTotal } }, { session });
      } else if (wasOriginalBalanceRemoval) {
        // Revert Balance Removal: add total back to central, add total back to creator's balance
        centralBalanceDoc.balance += oldTotal; // oldTotal is positive in DB, so add it back
        await User.findByIdAndUpdate(originalTransaction.createdBy, { $inc: { balance: oldTotal } }, { session });
      } else {
        // Revert Shopping Transaction: add total back to central, add individual deduction back to shared users
        centralBalanceDoc.balance += oldTotal;
        await User.updateMany({ _id: { $in: originalTransaction.sharedUsers } }, { $inc: { balance: oldIndividualDeduction } }, { session });
      }

      // 6. Determine New Transaction Type and Calculate New Values
      const isNewBalanceAddition = items[0].itemName === "Balance Addition";
      const isNewBalanceRemoval = items[0].itemName === "Balance Removal";
      const isNewBalanceTransaction = isNewBalanceAddition || isNewBalanceRemoval;

      // Prevent changing transaction type (e.g., Shopping to Balance or vice-versa)
      if (wasOriginalBalanceTransaction !== isNewBalanceTransaction) {
        throw new CustomError("Cannot change transaction type (e.g., Shopping to Balance or vice-versa) during edit. Please delete and create a new transaction.", 400);
      }
      // If it's a balance transaction, ensure sub-type doesn't change either (add to remove etc.)
      if (wasOriginalBalanceTransaction && (wasOriginalBalanceAddition !== isNewBalanceAddition || wasOriginalBalanceRemoval !== isNewBalanceRemoval)) {
        throw new CustomError("Cannot change balance transaction type (Addition to Removal or vice-versa) during edit. Please delete and create a new transaction.", 400);
      }

      const newTotal = items.reduce((sum, item) => sum + Number(item.price), 0);

      let finalNewSharedUsers;
      let newIndividualDeduction;

      if (isNewBalanceTransaction) {
        // For balance transactions, sharedUsers should always be just the creator
        if (sharedUsers.length > 1 || sharedUsers[0]?.toString() !== requestingUserId.toString()) {
          throw new CustomError("Balance transactions can only involve the creator as the shared user.", 400);
        }
        finalNewSharedUsers = [requestingUserId];
        newIndividualDeduction = newTotal;
        if (isNewBalanceRemoval) newIndividualDeduction = -newTotal; // Store as negative for consistency
      } else {
        // For regular shopping transactions
        if (!sharedUsers?.length || !Array.isArray(sharedUsers)) throw new CustomError("At least one user must be selected for shopping transactions", 400);
        finalNewSharedUsers = [...new Set(sharedUsers.map(id => id.toString()))];
        newIndividualDeduction = newTotal / finalNewSharedUsers.length;
      }

      // Validate all new involved user IDs
      const allNewInvolvedUserIds = [...new Set([...finalNewSharedUsers.map(id => id.toString()), requestingUserId.toString()])];
      const newUsers = await User.find({ _id: { $in: allNewInvolvedUserIds } }).session(session);
      if (!newUsers || newUsers.length !== allNewInvolvedUserIds.length) throw new CustomError("One or more new invalid user IDs involved in transaction", 400);


      // 7. Apply New Transaction's Impact
      if (isNewBalanceAddition) {
        centralBalanceDoc.balance += newTotal;
        await User.findByIdAndUpdate(requestingUserId, { $inc: { balance: newTotal } }, { session });
      } else if (isNewBalanceRemoval) {
        // Check for sufficient balance BEFORE applying removal
        const creatorUser = await User.findById(requestingUserId).session(session); // Re-fetch to get latest balance after revert
        if (!creatorUser || creatorUser.balance < newTotal) {
          // Abort if balance becomes insufficient AFTER reverting original, but BEFORE applying new
          throw new CustomError(`Insufficient balance for ${creatorUser?.name || 'user'} to remove ${newTotal.toFixed(2)} tk.`, 400);
        }
        centralBalanceDoc.balance -= newTotal;
        await User.findByIdAndUpdate(requestingUserId, { $inc: { balance: -newTotal } }, { session });
      } else {
        centralBalanceDoc.balance -= newTotal;
        await User.updateMany({ _id: { $in: finalNewSharedUsers } }, { $inc: { balance: -newIndividualDeduction } }, { session });
      }
      centralBalanceDoc.lastUpdated = Date.now();
      await centralBalanceDoc.save({ session });


      // 8. Update the Transaction Document
      originalTransaction.items = items;
      originalTransaction.sharedUsers = finalNewSharedUsers; // Store as string IDs
      originalTransaction.totalPrice = newTotal; // Store positive amount for balance add/remove
      originalTransaction.centralBalanceAfter = centralBalanceDoc.balance;
      originalTransaction.individualDeduction = newIndividualDeduction; // Can be negative for balance removal
      originalTransaction.edited = true;
      // originalTransaction.userBalanceBeforeTransaction: This field's update needs careful thought.
      // For now, it's not explicitly updated here as its "before" value depends on exact timing and history.
      // If strictly required, you'd need to fetch the user's balance *just before* the new effect is applied.
      // For simplicity, we'll let it capture the value from `createTransaction` and not update it here.
      await originalTransaction.save({ session });


      // 9. Update Associated Message (if exists)
      const purchaser = newUsers.find(u => u._id.toString() === requestingUserId.toString());
      await Message.findOneAndUpdate(
        { transactionId: transactionId },
        {
          message: `${purchaser.name} ${isNewBalanceAddition ? "added" : (isNewBalanceRemoval ? "removed" : "bought")} [${items.map(i => `${i.itemName}: $${i.price.toFixed(2)}`).join(", ")}]`,
          items,
          totalPrice: newTotal,
          purchaser: requestingUserId,
          sharedUsers: finalNewSharedUsers,
          centralBalanceAfter: centralBalanceDoc.balance,
          individualDeduction: newIndividualDeduction
        },
        { upsert: true, new: true, session } // Use new:true to get the updated message
      );

      await session.commitTransaction();

      // Fetch the updated transaction and central balance for response
      const updatedTransaction = await Transaction.findById(transactionId)
        .populate("createdBy sharedUsers")
        .session(null);
      const updatedCentralBalance = await CentralBalance.findOne().session(null);

      res.status(200).json({
        status: "success",
        message: "Transaction updated successfully!",
        data: {
          transaction: updatedTransaction,
          centralBalance: updatedCentralBalance?.balance || 0
        }
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error during transaction update:", err);
      next(err.statusCode ? err : new CustomError(err.message || "Failed to update transaction", 500));
    } finally {
      session.endSession();
    }
  }

  static async deleteTransaction(req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) throw new CustomError("Invalid transaction ID", 400);

      const transaction = await Transaction.findById(id).session(session);
      if (!transaction) throw new CustomError("Transaction not found", 404);
      if (!transaction.createdBy._id.equals(req.user._id)) throw new CustomError("Unauthorized to delete this transaction", 403);

      const isBalanceAddition = transaction.items[0]?.itemName === "Balance Addition";
      const isBalanceRemoval = transaction.items[0]?.itemName === "Balance Removal";
      const isBalanceTransaction = isBalanceAddition || isBalanceRemoval;

      let centralBalanceDoc = await CentralBalance.findOne().session(session);
      if (!centralBalanceDoc) throw new CustomError("Central balance not found", 500);

      if (isBalanceAddition) {
        // Revert Balance Addition: deduct total from central, deduct total from creator's balance
        centralBalanceDoc.balance -= transaction.totalPrice;
        await User.findByIdAndUpdate(transaction.createdBy, { $inc: { balance: -transaction.totalPrice } }, { session });
      } else if (isBalanceRemoval) {
        // Revert Balance Removal: add total back to central, add total back to creator's balance
        centralBalanceDoc.balance += transaction.totalPrice; // totalPrice is positive in DB for removal
        await User.findByIdAndUpdate(transaction.createdBy, { $inc: { balance: transaction.totalPrice } }, { session });
      } else {
        // Revert Shopping Transaction: add total back to central, add individual deduction back to shared users
        centralBalanceDoc.balance += transaction.totalPrice;
        // Here, transaction.individualDeduction should be positive for shopping transactions.
        await User.updateMany({ _id: { $in: transaction.sharedUsers } }, { $inc: { balance: transaction.individualDeduction } }, { session });
      }
      centralBalanceDoc.lastUpdated = Date.now();
      await centralBalanceDoc.save({ session });

      await Transaction.findByIdAndDelete(id, { session });
      await Message.deleteOne({ transactionId: id }, { session });

      await session.commitTransaction();
      res.status(200).json({ status: "success", message: "Transaction deleted successfully" }); // Changed to 200 as 204 doesn't send body
    } catch (err) {
      await session.abortTransaction();
      next(err.statusCode ? err : new CustomError(err.message || "Transaction deletion failed", 500));
    } finally {
      session.endSession();
    }
  }

  static async getCentralBalance(req, res, next) {
    try {
      const centralBalanceDoc = await CentralBalance.findOne();
      const balance = centralBalanceDoc?.balance || 0;

      res.status(200).json({
        status: "success",
        data: {
          centralBalance: balance
        }
      });
    } catch (err) {
      next(err.statusCode ? err : new CustomError(err.message || "Failed to fetch central balance", 500));
    }
  }
}

module.exports = TransactionController;