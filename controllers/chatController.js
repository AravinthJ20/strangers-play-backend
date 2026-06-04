const Message = require('../models/Message');
const Group = require('../models/Group');
const User = require('../models/User');
const ChatMedia = require('../models/ChatMedia');
const { uploadMediaBuffer } = require('../utils/mediaStorage');

const isConnected = async (userId, otherUserId) => {
  const user = await User.findById(userId).select('connections');
  return user?.connections.some((entry) => entry.toString() === otherUserId.toString());
};

const populateMessageDetails = (query) => query.populate('sender', 'username avatar').populate('attachments');

const parsePagination = (query) => {
  const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 100);
  const before = query.before ? new Date(query.before) : null;
  return {
    limit,
    before: before && !Number.isNaN(before.getTime()) ? before : null
  };
};

const canAccessMessage = async (message, userId) => {
  if (!message) return false;

  if (message.group) {
    const group = await Group.findOne({ _id: message.group, members: userId }).select('_id');
    return Boolean(group);
  }

  if (!message.recipient) return false;
  return [message.sender.toString(), message.recipient.toString()].includes(userId.toString());
};

const sanitizeDeletedMessage = (message) => {
  message.content = '';
  message.sticker = '';
  message.attachments = [];
  message.location = undefined;
  message.type = 'text';
  message.editedAt = null;
};

exports.uploadMedia = async (req, res) => {
  try {
    const { fileName, mimeType, dataUrl } = req.body;
    if (!fileName || !mimeType || !dataUrl) {
      return res.status(400).json({ error: 'Missing upload data' });
    }

    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid file payload' });
    }

    const [, encodedMimeType, base64Data] = match;
    if (encodedMimeType !== mimeType) {
      return res.status(400).json({ error: 'MIME type mismatch' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const category = mimeType.startsWith('image/') ? 'image' : 'file';
    const storedFile = await uploadMediaBuffer({
      fileName,
      mimeType,
      buffer,
      category
    });

    const media = await ChatMedia.create({
      owner: req.user._id,
      storageType: storedFile.storageType,
      bucketType: storedFile.bucketType || storedFile.storageType,
      storageId: storedFile.storageId,
      fileName: storedFile.fileName,
      originalName: fileName,
      mimeType: storedFile.mimeType,
      size: buffer.length,
      storagePath: storedFile.storagePath,
      publicUrl: storedFile.publicUrl,
      category
    });

    res.status(201).json(media);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getChats = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).select('connections');
    const allowedConnectionIds = new Set(currentUser.connections.map((entry) => entry.toString()));

    const individualChats = await Message.aggregate([
      { $match: { $or: [{ sender: req.user._id }, { recipient: req.user._id }], group: { $exists: false } } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: { $cond: [{ $eq: ['$sender', req.user._id] }, '$recipient', '$sender'] }, lastMessage: { $first: '$$ROOT' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { _id: '$user._id', username: '$user.username', avatar: '$user.avatar', online: '$user.online', lastSeen: '$user.lastSeen', lastMessage: 1 } }
    ]).then((items) => items.filter((item) => allowedConnectionIds.has(item._id.toString())));

    const groups = await Group.find({ members: req.user._id }).lean();
    const groupChats = await Promise.all(groups.map(async (group) => {
      const lastMessage = await Message.findOne({ group: group._id }).sort({ timestamp: -1 }).populate('sender', 'username avatar').lean();
      return { _id: group._id, name: group.name, avatar: group.avatar, group: true, members: group.members, lastMessage };
    }));

    const chats = [...individualChats, ...groupChats].sort((a, b) => {
      const aTime = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
      const bTime = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
      return bTime - aTime;
    });

    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPersonalMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const connected = await isConnected(req.user._id, userId);
    if (!connected) {
      return res.status(403).json({ error: 'Direct chat is only available for accepted connections' });
    }

    const { limit, before } = parsePagination(req.query);
    const filter = {
      $or: [
        { sender: req.user._id, recipient: userId },
        { sender: userId, recipient: req.user._id }
      ],
      group: { $exists: false }
    };

    if (before) {
      filter.timestamp = { $lt: before };
    }

    const messages = await populateMessageDetails(
      Message.find(filter)
        .sort({ timestamp: -1, _id: -1 })
        .limit(limit + 1)
    );

    const hasMore = messages.length > limit;
    const pagedMessages = (hasMore ? messages.slice(0, limit) : messages).reverse();
    const nextCursor = hasMore ? pagedMessages[0]?.timestamp || null : null;

    res.json({
      messages: pagedMessages,
      pageInfo: {
        hasMore,
        nextCursor
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (!message.readBy.includes(req.user._id)) message.readBy.push(req.user._id);
    await message.save();
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.editMessage = async (req, res) => {
  try {
    const { content } = req.body;
    const trimmedContent = (content || '').trim();
    const message = await Message.findById(req.params.messageId);

    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the sender can edit this message' });
    }
    if (message.isDeleted || message.type === 'call' || message.type === 'location' || message.location) {
      return res.status(400).json({ error: 'This message cannot be edited' });
    }
    if (!trimmedContent && (!Array.isArray(message.attachments) || message.attachments.length === 0) && !message.sticker) {
      return res.status(400).json({ error: 'Message content cannot be empty' });
    }

    message.content = trimmedContent;
    message.editedAt = new Date();
    await message.save();

    const updatedMessage = await populateMessageDetails(Message.findById(message._id));
    res.json(updatedMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);

    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the sender can delete this message' });
    }
    if (message.type === 'call') {
      return res.status(400).json({ error: 'Call history cannot be deleted' });
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    message.reactions = [];
    sanitizeDeletedMessage(message);
    await message.save();

    const updatedMessage = await populateMessageDetails(Message.findById(message._id));
    res.json(updatedMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.reactToMessage = async (req, res) => {
  try {
    const { value } = req.body;
    if (!['like', 'dislike'].includes(value)) {
      return res.status(400).json({ error: 'Invalid reaction' });
    }

    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const canAccess = await canAccessMessage(message, req.user._id);
    if (!canAccess) return res.status(403).json({ error: 'Not authorized to react to this message' });
    if (message.isDeleted || message.type === 'call') {
      return res.status(400).json({ error: 'This message cannot be reacted to' });
    }

    const existingReaction = message.reactions.find((reaction) => reaction.user.toString() === req.user._id.toString());
    if (existingReaction?.value === value) {
      message.reactions = message.reactions.filter((reaction) => reaction.user.toString() !== req.user._id.toString());
    } else if (existingReaction) {
      existingReaction.value = value;
    } else {
      message.reactions.push({ user: req.user._id, value });
    }

    await message.save();

    const updatedMessage = await populateMessageDetails(Message.findById(message._id));
    res.json(updatedMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
