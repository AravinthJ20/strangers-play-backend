const express = require('express');
const auth = require('../utils/auth');
const statusController = require('../controllers/statusController');

const router = express.Router();

router.get('/', auth, statusController.getStatusFeed);
router.get('/mine', auth, statusController.getMyStatuses);
router.post('/', auth, statusController.createStatus);
router.delete('/:statusId', auth, statusController.deleteStatus);
router.patch('/:statusId/view', auth, statusController.markStatusViewed);

module.exports = router;
