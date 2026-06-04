const Group = require('../models/Group');
const Message = require('../models/Message');

const populateMessageDetails = (query) => query.populate('sender', 'username avatar').populate('attachments');
const serializeGroup = (group) => ({
  ...group.toObject(),
  group: true
});
const parsePagination = (query) => {
  const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 100);
  const before = query.before ? new Date(query.before) : null;
  return {
    limit,
    before: before && !Number.isNaN(before.getTime()) ? before : null
  };
};

exports.createGroup = async (req, res) => {
  try {
    const { name, description, members } = req.body;
    if (!name || !Array.isArray(members) || members.length === 0) return res.status(400).json({ error: 'Invalid group data' });

    const memberSet = [...new Set([...members.map(String), req.user._id.toString()])];
    const group = new Group({ name, description: description || '', members: memberSet, admin: req.user._id });
    await group.save();

    const groupData = await Group.findById(group._id).populate('members', 'username avatar online').populate('admin', 'username avatar');
    res.status(201).json(serializeGroup(groupData));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getUserGroups = async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user._id }).populate('members', 'username avatar online').populate('admin', 'username avatar');
    res.json(groups.map(serializeGroup));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getGroup = async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.groupId, members: req.user._id }).populate('members', 'username avatar online').populate('admin', 'username avatar');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(serializeGroup(group));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getGroupMessages = async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.groupId, members: req.user._id });
    if (!group) return res.status(403).json({ error: 'Not a member' });
    const { limit, before } = parsePagination(req.query);
    const filter = { group: req.params.groupId };
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

exports.addMembers = async (req, res) => {
  try {
    const { memberIds } = req.body;
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.admin.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Only the group admin can add members' });

    const normalizedMemberIds = Array.isArray(memberIds) ? memberIds : [];
    const newMembers = normalizedMemberIds.filter((id) => !group.members.some((member) => member.toString() === id.toString()));
    group.members.push(...newMembers);
    await group.save();

    const groupData = await Group.findById(group._id).populate('members', 'username avatar online').populate('admin', 'username avatar');
    res.json(serializeGroup(groupData));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.admin.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Only the group admin can update the group' });

    const nextName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const nextDescription = typeof req.body.description === 'string' ? req.body.description.trim() : group.description || '';

    if (!nextName) return res.status(400).json({ error: 'Group name is required' });

    group.name = nextName;
    group.description = nextDescription;
    await group.save();

    const groupData = await Group.findById(group._id).populate('members', 'username avatar online').populate('admin', 'username avatar');
    res.json(serializeGroup(groupData));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.removeMember = async (req, res) => {
  try {
    const { memberId } = req.body;
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.admin.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Only the group admin can remove members' });
    if (!memberId) return res.status(400).json({ error: 'memberId is required' });
    if (memberId.toString() === group.admin.toString()) return res.status(400).json({ error: 'Admin cannot remove themselves from the group' });

    group.members = group.members.filter((member) => member.toString() !== memberId.toString());
    await group.save();

    const groupData = await Group.findById(group._id).populate('members', 'username avatar online').populate('admin', 'username avatar');
    res.json(serializeGroup(groupData));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.leaveGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some((member) => member.toString() === req.user._id.toString())) return res.status(400).json({ error: 'Not a member' });

    group.members = group.members.filter((member) => member.toString() !== req.user._id.toString());
    if (group.members.length === 0) {
      await group.remove();
      return res.json({ message: 'Group deleted' });
    }

    if (group.admin.toString() === req.user._id.toString()) group.admin = group.members[0];
    await group.save();
    res.json({ message: 'Left group' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
