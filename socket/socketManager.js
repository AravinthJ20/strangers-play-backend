const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Group = require('../models/Group');
const ChatMedia = require('../models/ChatMedia');
const { sendPushNotification } = require('../utils/push');
const JWT_SECRET = process.env.JWT_SECRET || 'green-lynk-secret';
  // const crypto=require("crypto")
  // const getSecretRoomId=({Id})=>{
  //  return crypto.createHash("sha256").update([Id].sort().join('_')).digest("hex")
  // }
const hasConnection = async (userId, otherUserId) => {
  const user = await User.findById(userId).select('connections');
  return user?.connections.some((entry) => entry.toString() === otherUserId.toString());
};

const determineMessageType = ({ content, sticker, attachments, location }) => {
  const hasContent = Boolean(content?.trim());
  const hasSticker = Boolean(sticker?.trim());
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const hasLocation = Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);

  if (hasLocation) return 'location';
  if (hasSticker) return 'sticker';
  if (hasAttachments && hasContent) return 'mixed';
  if (hasAttachments) {
    return attachments.every((entry) => entry.category === 'image') ? 'image' : 'file';
  }

  return 'text';
};

const hydrateAttachments = async (attachmentIds, ownerId) => {
  if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) return [];

  const attachments = await ChatMedia.find({
    _id: { $in: attachmentIds },
    owner: ownerId
  });

  if (attachments.length !== attachmentIds.length) {
    throw new Error('Some attachments are invalid');
  }

  return attachments;
};

