const jwt = require("jsonwebtoken");
const CustomError = require("../Controller/customError");
const User = require("../models/UserSchema");
const { promisify } = require('util');

const authMiddleware = async (req, res, next) => {
    try {
        if (!process.env.JWT_SECRET) {
            throw new CustomError("Server configuration error", 500);
        }

        const token = req.cookies?.token;
        if (!token) {
            throw new CustomError("Authentication required", 401);
        }

        const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.id).select("name email balance");
        if (!user) {
            throw new CustomError("User not found", 401);
        }

        req.user = user;
        next();
    } catch (err) {
        const statusCode = err.name === "TokenExpiredError" ? 401 :
            err.name === "JsonWebTokenError" ? 401 :
                err.statusCode || 500;
        next(new CustomError(err.message || "Authentication failed", statusCode));
    }
};

module.exports = authMiddleware;