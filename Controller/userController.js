const User = require("../models/UserSchema");
const CentralBalance = require("../models/CentralBalanceSchema");
const CustomError = require("../Controller/customError");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Transaction = require("../models/TransactionSchema");

class UserController {
    static async createUser(req, res, next) {
        try {
            const { name, email, password } = req.body;
            if (!name?.trim() || !email?.trim() || !password) {
                throw new CustomError("Name, email, and password are required", 400);
            }
            if (password.length < 6) {
                throw new CustomError("Password must be at least 6 characters", 400);
            }

            const normalizedEmail = email.toLowerCase().trim();
            const existingUser = await User.findOne({ email: normalizedEmail });
            if (existingUser) {
                throw new CustomError("Email already exists", 400);
            }

            const user = await User.create({
                name: name.trim(),
                email: normalizedEmail,
                password,
                balance: 0,
                // Consider adding a default 'role' field here, e.g., role: 'user'
            });

            res.status(201).json({
                status: "success",
                data: {
                    user: {
                        id: user._id,
                        name: user.name,
                        email: user.email,
                        balance: user.balance
                    }
                }
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to create user", 500));
        }
    }

    static async getAllUsers(req, res, next) {
        try {
            const users = await User.find().select("name email balance role");
            res.status(200).json({
                status: "success",
                results: users.length,
                data: users.map(user => ({
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    balance: user.balance,
                    role: user.role
                }))
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to fetch users", 500));
        }
    }

    static async getUserById(req, res, next) {
        try {
            const { id } = req.params;
            if (!mongoose.isValidObjectId(id)) {
                throw new CustomError("Invalid user ID", 400);
            }
            const user = await User.findById(id).select("name email balance role");
            if (!user) {
                throw new CustomError("User not found", 404);
            }
            res.status(200).json({
                status: "success",
                data: {
                    user: {
                        id: user._id,
                        name: user.name,
                        email: user.email,
                        balance: user.balance,
                        role: user.role
                    }
                }
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to fetch user", 500));
        }
    }

    static async updateUser(req, res, next) {
        try {
            const { id } = req.params;
            const { name, email, role } = req.body;
            if (!mongoose.isValidObjectId(id)) {
                throw new CustomError("Invalid user ID", 400);
            }
            if (!name?.trim() && !email?.trim() && !role) {
                throw new CustomError("Name, email, or role required for update", 400);
            }

            const updateData = {};
            if (name?.trim()) updateData.name = name.trim();
            if (email?.trim()) updateData.email = email.toLowerCase().trim();
            if (role) updateData.role = role;

            const updatedUser = await User.findByIdAndUpdate(id, updateData, {
                new: true,
                runValidators: true,
                select: "name email balance role"
            });

            if (!updatedUser) {
                throw new CustomError("User not found", 404);
            }

            res.status(200).json({
                status: "success",
                data: {
                    user: {
                        id: updatedUser._id,
                        name: updatedUser.name,
                        email: updatedUser.email,
                        balance: updatedUser.balance,
                        role: updatedUser.role
                    }
                }
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to update user", 500));
        }
    }

    static async getMe(req, res, next) {
        try {
            const user = req.user;
            if (!user) {
                throw new CustomError("Authenticated user not found", 404);
            }
            res.status(200).json({
                status: "success",
                data: {
                    user: {
                        id: user._id,
                        name: user.name,
                        email: user.email,
                        balance: user.balance,
                        role: user.role,
                        createdAt: user.createdAt,
                    }
                }
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to fetch user data", 500));
        }
    }

    static async addBalance(req, res, next) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { amount } = req.body;
            const user = req.user; // Authenticated user

            if (isNaN(Number(amount)) || Number(amount) <= 0) {
                throw new CustomError("Amount must be a positive number", 400);
            }

            // Fetch the user's current balance BEFORE updating it
            const currentUser = await User.findById(user._id).session(session);
            if (!currentUser) {
                throw new CustomError("Authenticated user not found.", 404);
            }
            const balanceBeforeAddition = currentUser.balance; // Store this value

            let centralBalanceDoc = await CentralBalance.findOne().session(session);
            if (!centralBalanceDoc) {
                centralBalanceDoc = await CentralBalance.create(
                    [{ balance: 0, lastUpdated: Date.now() }],
                    { session }
                )[0];
            }

            const updatedUser = await User.findByIdAndUpdate(
                user._id,
                { $inc: { balance: Number(amount) } },
                { new: true, session }
            );

            centralBalanceDoc.balance += Number(amount);
            centralBalanceDoc.lastUpdated = Date.now();
            await centralBalanceDoc.save({ session });

            // --- MOVED LOGIC FOR usersBalancesAtTransactionTime BEFORE Transaction.create ---
            const allUsersAfterTransaction = await User.find({}, 'name balance').session(session);
            const usersBalancesAtTransactionTime = allUsersAfterTransaction.map(userDoc => ({
                _id: userDoc._id,
                name: userDoc.name,
                balanceAtTime: userDoc.balance
            }));
            // --- END MOVED LOGIC ---

            const [transaction] = await Transaction.create(
                [{
                    items: [{ itemName: "Balance Addition", price: Number(amount) }],
                    createdBy: user._id,
                    sharedUsers: [user._id],
                    totalPrice: Number(amount),
                    centralBalanceAfter: centralBalanceDoc.balance,
                    individualDeduction: Number(amount),
                    userBalanceBeforeTransaction: balanceBeforeAddition,
                    usersBalancesAtTransactionTime: usersBalancesAtTransactionTime // This is now defined
                }],
                { session }
            );

            await session.commitTransaction();

            const finalTransaction = await Transaction.findById(transaction._id)
                .populate("createdBy sharedUsers")
                .session(null);

            res.status(200).json({
                status: "success",
                data: {
                    user: {
                        id: updatedUser._id,
                        name: updatedUser.name,
                        email: updatedUser.email,
                        balance: updatedUser.balance
                    },
                    centralBalance: centralBalanceDoc.balance,
                    transaction: finalTransaction
                }
            });
        } catch (err) {
            await session.abortTransaction();
            next(err.statusCode ? err : new CustomError(err.message || "Failed to add balance", 500));
        } finally {
            session.endSession();
        }
    }

    static async adjustUserBalance(req, res, next) {
        // Start a new session for the transaction
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { id: targetUserId } = req.params;
            const { amount, reason } = req.body; // Added 'reason' as it's used in the response message
            const requestingUser = req.user;

            // 1. Basic input validation
            if (!mongoose.isValidObjectId(targetUserId)) {
                throw new CustomError("Invalid target user ID provided.", 400);
            }
            if (amount === undefined || isNaN(Number(amount))) {
                throw new CustomError("Please provide a valid numeric amount for adjustment.", 400);
            }

            const numericAmount = Number(amount);

            // 2. Find target user within the session
            const targetUser = await User.findById(targetUserId).session(session);

            // Ensure targetUser exists and has a balance property
            if (!targetUser) {
                throw new CustomError("Target user not found.", 404);
            }
            // Check if balance property exists, if not, initialize it to 0
            if (typeof targetUser.balance === 'undefined' || targetUser.balance === null) {
                targetUser.balance = 0;
            }

            const balanceBeforeAdjustment = targetUser.balance;

            // 3. Update user balance
            const updatedUser = await User.findByIdAndUpdate(
                targetUserId,
                { $inc: { balance: numericAmount } },
                { new: true, session }
            );

            // If updatedUser somehow becomes null/undefined after findByIdAndUpdate
            if (!updatedUser) {
                throw new CustomError("Failed to update user balance. User not found after update attempt.", 500);
            }

            // 4. Update Central Balance
            let centralBalanceDoc = await CentralBalance.findOne().session(session);
            if (!centralBalanceDoc) {
                // If no central balance document exists, create one
                // Ensure CentralBalance.create returns a single document or an array
                const newCentralBalanceDocs = await CentralBalance.create(
                    [{ balance: 0, lastUpdated: Date.now() }],
                    { session }
                );
                centralBalanceDoc = newCentralBalanceDocs[0]; // Assuming create returns an array
            }
            centralBalanceDoc.balance += numericAmount;
            centralBalanceDoc.lastUpdated = Date.now();
            await centralBalanceDoc.save({ session });

            // 5. Capture all user balances at transaction time (within the session)
            const allUsersAfterTransaction = await User.find({}, 'name balance').session(session);
            const usersBalancesAtTransactionTime = allUsersAfterTransaction.map(userDoc => ({
                _id: userDoc._id,
                name: userDoc.name,
                balanceAtTime: userDoc.balance
            }));

            // 6. Create Transaction record
            const transactionType = numericAmount > 0 ? "Balance Addition" : "Balance Removal";
            const [transaction] = await Transaction.create(
                [{
                    items: [{ itemName: transactionType, price: Math.abs(numericAmount) }],
                    createdBy: requestingUser._id,
                    sharedUsers: [targetUserId],
                    totalPrice: numericAmount, // Keep original amount for total price
                    centralBalanceAfter: centralBalanceDoc.balance,
                    individualDeduction: numericAmount, // This seems to be the amount itself
                    userBalanceBeforeTransaction: balanceBeforeAdjustment,
                    usersBalancesAtTransactionTime: usersBalancesAtTransactionTime
                }],
                { session }
            );

            // Commit the transaction after all session-dependent operations are complete
            await session.commitTransaction();

            // 7. Fetch the final transaction details (without the session, as it's committed)
            // Use .populate after the transaction is committed if you need populated fields.
            const finalTransaction = await Transaction.findById(transaction._id)
                .populate("createdBy sharedUsers"); // Removed .session(null) as it's default behavior outside a session

            const action = numericAmount > 0 ? "added to" : "deducted from";
            res.status(200).json({
                status: "success",
                message: `${Math.abs(numericAmount).toFixed(2)} ৳ successfully ${action} ${updatedUser.name}'s balance. Reason: ${reason || 'N/A'}.`,
                data: {
                    user: {
                        id: updatedUser._id,
                        name: updatedUser.name,
                        email: updatedUser.email,
                        balance: updatedUser.balance
                    },
                    centralBalance: centralBalanceDoc.balance,
                    transaction: finalTransaction
                }
            });
        } catch (err) {
            // Abort transaction in case of any error
            await session.abortTransaction();
            console.error("Error during user balance adjustment:", err);
            next(err.statusCode ? err : new CustomError(err.message || "Failed to adjust user balance due to an unexpected error.", 500));
        } finally {
            // End the session regardless of success or failure
            session.endSession();
        }
    }

    static async removeBalance(req, res, next) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { id: targetUserId } = req.params;
            const { amount } = req.body;
            const requestingUser = req.user;

            if (!mongoose.isValidObjectId(targetUserId)) {
                throw new CustomError("Invalid target user ID provided.", 400);
            }
            const targetUser = await User.findById(targetUserId).session(session);
            if (!targetUser) {
                throw new CustomError("Target user not found.", 404);
            }

            if (targetUser.balance < Number(amount)) {
                throw new CustomError(`Insufficient balance for user ${targetUser.name} to remove ${Number(amount).toFixed(2)} ৳. Current balance: ${targetUser.balance.toFixed(2)} ৳.`, 400);
            }

            const balanceBeforeRemoval = targetUser.balance; // Store this value

            let centralBalanceDoc = await CentralBalance.findOne().session(session);
            if (!centralBalanceDoc) {
                throw new CustomError("Central balance document not found. Please contact support.", 500);
            }

            const updatedUser = await User.findByIdAndUpdate(
                targetUserId,
                { $inc: { balance: -Number(amount) } },
                { new: true, session }
            );

            centralBalanceDoc.balance -= Number(amount);
            centralBalanceDoc.lastUpdated = Date.now();
            await centralBalanceDoc.save({ session });

            // --- MOVED LOGIC FOR usersBalancesAtTransactionTime BEFORE Transaction.create ---
            const allUsersAfterTransaction = await User.find({}, 'name balance').session(session);
            const usersBalancesAtTransactionTime = allUsersAfterTransaction.map(userDoc => ({
                _id: userDoc._id,
                name: userDoc.name,
                balanceAtTime: userDoc.balance
            }));
            // --- END MOVED LOGIC ---

            const [transaction] = await Transaction.create(
                [{
                    items: [{ itemName: "Balance Removal", price: Number(amount) }],
                    createdBy: requestingUser._id,
                    sharedUsers: [targetUserId],
                    totalPrice: -Number(amount), // Store as negative for removal in totalPrice
                    centralBalanceAfter: centralBalanceDoc.balance,
                    individualDeduction: -Number(amount), // Store as negative
                    userBalanceBeforeTransaction: balanceBeforeRemoval,
                    usersBalancesAtTransactionTime: usersBalancesAtTransactionTime // This is now defined
                }],
                { session }
            );

            await session.commitTransaction();

            const finalTransaction = await Transaction.findById(transaction._id)
                .populate("createdBy sharedUsers")
                .session(null);

            res.status(200).json({
                status: "success",
                message: `${Number(amount).toFixed(2)} ৳ successfully removed from ${updatedUser.name}'s balance.`,
                data: {
                    user: {
                        id: updatedUser._id,
                        name: updatedUser.name,
                        email: updatedUser.email,
                        balance: updatedUser.balance
                    },
                    centralBalance: centralBalanceDoc.balance,
                    transaction: finalTransaction
                }
            });
        } catch (err) {
            await session.abortTransaction();
            console.error("Error during balance removal:", err);
            next(err.statusCode ? err : new CustomError(err.message || "Failed to remove balance due to an unexpected error.", 500));
        } finally {
            session.endSession();
        }
    }

    static async changePassword(req, res, next) {
        try {
            const { currentPassword, newPassword } = req.body;
            if (!currentPassword || !newPassword) {
                throw new CustomError("Both current and new passwords are required", 400);
            }
            if (newPassword.length < 6) {
                throw new CustomError("New password must be at least 6 characters", 400);
            }

            const userDoc = await User.findById(req.user._id).select("+password");
            if (!userDoc) {
                throw new CustomError("User not found", 404);
            }

            const isMatch = await bcrypt.compare(currentPassword, userDoc.password);
            if (!isMatch) {
                throw new CustomError("Current password is incorrect", 401);
            }

            userDoc.password = newPassword;
            await userDoc.save();

            res.status(200).json({
                status: "success",
                message: "Password changed successfully"
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to change password", 500));
        }
    }

    static async deleteUser(req, res, next) {
        try {
            const { id } = req.params;
            if (!mongoose.isValidObjectId(id)) {
                throw new CustomError("Invalid user ID", 400);
            }

            const user = await User.findById(id);
            if (!user) {
                throw new CustomError("User not found", 404);
            }

            const transactions = await Transaction.find({
                $or: [
                    { createdBy: id },
                    { sharedUsers: id }
                ]
            });
            if (transactions.length > 0) {
                throw new CustomError("Cannot delete user with existing transactions. Please clear associated transactions first.", 400);
            }

            await User.findByIdAndDelete(id);
            res.status(200).json({
                status: "success",
                message: "User deleted successfully"
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to delete user", 500));
        }
    }

    static async login(req, res, next) {
        try {
            const { email, password } = req.body;
            const user = await User.findOne({ email: email }).select("+password");

            if (!user) {
                throw new CustomError("Invalid email or password", 401);
            }
            // Password is hashed, use bcrypt
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                throw new CustomError("Invalid email or password", 401);
            }

            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
                expiresIn: process.env.JWT_EXPIRES_IN || "15d",
            });

            const isProduction = process.env.NODE_ENV === "production";
            res.cookie("token", token, {
                httpOnly: true,
                secure: isProduction, // true in production, false in dev
                sameSite: isProduction ? "none" : "lax", // 'none' for cross-site (prod), 'lax' for local
                maxAge: 15 * 24 * 60 * 60 * 1000,
            });

            res.status(200).json({
                status: "success",
                data: {
                    isAuthenticated: true,
                    user: {
                        id: user._id,
                        name: user.name,
                        email: user.email,
                        balance: user.balance,
                        role: user.role,
                        createdAt: user.createdAt,
                    },
                },
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Login failed", 500));
        }
    }

    static async logout(req, res, next) {
        try {
            const isProduction = process.env.NODE_ENV === "production";
            res.clearCookie("token", {
                httpOnly: true,
                secure: isProduction,
                sameSite: isProduction ? "none" : "lax",
            });
            res.status(200).json({
                status: "success",
                message: "Logged out successfully"
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Logout failed", 500));
        }
    }

    static async checkAuth(req, res, next) {
        try {
            if (req.user) {
                return res.status(200).json({
                    status: "success",
                    data: {
                        isAuthenticated: true,
                        user: {
                            id: req.user._id,
                            name: req.user.name,
                            email: req.user.email,
                            balance: req.user.balance,
                            role: req.user.role,
                            createdAt: req.user.createdAt,
                        },
                    },
                });
            }

            if (!req.cookies?.token || !process.env.JWT_SECRET) {
                return res.status(200).json({
                    status: "success",
                    data: { isAuthenticated: false, user: null },
                });
            }

            const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select("name email balance role");

            res.status(200).json({
                status: "success",
                data: {
                    isAuthenticated: !!user,
                    user: user
                        ? {
                            id: user._id,
                            name: user.name,
                            email: user.email,
                            balance: user.balance,
                            role: user.role,
                            createdAt: user.createdAt,
                        }
                        : null,
                },
            });
        } catch (err) {
            res.status(200).json({
                status: "success",
                data: { isAuthenticated: false, user: null },
            });
        }
    }

    static async updateMe(req, res, next) {
        try {
            const { name, email } = req.body;
            const user = req.user;

            if (!name?.trim() && !email?.trim()) {
                throw new CustomError("Name or email required for update", 400);
            }

            const updateData = {};
            if (name?.trim()) updateData.name = name.trim();
            if (email?.trim()) {
                const normalizedEmail = email.toLowerCase().trim();
                const existingUser = await User.findOne({ email: normalizedEmail });
                if (existingUser && existingUser._id.toString() !== user._id.toString()) {
                    throw new CustomError("Email already exists", 400);
                }
                updateData.email = normalizedEmail;
            }

            const updatedUser = await User.findByIdAndUpdate(user._id, updateData, {
                new: true,
                runValidators: true,
                select: "name email balance role"
            });

            res.status(200).json({
                status: "success",
                data: {
                    user: {
                        id: updatedUser._id,
                        name: updatedUser.name,
                        email: updatedUser.email,
                        balance: updatedUser.balance,
                        role: updatedUser.role
                    }
                }
            });
        } catch (err) {
            next(err.statusCode ? err : new CustomError(err.message || "Failed to update user", 500));
        }
    }
}

module.exports = UserController;