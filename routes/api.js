import express from 'express';
import { createPool, joinPool, contribute, payout, getPoolState } from '../controllers/poolController.js';

const router = express.Router();

router.post('/pools', createPool);
router.post('/pools/:poolId/join', joinPool);
router.post('/pools/:poolId/contribute', contribute);
router.post('/pools/:poolId/payout', payout);
router.get('/pools/:poolId/state', getPoolState);

export default router;