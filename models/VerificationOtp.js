const mongoose = require('mongoose');

const verificationOtpSchema = new mongoose.Schema({
  purpose: { type: String, enum: ['register', 'reset-password'], required: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  payload: {
    username: { type: String, trim: true, default: '' },
    password: { type: String, default: '' },
    inviteToken: { type: String, default: '' }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('VerificationOtp', verificationOtpSchema);
