// src/routes/auth.js
const express = require('express');
const router = express.Router();
const { register, login, sendSMSOTP, sendEmailOTP, verifyOTP } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/otp/sms', sendSMSOTP);
router.post('/otp/email', sendEmailOTP);
router.post('/otp/verify', verifyOTP);

module.exports = router;
