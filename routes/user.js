const express = require('express');
const router = express.Router();
const auth = require('../utils/auth');
const User = require('../models/User');
const { sanitizeSubscription } = require('../utils/push');

const publicFields =
  'username email avatar online lastSeen connections connectionRequestsSent connectionRequestsReceived ignoredUsers rejectedUsers';

const profileFields = 'username email avatar online lastSeen';

const toIdString = (value) => value.toString();

const includesId = (list, targetId) => list.some((entry) => toIdString(entry) === targetId);

const removeId = (list, targetId) => list.filter((entry) => toIdString(entry) !== targetId);

const clearRelationshipState = (sourceUser, targetId) => {
  sourceUser.connectionRequestsSent = removeId(sourceUser.connectionRequestsSent, targetId);
  sourceUser.connectionRequestsReceived = removeId(sourceUser.connectionRequestsReceived, targetId);
  sourceUser.ignoredUsers = removeId(sourceUser.ignoredUsers || [], targetId);
  sourceUser.rejectedUsers = removeId(sourceUser.rejectedUsers || [], targetId);
};

const resetDecisionReminder = (user) => {
  user.lastConnectionDecisionReminderAt = null;
};

const getConnectionStatus = (viewer, targetId) => {
  const id = toIdString(targetId);

  if (includesId(viewer.connections || [], id)) return 'accepted';
  if (includesId(viewer.connectionRequestsSent || [], id) || includesId(viewer.connectionRequestsReceived || [], id)) return 'interested';
  if (includesId(viewer.rejectedUsers || [], id)) return 'rejected';
  if (includesId(viewer.ignoredUsers || [], id)) return 'ignored';
  return 'none';
};

const serializeUser = (user, viewer) => ({
  _id: user._id,
  username: user.username,
  email: user.email,
  avatar: user.avatar,
  bio: user.bio || '',
  location: user.location || '',
  interests: Array.isArray(user.interests) ? user.interests : [],
  online: user.online,
  lastSeen: user.lastSeen,
  connectionStatus: viewer ? getConnectionStatus(viewer, user._id) : undefined
});

const loadCurrentUser = (userId) => User.findById(userId).select(publicFields);

const loadTargetUser = (userId) => User.findById(userId);

