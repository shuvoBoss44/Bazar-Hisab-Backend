const mongoose = require("mongoose");

const ConnectDB = async function () {
    try {
        await mongoose.connect(process.env.DB)
        console.log("Database Connected")
    } catch (error) {
        console.log(error)
    }
}

module.exports = ConnectDB;