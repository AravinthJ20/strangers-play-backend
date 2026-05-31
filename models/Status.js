const mongoose = require('mongoose');

const statusSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['text', 'image', 'mixed'], default: 'text' },
  text: { type: String, trim: true, default: '' },
  media: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMedia', default: null },
  background: { type: String, trim: true, default: '#17324f' },
  viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  createdAt: { type: Date, default: Date.now }
});

statusSchema.pre('validate', function () {
  const hasText = Boolean(this.text?.trim());
  const hasMedia = Boolean(this.media);

  if (!hasText && !hasMedia) {
    this.invalidate('text', 'A status requires text or media.');
  }

  if (hasText && hasMedia) {
    this.type = 'mixed';
  } else if (hasMedia) {
    this.type = 'image';
  } else {
    this.type = 'text';
  }
});

module.exports = mongoose.model('Status', statusSchema);
