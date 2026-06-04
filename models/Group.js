const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  avatar: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

groupSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('Group', groupSchema);
