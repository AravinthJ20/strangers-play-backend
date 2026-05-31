const express = require('express');
const router = express.Router();
const auth = require('../utils/auth');
const User = require('../models/User');
const { sanitizeSubscription } = require('../utils/push');

const publicFields = 'username email avatar online lastSeen connections connectionRequestsSent connectionRequestsReceived';

const toIdString = (value) => value.toString();

const getConnectionStatus = (viewer, targetId) => {
  const id = targetId.toString();

  if (viewer.connections.some((entry) => entry.toString() === id)) return 'connected';
  if (viewer.connectionRequestsSent.some((entry) => entry.toString() === id)) return 'outgoing';
  if (viewer.connectionRequestsReceived.some((entry) => entry.toString() === id)) return 'incoming';
  return 'none';
};

const serializeUser = (user, viewer) => ({
  _id: user._id,
  username: user.username,
  email: user.email,
  avatar: user.avatar,
  online: user.online,
  lastSeen: user.lastSeen,
  connectionStatus: viewer ? getConnectionStatus(viewer, user._id) : undefined
});

router.get('/', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).select(publicFields);
    const users = await User.find({ _id: { $in: currentUser.connections } }).select('username email avatar online lastSeen');
    res.json(users.map((user) => serializeUser(user, currentUser)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/requests', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id)
      .populate('connectionRequestsReceived', 'username email avatar online lastSeen')
      .populate('connectionRequestsSent', 'username email avatar online lastSeen')
      .populate('connections', 'username email avatar online lastSeen');

    res.json({
      incoming: currentUser.connectionRequestsReceived.map((user) => serializeUser(user, currentUser)),
      outgoing: currentUser.connectionRequestsSent.map((user) => serializeUser(user, currentUser)),
      connections: currentUser.connections.map((user) => serializeUser(user, currentUser))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/search', auth, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) return res.status(400).json({ error: 'Query too short' });

    const currentUser = await User.findById(req.user._id).select(publicFields);
    const users = await User.find({
      $or: [{ username: new RegExp(query, 'i') }, { email: new RegExp(query, 'i') }],
      _id: { $ne: req.user._id }
    }).select('username email avatar online lastSeen');

    res.json(users.map((user) => serializeUser(user, currentUser)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/discover', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).select(publicFields);
    const users = await User.find({ _id: { $ne: req.user._id } }).select('username email avatar online lastSeen');
    res.json(users.map((user) => serializeUser(user, currentUser)));
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

    const [currentUser, targetUser] = await Promise.all([
      User.findById(req.user._id),
      User.findById(targetId)
    ]);

    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (currentUser.connections.some((entry) => entry.toString() === targetId)) {
      return res.status(400).json({ error: 'Already connected' });
    }
    if (currentUser.connectionRequestsSent.some((entry) => entry.toString() === targetId)) {
      return res.status(400).json({ error: 'Request already sent' });
    }

    // If the other user already requested, accept immediately through the same flow.
    if (currentUser.connectionRequestsReceived.some((entry) => entry.toString() === targetId)) {
      currentUser.connectionRequestsReceived = currentUser.connectionRequestsReceived.filter((entry) => toIdString(entry) !== targetId);
      targetUser.connectionRequestsSent = targetUser.connectionRequestsSent.filter((entry) => toIdString(entry) !== req.user._id.toString());
      currentUser.connections.push(targetUser._id);
      targetUser.connections.push(currentUser._id);
      await Promise.all([currentUser.save(), targetUser.save()]);
      return res.json({ status: 'connected' });
    }

    currentUser.connectionRequestsSent.push(targetUser._id);
    targetUser.connectionRequestsReceived.push(currentUser._id);
    await Promise.all([currentUser.save(), targetUser.save()]);

    res.json({ status: 'outgoing' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/connections/:userId/accept', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const [currentUser, targetUser] = await Promise.all([
      User.findById(req.user._id),
      User.findById(targetId)
    ]);

    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (!currentUser.connectionRequestsReceived.some((entry) => entry.toString() === targetId)) {
      return res.status(400).json({ error: 'No incoming request from this user' });
    }

    currentUser.connectionRequestsReceived = currentUser.connectionRequestsReceived.filter((entry) => toIdString(entry) !== targetId);
    targetUser.connectionRequestsSent = targetUser.connectionRequestsSent.filter((entry) => toIdString(entry) !== req.user._id.toString());

    if (!currentUser.connections.some((entry) => entry.toString() === targetId)) currentUser.connections.push(targetUser._id);
    if (!targetUser.connections.some((entry) => entry.toString() === req.user._id.toString())) targetUser.connections.push(currentUser._id);

    await Promise.all([currentUser.save(), targetUser.save()]);
    res.json({ status: 'connected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/connections/:userId/reject', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const [currentUser, targetUser] = await Promise.all([
      User.findById(req.user._id),
      User.findById(targetId)
    ]);

    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    currentUser.connectionRequestsReceived = currentUser.connectionRequestsReceived.filter((entry) => toIdString(entry) !== targetId);
    currentUser.connectionRequestsSent = currentUser.connectionRequestsSent.filter((entry) => toIdString(entry) !== targetId);
    targetUser.connectionRequestsReceived = targetUser.connectionRequestsReceived.filter((entry) => toIdString(entry) !== req.user._id.toString());
    targetUser.connectionRequestsSent = targetUser.connectionRequestsSent.filter((entry) => toIdString(entry) !== req.user._id.toString());

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
