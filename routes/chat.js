const express = require('express');
const router = express.Router();
const auth = require('../utils/auth');
const chatController = require('../controllers/chatController');

router.get('/chats', auth, chatController.getChats);
router.post('/uploads', auth, chatController.uploadMedia);
router.get('/messages/:userId', auth, chatController.getPersonalMessages);
router.patch('/messages/:messageId/read', auth, chatController.markAsRead);
router.patch('/messages/:messageId', auth, chatController.editMessage);
router.delete('/messages/:messageId', auth, chatController.deleteMessage);
router.post('/messages/:messageId/reactions', auth, chatController.reactToMessage);

module.exports = router;
