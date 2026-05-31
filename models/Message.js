const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  value: { type: String, enum: ['like', 'dislike'], required: true }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  content: { type: String, default: '', trim: true },
  type: { type: String, enum: ['text', 'image', 'file', 'sticker', 'mixed', 'call', 'location'], default: 'text' },
  sticker: { type: String, trim: true, default: '' },
  attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ChatMedia' }],
  location: {
    latitude: { type: Number },
    longitude: { type: Number },
    label: { type: String, trim: true, default: '' },
    mapUrl: { type: String, trim: true, default: '' }
  },
  callDetails: {
    mode: { type: String, enum: ['voice', 'video'] },
    status: { type: String, enum: ['completed', 'missed', 'rejected', 'cancelled'] },
    durationSeconds: { type: Number, default: 0 },
    startedAt: { type: Date },
    endedAt: { type: Date }
  },
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  timestamp: { type: Date, default: Date.now },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  readAt: { type: Date },
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  editedAt: { type: Date, default: null },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  reactions: { type: [reactionSchema], default: [] }
});

messageSchema.pre('validate', function () {
  const hasContent = Boolean(this.content?.trim());
  const hasSticker = Boolean(this.sticker?.trim());
  const hasAttachments = Array.isArray(this.attachments) && this.attachments.length > 0;
  const hasCallDetails = Boolean(this.callDetails?.mode && this.callDetails?.status);
  const hasLocation = Number.isFinite(this.location?.latitude) && Number.isFinite(this.location?.longitude);

  if (!hasContent && !hasSticker && !hasAttachments && !hasCallDetails && !hasLocation) {
    this.invalidate('content', 'A message requires text, sticker, or attachment');
  }
});

module.exports = mongoose.model('Message', messageSchema);
