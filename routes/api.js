import express from 'express';
import { getMessages, addMessage } from '../controllers/dataController.js';

const router = express.Router();

// GET /api/messages
router.get('/messages', getMessages);

// POST /api/messages
router.post('/messages', addMessage);

export default router;