const populateMessageDetails = async (message) => {
  await message.populate([
    { path: 'sender', select: 'username avatar' },
    { path: 'mentions', select: 'username avatar' },
    { path: 'attachments' }
  ]);

  return message;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveMentions = (content, groupMembers, requestedMentionIds, senderId) => {
  if (!content?.trim() || !Array.isArray(groupMembers) || groupMembers.length === 0) return [];

  const requestedIds = new Set((Array.isArray(requestedMentionIds) ? requestedMentionIds : []).map((entry) => entry.toString()));

  return groupMembers
    .filter((member) => {
      const memberId = member._id.toString();
      if (memberId === senderId.toString()) return false;
      if (!requestedIds.has(memberId)) return false;
      const mentionPattern = new RegExp(`(^|\\s)@${escapeRegExp(member.username)}(?=[\\s,!.?:;]|$)`, 'i');
      return mentionPattern.test(content);
    })
    .map((member) => member._id);
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

const emitMessageMutation = (io, message, eventName, payload) => {
  if (message.group) {
    io.to(message.group.toString()).emit(eventName, payload);
    return;
  }

  if (message.recipient) {
    io.to(message.sender.toString()).emit(eventName, payload);
    io.to(message.recipient.toString()).emit(eventName, payload);
  }
};

const buildCallSummary = (callDetails) => {
  const modeLabel = callDetails.mode === 'video' ? 'Video' : 'Voice';
  if (callDetails.status === 'completed') {
    const durationLabel = callDetails.durationSeconds > 0 ? ` (${callDetails.durationSeconds}s)` : '';
    return `${modeLabel} call completed${durationLabel}`;
  }
  if (callDetails.status === 'rejected') return `${modeLabel} call rejected`;
  if (callDetails.status === 'cancelled') return `${modeLabel} call cancelled`;
  return `${modeLabel} call missed`;
};

const createCallHistoryMessage = async ({ callerId, recipientId, mode, status, startedAt, endedAt }) => {
  const durationSeconds =
    startedAt && endedAt && status === 'completed'
      ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
      : 0;

  const message = new Message({
    sender: callerId,
    recipient: recipientId,
    type: 'call',
    content: buildCallSummary({ mode, status, durationSeconds }),
    callDetails: {
      mode,
      status,
      durationSeconds,
      startedAt,
      endedAt
    },
    status: 'read',
    readBy: [callerId, recipientId]
  });

  await message.save();
  return populateMessageDetails(message);
};

const serializeCallParticipant = (participant) => ({
  _id: participant._id.toString(),
  username: participant.username,
  avatar: participant.avatar || ''
});

module.exports = (io) => {
  const activeCalls = new Map();
  const activeGroupCalls = new Map();

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) throw new Error('Authentication error');

      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findOne({ _id: decoded._id, 'tokens.token': token });
      if (!user) throw new Error('Authentication error');

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    await User.findByIdAndUpdate(user._id, { online: true, socketId: socket.id, lastSeen: new Date() });

    socket.join(user._id.toString());

    io.emit('user-status', { userId: user._id.toString(), online: true, lastSeen: new Date() });

    socket.on('join-group', async (groupId) => {
      const group = await Group.findById(groupId);
      if (group && group.members.some((member) => member.toString() === user._id.toString())) {
        socket.join(groupId);
      }
    });

    socket.on('personal-message', async ({ recipientId, content = '', tempId, attachmentIds = [], sticker = '', location = null }) => {
    
    console.log('Received personal-message event:', { recipientId, content, tempId, attachmentIds, sticker, location });
      if (!(await hasConnection(user._id, recipientId))) {
        socket.emit('message-error', { tempId, error: 'You can only message accepted connections.' });
        return;
      }

      let attachments = [];
      try {
        attachments = await hydrateAttachments(attachmentIds, user._id);
      } catch (error) {
        socket.emit('message-error', { tempId, error: error.message });
        return;
      }

      const message = new Message({
        sender: user._id,
        recipient: recipientId,
        content,
        sticker,
        location,
        attachments: attachments.map((entry) => entry._id),
        type: determineMessageType({ content, sticker, attachments, location }),
        status: 'sent'
      });
      await message.save();
      const populatedMessage = await populateMessageDetails(message);

      const recipient = await User.findById(recipientId);
      const delivered = recipient?.socketId;
      if (delivered) {
        message.status = 'delivered';
        message.deliveredTo = [recipient._id];
        await message.save();
      }

      io.to(recipientId).emit('new-message', populatedMessage);
      socket.emit('message-sent', { tempId, messageId: message._id.toString(), message: populatedMessage });
      await sendPushNotification(recipient, {
        title: user.username,
        body: content || sticker || (location ? 'Shared a location' : (attachments.length > 0 ? 'Sent an attachment' : 'New message')),
        tag: `message-${message._id}`,
        url: '/chat'
      });
      if (delivered) {
        socket.emit('message-delivered', { messageId: message._id, status: 'delivered' });
      }
    });

    socket.on('group-message', async ({ groupId, content = '', tempId, attachmentIds = [], sticker = '', location = null, mentionIds = [] }) => {
      const group = await Group.findById(groupId).populate('members', 'username avatar online socketId pushSubscriptions');
      if (!group || !group.members.some((member) => member._id.toString() === user._id.toString())) return;

      let attachments = [];
      try {
        attachments = await hydrateAttachments(attachmentIds, user._id);
      } catch (error) {
        socket.emit('message-error', { tempId, error: error.message });
        return;
      }

      const mentions = resolveMentions(content, group.members, mentionIds, user._id);

      const message = new Message({
        sender: user._id,
        group: groupId,
        content,
        sticker,
        location,
        mentions,
        attachments: attachments.map((entry) => entry._id),
        type: determineMessageType({ content, sticker, attachments, location }),
        status: 'sent'
      });
      await message.save();
      const populatedMessage = await populateMessageDetails(message);

      socket.to(groupId).emit('new-group-message', populatedMessage);
      socket.emit('message-sent', { tempId, messageId: message._id.toString(), message: populatedMessage });

      if (mentions.length > 0) {
        const mentionedUsers = group.members.filter((member) => mentions.some((mentionId) => mentionId.toString() === member._id.toString()));
        await Promise.all(
          mentionedUsers.map((member) =>
            sendPushNotification(member, {
              title: `${user.username} mentioned you`,
              body: content || 'You were mentioned in a group message',
              tag: `mention-${message._id}-${member._id}`,
              url: '/chat'
            })
          )
        );
      }
    });

    socket.on('edit-message', async ({ messageId, content = '' }) => {
      try {
        const trimmedContent = content.trim();
        const message = await Message.findById(messageId);

        if (!message) {
          socket.emit('message-error', { error: 'Message not found.' });
          return;
        }
        if (message.sender.toString() !== user._id.toString()) {
          socket.emit('message-error', { error: 'Only the sender can edit this message.' });
          return;
        }
        if (message.isDeleted || message.type === 'call' || message.type === 'location' || message.location) {
          socket.emit('message-error', { error: 'This message cannot be edited.' });
          return;
        }
        if (!trimmedContent && (!Array.isArray(message.attachments) || message.attachments.length === 0) && !message.sticker) {
          socket.emit('message-error', { error: 'Message content cannot be empty.' });
          return;
        }

        message.content = trimmedContent;
        message.editedAt = new Date();
        await message.save();

        const populatedMessage = await populateMessageDetails(message);
        emitMessageMutation(io, message, 'message-updated', populatedMessage);
      } catch (error) {
        socket.emit('message-error', { error: 'Unable to edit message.' });
      }
    });

    socket.on('delete-message', async ({ messageId }) => {
      try {
        const message = await Message.findById(messageId);

        if (!message) {
          socket.emit('message-error', { error: 'Message not found.' });
          return;
        }
        if (message.sender.toString() !== user._id.toString()) {
          socket.emit('message-error', { error: 'Only the sender can delete this message.' });
          return;
        }
        if (message.type === 'call') {
          socket.emit('message-error', { error: 'Call history cannot be deleted.' });
          return;
        }

        message.isDeleted = true;
        message.deletedAt = new Date();
        message.reactions = [];
        sanitizeDeletedMessage(message);
        await message.save();

        const populatedMessage = await populateMessageDetails(message);
        emitMessageMutation(io, message, 'message-deleted', populatedMessage);
      } catch (error) {
        socket.emit('message-error', { error: 'Unable to delete message.' });
      }
    });

    socket.on('toggle-message-reaction', async ({ messageId, value }) => {
      try {
        if (!['like', 'dislike'].includes(value)) {
          socket.emit('message-error', { error: 'Invalid reaction.' });
          return;
        }

        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit('message-error', { error: 'Message not found.' });
          return;
        }

        const canAccess = await canAccessMessage(message, user._id);
        if (!canAccess) {
          socket.emit('message-error', { error: 'Not authorized to react to this message.' });
          return;
        }
        if (message.isDeleted || message.type === 'call') {
          socket.emit('message-error', { error: 'This message cannot be reacted to.' });
          return;
        }

        const existingReaction = message.reactions.find((reaction) => reaction.user.toString() === user._id.toString());
        if (existingReaction?.value === value) {
          message.reactions = message.reactions.filter((reaction) => reaction.user.toString() !== user._id.toString());
        } else if (existingReaction) {
          existingReaction.value = value;
        } else {
          message.reactions.push({ user: user._id, value });
        }

        await message.save();

        const populatedMessage = await populateMessageDetails(message);
        emitMessageMutation(io, message, 'message-reaction-updated', populatedMessage);
      } catch (error) {
        socket.emit('message-error', { error: 'Unable to update reaction.' });
      }
    });

    socket.on('mark-as-read', async ({ chatUserId, senderId, messageIds }) => {
      if (!messageIds || messageIds.length === 0) return;
      try {
        const resolvedSenderId = senderId || chatUserId;
        if (!resolvedSenderId) return;
        await Message.updateMany(
          { _id: { $in: messageIds }, sender: resolvedSenderId, recipient: user._id, status: { $ne: 'read' } },
          { $set: { status: 'read', readAt: new Date() }, $addToSet: { readBy: user._id } }
        );
        io.to(resolvedSenderId.toString()).emit('messages-read', { messageIds, readerId: user._id });
      } catch (err) {
        console.error('Mark as read error:', err);
      }
    });

    socket.on('mark-group-messages-read', async ({ groupId, messageIds }) => {
      if (!groupId || !messageIds || messageIds.length === 0) return;

      try {
        await Message.updateMany(
          { _id: { $in: messageIds }, group: groupId, readBy: { $ne: user._id } },
          { $addToSet: { readBy: user._id } }
        );

        io.to(groupId).emit('group-messages-read', { messageIds, readerId: user._id });
      } catch (err) {
        console.error('Mark group messages as read error:', err);
      }
    });

    socket.on('typing', async ({ recipientId, isTyping }) => {
      if (!recipientId) return;
      if (!(await hasConnection(user._id, recipientId))) return;

      const recipient = await User.findById(recipientId);
      if (!recipient?.socketId) return;

      io.to(recipient.socketId).emit('typing', {
        senderId: user._id.toString(),
        isTyping,
        senderName: user.username
      });
    });

    socket.on('group-typing', async ({ groupId, isTyping }) => {
      const group = await Group.findById(groupId);
      if (!group) return;

      socket.to(groupId).emit('group-typing', {
        groupId,
        senderId: user._id.toString(),
        isTyping,
        senderName: user.username
      });
    });

    socket.on('leave-group', (groupId) => {
      if (groupId) {
        socket.leave(groupId);
      }
    });

    socket.on('group-call-start', async ({ groupId, callId, type }) => {
      if (!groupId || !callId || !['voice', 'video'].includes(type)) return;

      const group = await Group.findById(groupId).populate('members', 'username avatar socketId pushSubscriptions');
      if (!group || !group.members.some((member) => member._id.toString() === user._id.toString())) return;

      const roomId = `group-call:${callId}`;
      activeGroupCalls.set(callId, {
        callId,
        roomId,
        groupId: group._id.toString(),
        groupName: group.name,
        hostId: user._id.toString(),
        type,
        participantIds: new Set([user._id.toString()])
      });

      socket.join(roomId);

      const invitePayload = {
        callId,
        groupId: group._id.toString(),
        groupName: group.name,
        caller: {
          _id: user._id.toString(),
          username: user.username,
          avatar: user.avatar || ''
        },
        type
      };

      const recipients = group.members.filter((member) => member._id.toString() !== user._id.toString());
      recipients.forEach((member) => {
        io.to(member._id.toString()).emit('group-call-invite', invitePayload);
      });

      await Promise.all(
        recipients.map((member) =>
          sendPushNotification(member, {
            title: `${user.username} started a group call`,
            body: `${type === 'video' ? 'Video' : 'Voice'} call in ${group.name}`,
            tag: `group-call-${callId}-${member._id}`,
            url: '/chat'
          })
        )
      );
    });

    socket.on('group-call-join', async ({ callId }) => {
      if (!callId) return;

      const groupCall = activeGroupCalls.get(callId);
      if (!groupCall) return;

      const group = await Group.findById(groupCall.groupId).populate('members', 'username avatar');
      if (!group || !group.members.some((member) => member._id.toString() === user._id.toString())) return;

      const existingParticipantIds = [...groupCall.participantIds].filter((participantId) => participantId !== user._id.toString());
      groupCall.participantIds.add(user._id.toString());
      socket.join(groupCall.roomId);

      const existingParticipants = await User.find({ _id: { $in: existingParticipantIds } }).select('username avatar');
      socket.emit('group-call-joined', {
        callId,
        groupId: groupCall.groupId,
        groupName: groupCall.groupName,
        type: groupCall.type,
        hostId: groupCall.hostId,
        participants: existingParticipants.map(serializeCallParticipant)
      });

      socket.to(groupCall.roomId).emit('group-call-participant-joined', {
        callId,
        participant: serializeCallParticipant(user)
      });
    });

    socket.on('group-call-offer', async ({ callId, recipientId, offer }) => {
      if (!callId || !recipientId || !offer) return;
      io.to(recipientId.toString()).emit('group-call-offer', {
        callId,
        sender: serializeCallParticipant(user),
        offer
      });
    });

    socket.on('group-call-answer', async ({ callId, recipientId, answer }) => {
      if (!callId || !recipientId || !answer) return;
      io.to(recipientId.toString()).emit('group-call-answer', {
        callId,
        sender: serializeCallParticipant(user),
        answer
      });
    });

    socket.on('group-call-ice-candidate', async ({ callId, recipientId, candidate }) => {
      if (!callId || !recipientId || !candidate) return;
      io.to(recipientId.toString()).emit('group-call-ice-candidate', {
        callId,
        sender: serializeCallParticipant(user),
        candidate
      });
    });

    socket.on('group-call-leave', ({ callId }) => {
      if (!callId) return;
      const groupCall = activeGroupCalls.get(callId);
      if (!groupCall) return;

      groupCall.participantIds.delete(user._id.toString());
      socket.leave(groupCall.roomId);
      socket.to(groupCall.roomId).emit('group-call-participant-left', {
        callId,
        participantId: user._id.toString()
      });

      if (groupCall.hostId === user._id.toString() || groupCall.participantIds.size === 0) {
        io.to(groupCall.roomId).emit('group-call-ended', { callId });
        activeGroupCalls.delete(callId);
      }
    });

    socket.on('call-request', async ({ recipientId, callId, type, offer }) => {
      if (!recipientId || !callId) return;
      if (!(await hasConnection(user._id, recipientId))) return;

      const recipient = await User.findById(recipientId);
      if (!recipient?.socketId) return;

      activeCalls.set(callId, {
        callerId: user._id.toString(),
        recipientId: recipientId.toString(),
        type,
        offer: offer || null,
        requestedAt: new Date(),
        answeredAt: null
      });

      io.to(recipient.socketId).emit('call-request', {
        callId,
        caller: {
          _id: user._id.toString(),
          username: user.username,
          avatar: user.avatar
        },
        type,
        offer: offer || null
      });

      await sendPushNotification(recipient, {
        title: `${user.username} is calling`,
        body: `${type === 'video' ? 'Video' : 'Voice'} call incoming`,
        tag: `call-${callId}`,
        url: '/chat'
      });
    });

    socket.on('call-answer', async ({ recipientId, callId, answer }) => {
      if (!recipientId || !callId) return;
      const activeCall = activeCalls.get(callId);
      if (activeCall) {
        activeCall.answeredAt = new Date();
      }

      const recipient = await User.findById(recipientId);
      if (!recipient?.socketId) return;

      io.to(recipient.socketId).emit('call-answer', { callId, answer });
    });

    socket.on('ice-candidate', async ({ recipientId, callId, candidate }) => {
      if (!recipientId || !callId || !candidate) return;

      const recipient = await User.findById(recipientId);
      if (!recipient?.socketId) return;

      io.to(recipient.socketId).emit('ice-candidate', { callId, candidate });
    });

    socket.on('call-rejected', async ({ recipientId, callId }) => {
      if (!recipientId || !callId) return;

      const activeCall = activeCalls.get(callId);
      activeCalls.delete(callId);
      const recipient = await User.findById(recipientId);
      if (recipient?.socketId) {
        io.to(recipient.socketId).emit('call-rejected', { callId });
      }

      if (activeCall) {
        const historyMessage = await createCallHistoryMessage({
          callerId: activeCall.callerId,
          recipientId: activeCall.recipientId,
          mode: activeCall.type,
          status: 'rejected',
          startedAt: activeCall.requestedAt,
          endedAt: new Date()
        });

        io.to(activeCall.callerId).emit('call-history', historyMessage);
        io.to(activeCall.recipientId).emit('call-history', historyMessage);
      }
    });

    socket.on('call-ended', async ({ recipientId, callId }) => {
      if (!recipientId || !callId) return;

      const activeCall = activeCalls.get(callId);
      activeCalls.delete(callId);
      const recipient = await User.findById(recipientId);
      if (recipient?.socketId) {
        io.to(recipient.socketId).emit('call-ended', { callId });
      }

      if (activeCall) {
        const endedAt = new Date();
        const historyMessage = await createCallHistoryMessage({
          callerId: activeCall.callerId,
          recipientId: activeCall.recipientId,
          mode: activeCall.type,
          status: activeCall.answeredAt ? 'completed' : 'missed',
          startedAt: activeCall.answeredAt || activeCall.requestedAt,
          endedAt
        });

        io.to(activeCall.callerId).emit('call-history', historyMessage);
        io.to(activeCall.recipientId).emit('call-history', historyMessage);
      }
    });

    socket.on('get-call-offer', ({ callId }, callback) => {
      callback?.(activeCalls.get(callId) || null);
      activeCalls.delete(callId);
    });

    socket.on('disconnect', async () => {
      for (const [callId, groupCall] of activeGroupCalls.entries()) {
        if (!groupCall.participantIds.has(user._id.toString())) continue;

        groupCall.participantIds.delete(user._id.toString());
        socket.to(groupCall.roomId).emit('group-call-participant-left', {
          callId,
          participantId: user._id.toString()
        });

        if (groupCall.hostId === user._id.toString() || groupCall.participantIds.size === 0) {
          io.to(groupCall.roomId).emit('group-call-ended', { callId });
          activeGroupCalls.delete(callId);
        }
      }

      await User.findByIdAndUpdate(user._id, { online: false, socketId: null, lastSeen: new Date() });
      io.emit('user-status', { userId: user._id.toString(), online: false, lastSeen: new Date() });
    });
  });
};
