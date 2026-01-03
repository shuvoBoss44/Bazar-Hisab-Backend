const express = require("express");
const router = express.Router();
const TransactionController = require("../Controller/TransactionController");
const authMiddleware = require("../Auth/authentication");

router.use(authMiddleware);

router.route("/")
    .post(TransactionController.createTransaction)
    .get(TransactionController.getAllTransactions);

router.route("/:id")
    .get(TransactionController.getTransactionById)
    .put(TransactionController.updateTransaction)
    .patch(TransactionController.updateTransaction)
    .delete(TransactionController.deleteTransaction);

router.route("/central")
    .get(TransactionController.getCentralBalance);

module.exports = router;