router.get('/profile', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).select(
      'username email avatar bio location interests online lastSeen createdAt connections connectionRequestsSent connectionRequestsReceived'
    );

    res.json({
      _id: currentUser._id,
      username: currentUser.username,
      email: currentUser.email,
      avatar: currentUser.avatar || '',
      bio: currentUser.bio || '',
      location: currentUser.location || '',
      interests: Array.isArray(currentUser.interests) ? currentUser.interests : [],
      online: currentUser.online,
      lastSeen: currentUser.lastSeen,
      createdAt: currentUser.createdAt,
      stats: {
        connections: currentUser.connections.length,
        sentRequests: currentUser.connectionRequestsSent.length,
        receivedRequests: currentUser.connectionRequestsReceived.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/profile', auth, async (req, res) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const avatar = typeof req.body.avatar === 'string' ? req.body.avatar.trim() : '';
    const bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : '';
    const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';
    const interestsInput = Array.isArray(req.body.interests)
      ? req.body.interests
      : typeof req.body.interests === 'string'
        ? req.body.interests.split(',')
        : [];

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const normalizedInterests = [...new Set(
      interestsInput
        .map((entry) => `${entry}`.trim())
        .filter(Boolean)
    )].slice(0, 12);

    const existing = await User.findOne({
      username,
      _id: { $ne: req.user._id }
    });

    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    req.user.username = username;
    req.user.avatar = avatar;
    req.user.bio = bio;
    req.user.location = location;
    req.user.interests = normalizedInterests;
    await req.user.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        _id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        avatar: req.user.avatar || '',
        bio: req.user.bio || '',
        location: req.user.location || '',
        interests: req.user.interests || [],
        online: req.user.online,
        lastSeen: req.user.lastSeen,
        createdAt: req.user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const currentUser = await loadCurrentUser(req.user._id);
    const users = await User.find({ _id: { $in: currentUser.connections } }).select(profileFields);
    res.json(users.map((user) => serializeUser(user, currentUser)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/connections', auth, async (req, res) => {
  try {
    const currentUser = await loadCurrentUser(req.user._id);
    const users = await User.find({ _id: { $in: currentUser.connections } }).select(profileFields);
    res.json(users.map((user) => serializeUser(user, currentUser)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/requests', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id)
      .select(publicFields)
      .populate('connectionRequestsReceived', profileFields)
      .populate('connectionRequestsSent', profileFields)
      .populate('connections', profileFields);

    res.json({
      incoming: currentUser.connectionRequestsReceived.map((user) => serializeUser(user, currentUser)),
      outgoing: currentUser.connectionRequestsSent.map((user) => serializeUser(user, currentUser)),
      connections: currentUser.connections.map((user) => serializeUser(user, currentUser)),
      received: currentUser.connectionRequestsReceived.map((user) => serializeUser(user, currentUser)),
      sent: currentUser.connectionRequestsSent.map((user) => serializeUser(user, currentUser)),
      accepted: currentUser.connections.map((user) => serializeUser(user, currentUser))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/search', auth, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) return res.status(400).json({ error: 'Query too short' });

    const currentUser = await loadCurrentUser(req.user._id);
    const users = await User.find({
      $or: [{ username: new RegExp(query, 'i') }, { email: new RegExp(query, 'i') }],
      _id: { $ne: req.user._id }
    }).select(profileFields);

    res.json(users.map((user) => serializeUser(user, currentUser)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/discover', auth, async (req, res) => {
  try {
    const currentUser = await loadCurrentUser(req.user._id);
    const blockedIds = [
      ...currentUser.connections,
      ...currentUser.connectionRequestsSent,
      ...currentUser.connectionRequestsReceived,
      ...(currentUser.ignoredUsers || []),
      ...(currentUser.rejectedUsers || [])
    ];
    const users = await User.find({
      _id: {
        $ne: req.user._id,
        $nin: blockedIds
      }
    }).select(profileFields);
    res.json(users.map((user) => serializeUser(user, currentUser)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/feed', auth, async (req, res) => {
  try {
    const currentUser = await loadCurrentUser(req.user._id);
    const hiddenIds = [
      ...currentUser.connections,
      ...currentUser.connectionRequestsSent,
      ...currentUser.connectionRequestsReceived,
      ...(currentUser.ignoredUsers || []),
      ...(currentUser.rejectedUsers || [])
    ];
    const users = await User.find({
      _id: {
        $ne: req.user._id,
        $nin: hiddenIds
      }
    }).select(profileFields);
    res.json(users.map((user) => serializeUser(user, currentUser)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/connections/:userId/ignore', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot ignore yourself' });
    }

    const [currentUser, targetUser] = await Promise.all([loadTargetUser(req.user._id), loadTargetUser(targetId)]);

    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    clearRelationshipState(currentUser, targetId);
    clearRelationshipState(targetUser, req.user._id.toString());

    if (!includesId(currentUser.ignoredUsers || [], targetId)) {
      currentUser.ignoredUsers.push(targetUser._id);
    }

    await Promise.all([currentUser.save(), targetUser.save()]);
    res.json({ status: 'ignored' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/connections/:userId/request', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot send request to yourself' });
    }

    const [currentUser, targetUser] = await Promise.all([loadTargetUser(req.user._id), loadTargetUser(targetId)]);

    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (includesId(currentUser.connections || [], targetId)) {
      return res.status(400).json({ error: 'Already connected' });
    }
    if (includesId(currentUser.connectionRequestsSent || [], targetId)) {
      return res.status(400).json({ error: 'Request already sent' });
    }

    currentUser.ignoredUsers = removeId(currentUser.ignoredUsers || [], targetId);
    currentUser.rejectedUsers = removeId(currentUser.rejectedUsers || [], targetId);
    targetUser.ignoredUsers = removeId(targetUser.ignoredUsers || [], req.user._id.toString());
    targetUser.rejectedUsers = removeId(targetUser.rejectedUsers || [], req.user._id.toString());

    if (includesId(currentUser.connectionRequestsReceived || [], targetId)) {
      currentUser.connectionRequestsReceived = removeId(currentUser.connectionRequestsReceived, targetId);
      targetUser.connectionRequestsSent = removeId(targetUser.connectionRequestsSent, req.user._id.toString());

      if (!includesId(currentUser.connections || [], targetId)) currentUser.connections.push(targetUser._id);
      if (!includesId(targetUser.connections || [], req.user._id.toString())) targetUser.connections.push(currentUser._id);

      await Promise.all([currentUser.save(), targetUser.save()]);
      return res.json({ status: 'accepted' });
    }

    currentUser.connectionRequestsSent.push(targetUser._id);
    targetUser.connectionRequestsReceived.push(currentUser._id);
    resetDecisionReminder(targetUser);
    await Promise.all([currentUser.save(), targetUser.save()]);

    res.json({ status: 'interested' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/connections/:userId/accept', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const [currentUser, targetUser] = await Promise.all([loadTargetUser(req.user._id), loadTargetUser(targetId)]);

    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (!includesId(currentUser.connectionRequestsReceived || [], targetId)) {
      return res.status(400).json({ error: 'No incoming request from this user' });
    }

    currentUser.connectionRequestsReceived = removeId(currentUser.connectionRequestsReceived, targetId);
    targetUser.connectionRequestsSent = removeId(targetUser.connectionRequestsSent, req.user._id.toString());
    currentUser.rejectedUsers = removeId(currentUser.rejectedUsers || [], targetId);
    currentUser.ignoredUsers = removeId(currentUser.ignoredUsers || [], targetId);
    targetUser.rejectedUsers = removeId(targetUser.rejectedUsers || [], req.user._id.toString());
    targetUser.ignoredUsers = removeId(targetUser.ignoredUsers || [], req.user._id.toString());

    if (!includesId(currentUser.connections || [], targetId)) currentUser.connections.push(targetUser._id);
    if (!includesId(targetUser.connections || [], req.user._id.toString())) targetUser.connections.push(currentUser._id);

    await Promise.all([currentUser.save(), targetUser.save()]);
    res.json({ status: 'accepted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/connections/:userId/reject', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const [currentUser, targetUser] = await Promise.all([loadTargetUser(req.user._id), loadTargetUser(targetId)]);

    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    clearRelationshipState(currentUser, targetId);
    clearRelationshipState(targetUser, req.user._id.toString());

    if (!includesId(currentUser.rejectedUsers || [], targetId)) {
      currentUser.rejectedUsers.push(targetUser._id);
    }

    await Promise.all([currentUser.save(), targetUser.save()]);
    res.json({ status: 'rejected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/push/subscribe', auth, async (req, res) => {
  try {
    const subscription = sanitizeSubscription(req.body.subscription);
    if (!subscription) {
      return res.status(400).json({ error: 'Invalid push subscription payload' });
    }

    const existing = req.user.pushSubscriptions.some((entry) => entry.endpoint === subscription.endpoint);
    if (!existing) {
      req.user.pushSubscriptions.push(subscription);
    } else {
      req.user.pushSubscriptions = req.user.pushSubscriptions.map((entry) =>
        entry.endpoint === subscription.endpoint ? subscription : entry
      );
    }

    await req.user.save();
    res.json({ status: 'subscribed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/push/unsubscribe', auth, async (req, res) => {
  try {
    const endpoint = req.body.endpoint;
    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint is required' });
    }

    req.user.pushSubscriptions = req.user.pushSubscriptions.filter((entry) => entry.endpoint !== endpoint);
    await req.user.save();
    res.json({ status: 'unsubscribed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
