const express = require('express');
const router = express.Router();
const auth = require('../utils/auth');
const groupController = require('../controllers/groupController');

router.post('/', auth, groupController.createGroup);
router.get('/', auth, groupController.getUserGroups);
router.get('/:groupId', auth, groupController.getGroup);
router.get('/:groupId/messages', auth, groupController.getGroupMessages);
router.patch('/:groupId', auth, groupController.updateGroup);
router.post('/:groupId/add-members', auth, groupController.addMembers);
router.post('/:groupId/remove-member', auth, groupController.removeMember);
router.post('/:groupId/leave', auth, groupController.leaveGroup);

module.exports = router;
