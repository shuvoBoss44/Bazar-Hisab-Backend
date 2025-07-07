require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const app = express();
const cookieParser = require("cookie-parser");
const cors = require("cors");
const userRoutes = require("./Routes/userRoutes");
const transactionRoutes = require("./Routes/transactionRoutes");
const messageRoutes = require("./Routes/messageRoutes");

// Connect to database and start server
mongoose
    .connect(process.env.DB, { serverSelectionTimeoutMS: 30000, bufferCommands: false })
    .then(() => console.log("Database Connected"))
    .catch((error) => console.error("MongoDB connection error:", error.message));

console.log("Starting server after DB connection attempt...");

// Middleware
app.use(cookieParser());
app.use(cors({
    origin: process.env.CLIENT_URL || "https://bazar-hisab-bsm.vercel.app",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// Routes
app.use("/api/users", userRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/messages", messageRoutes);

// Health check
app.get("/health", (req, res) => {
    res.status(200).json({ status: "success", message: "Server is running" });
});

// Global error handler
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const status = err.status || "error";

    res.status(statusCode).json({
        status,
        message: err.message || "Internal server error",
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(
        `Server is running on port ${PORT} at ${new Date().toLocaleString(
            "en-US",
            { timeZone: "Asia/Dhaka" }
        )}`
    );
});