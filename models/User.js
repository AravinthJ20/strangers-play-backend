const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  avatar: { type: String, default: '' },
  bio: { type: String, default: '', trim: true, maxlength: 280 },
  location: { type: String, default: '', trim: true, maxlength: 120 },
  interests: [{ type: String, trim: true }],
  online: { type: Boolean, default: false },
  socketId: { type: String },
  lastSeen: { type: Date },
  connections: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  connectionRequestsSent: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  connectionRequestsReceived: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  ignoredUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  rejectedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastConnectionDecisionReminderAt: { type: Date, default: null },
  pushSubscriptions: [{
    endpoint: { type: String, required: true },
    expirationTime: { type: Date, default: null },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true }
    },
    createdAt: { type: Date, default: Date.now }
  }],
  tokens: [{ token: { type: String, required: true } }],
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
