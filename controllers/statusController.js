const Status = require('../models/Status');
const User = require('../models/User');
const ChatMedia = require('../models/ChatMedia');

const STATUS_TTL_HOURS = 24;

const populateStatus = (query) => query.populate('owner', 'username avatar').populate('media');

const getAllowedOwnerIds = async (userId) => {
  const user = await User.findById(userId).select('connections');
  const connectionIds = (user?.connections || []).map((entry) => entry.toString());
  return [userId.toString(), ...connectionIds];
};

exports.getStatusFeed = async (req, res) => {
  try {
    const allowedOwnerIds = await getAllowedOwnerIds(req.user._id);
    const statuses = await populateStatus(
      Status.find({
        owner: { $in: allowedOwnerIds },
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 })
    );

    res.json(statuses);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to load status feed' });
  }
};

exports.getMyStatuses = async (req, res) => {
  try {
    const statuses = await populateStatus(
      Status.find({
        owner: req.user._id,
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 })
    );

    res.json(statuses);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to load your statuses' });
  }
};

exports.createStatus = async (req, res) => {
  try {
    const { text = '', mediaId = null, background = '#17324f' } = req.body;
    const trimmedText = text.trim();
    let media = null;

    if (mediaId) {
      media = await ChatMedia.findOne({ _id: mediaId, owner: req.user._id });
      if (!media) {
        return res.status(400).json({ error: 'Selected status media is invalid' });
      }
    }

    const status = new Status({
      owner: req.user._id,
      text: trimmedText,
      media: media?._id || null,
      background,
      expiresAt: new Date(Date.now() + STATUS_TTL_HOURS * 60 * 60 * 1000)
    });

    await status.save();
    const populatedStatus = await populateStatus(Status.findById(status._id));
    res.status(201).json(populatedStatus);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to create status' });
  }
};

exports.deleteStatus = async (req, res) => {
  try {
    const status = await Status.findOneAndDelete({ _id: req.params.statusId, owner: req.user._id });
    if (!status) return res.status(404).json({ error: 'Status not found' });
    res.json({ message: 'Status deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to delete status' });
  }
};

exports.markStatusViewed = async (req, res) => {
  try {
    const allowedOwnerIds = await getAllowedOwnerIds(req.user._id);
    const status = await Status.findOne({
      _id: req.params.statusId,
      owner: { $in: allowedOwnerIds },
      expiresAt: { $gt: new Date() }
    });

    if (!status) return res.status(404).json({ error: 'Status not found' });

    if (status.owner.toString() !== req.user._id.toString()) {
      status.viewers = [...new Set([...(status.viewers || []).map((entry) => entry.toString()), req.user._id.toString()])];
      await status.save();
    }

    const populatedStatus = await populateStatus(Status.findById(status._id));
    res.json(populatedStatus);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to update status view' });
  }
};
