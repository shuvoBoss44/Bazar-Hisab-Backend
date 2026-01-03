const mongoose = require("mongoose");
const Transaction = require("../models/TransactionSchema");
const User = require("../models/UserSchema");
const CentralBalance = require("../models/CentralBalanceSchema");
const Message = require("../models/MessageSchema");
const CustomError = require("./customError");

class TransactionController {
  static async createTransaction(req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { items, sharedUserIds = [] } = req.body;
      const createdBy = req.user._id;

      if (!items?.length || !Array.isArray(items)) throw new CustomError("At least one item is required", 400);
      if (items.some(item => !item.itemName?.trim() || isNaN(item.price) || item.price <= 0)) throw new CustomError("All items must have valid name and positive price", 400);

      const isBalanceAddition = items[0].itemName === "Balance Addition";
      const isBalanceRemoval = items[0].itemName === "Balance Removal";
      const isBalanceTransaction = isBalanceAddition || isBalanceRemoval;

      const total = items.reduce((sum, item) => sum + Number(item.price), 0);

      let finalSharedUsers;
      let individualDeduction;

      const createdByString = createdBy.toString();

      if (isBalanceTransaction) {
        if (sharedUserIds.length > 0 && sharedUserIds[0]?.toString() !== createdByString) {
          throw new CustomError("Balance transactions can only involve the creator as the shared user.", 400);
        }
        finalSharedUsers = [createdBy];
        individualDeduction = isBalanceAddition ? -total : total;
      } else {
        if (!sharedUserIds?.length || !Array.isArray(sharedUserIds)) throw new CustomError("At least one user must be selected for shopping transactions", 400);
        finalSharedUsers = [...new Set(sharedUserIds.map(id => new mongoose.Types.ObjectId(id)))];
        individualDeduction = total / finalSharedUsers.length;
      }

      const allInvolvedUserStrings = [...new Set([
        ...finalSharedUsers.map(id => id.toString()),
        createdByString
      ])];

      const involvedUsersBeforeUpdate = await User.find({ _id: { $in: allInvolvedUserStrings } }).session(session);
      if (!involvedUsersBeforeUpdate || involvedUsersBeforeUpdate.length !== allInvolvedUserStrings.length) {
        throw new CustomError("One or more invalid user IDs involved in transaction", 400);
      }

      let centralBalanceDoc = await CentralBalance.findOne().session(session);
      if (!centralBalanceDoc) {
        centralBalanceDoc = await CentralBalance.create([{ balance: 0, lastUpdated: Date.now() }], { session });
        centralBalanceDoc = centralBalanceDoc[0];
      }

      if (isBalanceAddition) {
        centralBalanceDoc.balance += total;
      } else {
        centralBalanceDoc.balance -= total;
      }
      centralBalanceDoc.lastUpdated = Date.now();
      await centralBalanceDoc.save({ session });

      let creatorUserBeforeUpdate = involvedUsersBeforeUpdate.find(u => u._id.toString() === createdByString);
      let userBalanceBeforeTransactionForCreator = creatorUserBeforeUpdate ? creatorUserBeforeUpdate.balance : 0;

      if (isBalanceRemoval) {
        const creatorUser = involvedUsersBeforeUpdate.find(u => u._id.toString() === createdByString);
        if (!creatorUser || creatorUser.balance < total) {
          throw new CustomError(`Insufficient balance for ${creatorUser?.name || 'user'} to remove ${total.toFixed(2)} tk.`, 400);
        }
      }

      await User.updateMany(
        { _id: { $in: finalSharedUsers } },
        { $inc: { balance: -individualDeduction } },
        { session }
      );

      const allUsersAfterTransaction = await User.find({}, 'name balance').session(session);
      const usersBalancesAtTransactionTime = allUsersAfterTransaction.map(userDoc => ({
        _id: userDoc._id,
        name: userDoc.name,
        balanceAtTime: userDoc.balance
      }));

      const [transaction] = await Transaction.create([{
        items,
        sharedUsers: finalSharedUsers,
        createdBy: createdBy,
        totalPrice: total,
        centralBalanceAfter: centralBalanceDoc.balance,
        individualDeduction: individualDeduction,
        userBalanceBeforeTransaction: userBalanceBeforeTransactionForCreator,
        usersBalancesAtTransactionTime: usersBalancesAtTransactionTime
      }], { session });

      const purchaser = await User.findById(createdBy).session(session);
      if (!purchaser) {
        throw new CustomError("Purchaser user object not found for message creation.", 500);
      }

      await Message.create([{
        transactionId: transaction._id,
        message: `${purchaser.name} ${isBalanceAddition ? "added" : (isBalanceRemoval ? "removed" : "bought")} [${items.map(i => `${i.itemName}: ৳${i.price.toFixed(2)}`).join(", ")}]`,
        items,
        totalPrice: total,
        purchaser: createdBy,
        sharedUsers: finalSharedUsers,
        centralBalanceAfter: centralBalanceDoc.balance,
        individualDeduction: individualDeduction
      }], { session });

      await session.commitTransaction();

      const createdTransaction = await Transaction.findById(transaction._id).populate("createdBy sharedUsers").session(null);
      res.status(201).json({
        status: "success",
        data: { transaction: createdTransaction, centralBalance: centralBalanceDoc.balance }
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error in createTransaction:", err);
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

      if (!transaction.createdBy._id.equals(req.user._id) && !transaction.sharedUsers.some(u => u._id.equals(req.user._id))) {
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
      const { items, sharedUsers, totalPrice } = req.body;
      const requestingUserId = req.user._id;

      if (!mongoose.isValidObjectId(transactionId)) throw new CustomError("Invalid transaction ID", 400);
      if (!items?.length || !Array.isArray(items)) throw new CustomError("At least one item is required", 400);
      if (items.some(item => !item.itemName?.trim() || isNaN(item.price) || item.price <= 0)) throw new CustomError("All items must have valid name and positive price", 400);

      const originalTransaction = await Transaction.findById(transactionId).session(session);
      if (!originalTransaction) throw new CustomError("Transaction not found", 404);

      if (originalTransaction.createdBy._id.toString() !== requestingUserId.toString()) {
        throw new CustomError("Unauthorized to update this transaction", 403);
      }

      // Check if this is the most recent transaction
      const latestTransaction = await Transaction.findOne().sort({ createdAt: -1 }).session(session);
      if (latestTransaction && latestTransaction._id.toString() !== transactionId) {
        throw new CustomError("Only the most recent transaction can be edited", 403);
      }

      const wasOriginalBalanceAddition = originalTransaction.items[0]?.itemName === "Balance Addition";
      const wasOriginalBalanceRemoval = originalTransaction.items[0]?.itemName === "Balance Removal";
      const isNewBalanceAddition = items[0].itemName === "Balance Addition";
      const isNewBalanceRemoval = items[0].itemName === "Balance Removal";
      const isNewBalanceTransaction = isNewBalanceAddition || isNewBalanceRemoval;

      if ((wasOriginalBalanceAddition !== isNewBalanceAddition) || (wasOriginalBalanceRemoval !== isNewBalanceRemoval)) {
        throw new CustomError("Cannot change transaction type during edit. Please delete and create a new transaction.", 400);
      }

      let centralBalanceDoc = await CentralBalance.findOne().session(session);
      if (!centralBalanceDoc) throw new CustomError("Central balance document not found.", 500);

      const oldTotal = originalTransaction.totalPrice;
      const oldIndividualDeduction = originalTransaction.individualDeduction;

      // 1. Revert original transaction effects (Safe for legacy and new data)
      if (wasOriginalBalanceAddition) {
        const amountToSubtract = Math.abs(oldIndividualDeduction);
        await User.updateMany(
          { _id: { $in: originalTransaction.sharedUsers } },
          { $inc: { balance: -amountToSubtract } },
          { session }
        );
        centralBalanceDoc.balance -= oldTotal;
      } else {
        const amountToAdd = Math.abs(oldIndividualDeduction);
        await User.updateMany(
          { _id: { $in: originalTransaction.sharedUsers } },
          { $inc: { balance: amountToAdd } },
          { session }
        );
        centralBalanceDoc.balance += oldTotal;
      }

      // 2. Prepare new transaction data
      let finalNewSharedUsers;
      let newIndividualDeduction;

      if (isNewBalanceTransaction) {
        finalNewSharedUsers = [requestingUserId];
        newIndividualDeduction = isNewBalanceAddition ? -totalPrice : totalPrice;
      } else {
        if (!sharedUsers?.length || !Array.isArray(sharedUsers)) throw new CustomError("At least one user must be selected for shopping transactions", 400);
        finalNewSharedUsers = [...new Set(sharedUsers.map(id => new mongoose.Types.ObjectId(id)))];
        newIndividualDeduction = totalPrice / finalNewSharedUsers.length;
      }

      const allNewInvolvedUserIds = [...new Set(finalNewSharedUsers.map(id => id.toString()).concat(requestingUserId.toString()))];
      const newUsers = await User.find({ _id: { $in: allNewInvolvedUserIds } }).session(session);
      if (!newUsers || newUsers.length !== allNewInvolvedUserIds.length) throw new CustomError("One or more invalid user IDs involved in transaction", 400);

      if (isNewBalanceRemoval) {
        const creatorUser = newUsers.find(u => u._id.toString() === requestingUserId.toString());
        if (!creatorUser || creatorUser.balance < totalPrice) {
          throw new CustomError(`Insufficient balance to remove ৳${totalPrice.toFixed(2)}.`, 400);
        }
      }

      // 3. Apply new transaction effects
      await User.updateMany(
        { _id: { $in: finalNewSharedUsers } },
        { $inc: { balance: -newIndividualDeduction } },
        { session }
      );

      if (isNewBalanceAddition) {
        centralBalanceDoc.balance += totalPrice;
      } else {
        centralBalanceDoc.balance -= totalPrice;
      }

      centralBalanceDoc.lastUpdated = Date.now();
      await centralBalanceDoc.save({ session });

      // 4. Update Snapshot
      const allUsersAfterTransaction = await User.find({}, "name balance").session(session);
      const updatedUsersBalancesAtTransactionTime = allUsersAfterTransaction.map((userDoc) => ({
        _id: userDoc._id,
        name: userDoc.name,
        balanceAtTime: userDoc.balance,
      }));

      // 5. Update transaction document
      originalTransaction.items = items;
      originalTransaction.sharedUsers = finalNewSharedUsers;
      originalTransaction.totalPrice = totalPrice;
      originalTransaction.centralBalanceAfter = centralBalanceDoc.balance;
      originalTransaction.individualDeduction = newIndividualDeduction;
      originalTransaction.edited = true;
      originalTransaction.usersBalancesAtTransactionTime = updatedUsersBalancesAtTransactionTime;
      originalTransaction.updatedAt = Date.now();
      await originalTransaction.save({ session });

      // 6. Update associated message
      const purchaser = await User.findById(requestingUserId).session(session);
      await Message.findOneAndUpdate(
        { transactionId: transactionId },
        {
          message: `${purchaser.name} ${isNewBalanceAddition ? "added" : isNewBalanceRemoval ? "removed" : "bought"} [${items
            .map((i) => `${i.itemName}: ৳${i.price.toFixed(2)}`)
            .join(", ")}]`,
          items,
          totalPrice,
          purchaser: requestingUserId,
          sharedUsers: finalNewSharedUsers,
          centralBalanceAfter: centralBalanceDoc.balance,
          individualDeduction: newIndividualDeduction,
        },
        { upsert: true, new: true, session }
      );

      await session.commitTransaction();

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

      // Check if this is the most recent transaction
      const latestTransaction = await Transaction.findOne().sort({ createdAt: -1 }).session(session);
      if (latestTransaction && latestTransaction._id.toString() !== id) {
        throw new CustomError("Only the most recent transaction can be deleted", 403);
      }

      const isBalanceAddition = transaction.items[0]?.itemName === "Balance Addition";
      const isBalanceRemoval = transaction.items[0]?.itemName === "Balance Removal";

      let centralBalanceDoc = await CentralBalance.findOne().session(session);
      if (!centralBalanceDoc) throw new CustomError("Central balance not found", 500);

      if (isBalanceAddition) {
        centralBalanceDoc.balance -= transaction.totalPrice;
        await User.findByIdAndUpdate(transaction.createdBy, { $inc: { balance: -transaction.totalPrice } }, { session });
      } else if (isBalanceRemoval) {
        centralBalanceDoc.balance += transaction.totalPrice;
        await User.findByIdAndUpdate(transaction.createdBy, { $inc: { balance: transaction.totalPrice } }, { session });
      } else {
        centralBalanceDoc.balance += transaction.totalPrice;
        await User.updateMany({ _id: { $in: transaction.sharedUsers } }, { $inc: { balance: transaction.individualDeduction } }, { session });
      }
      centralBalanceDoc.lastUpdated = Date.now();
      await centralBalanceDoc.save({ session });

      await Transaction.findByIdAndDelete(id, { session });
      await Message.deleteOne({ transactionId: id }, { session });

      await session.commitTransaction();
      res.status(200).json({ status: "success", message: "Transaction deleted successfully" });
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