const express = require('express');
const router = express.Router();
const UserController = require('../Controller/userController');
const authMiddleware = require('../Auth/authentication');

router.post('/signup', UserController.createUser);
router.post('/login', UserController.login);
router.post('/logout', UserController.logout);
router.get('/check-auth', UserController.checkAuth);

router.use(authMiddleware);

router.get('/', UserController.getAllUsers);
router.get('/me', UserController.getMe);
router.put('/me', UserController.updateMe);
router.post('/add-balance', UserController.addBalance);
router.patch('/add-balance/:id', UserController.adjustUserBalance);
router.patch('/remove-balance/:id', UserController.removeBalance);
router.put('/change-password', UserController.changePassword);
router.get('/:id', UserController.getUserById);
router.put('/:id', UserController.updateUser);
router.delete('/:id', UserController.deleteUser);

module.exports = router;