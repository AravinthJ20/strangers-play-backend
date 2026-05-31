const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/register/request-otp', authController.requestRegistrationOtp);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/forgot-password/request-otp', authController.requestPasswordResetOtp);
router.post('/forgot-password/reset', authController.resetPassword);
router.post('/invite', require('../utils/auth'), authController.sendInvite);
router.post('/logout', require('../utils/auth'), authController.logout);
router.get('/invite/:inviteToken', authController.validateInvite);
router.get('/me', require('../utils/auth'), authController.getMe);

module.exports = router;
