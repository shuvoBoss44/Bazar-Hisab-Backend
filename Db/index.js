const mongoose = require("mongoose");

const ConnectDB = async function () {
    try {
        await mongoose.connect(process.env.DB);
        console.log("Database Connected");
    } catch (error) {
        console.error("MongoDB connection error:", error.message);
    }

    mongoose.connection.on("error", (err) => {
        console.error("MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
        console.log("MongoDB disconnected, attempting to reconnect...");
    });
};

module.exports = ConnectDB;