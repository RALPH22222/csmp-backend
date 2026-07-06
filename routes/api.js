import express from 'express';
import { createPool, joinPool, contribute, payout, getPoolState } from '../controllers/poolController.js';
import { register, verifyOtp, resendOtp } from '../controllers/authController.js';

const router = express.Router();

router.post('/pools', createPool);
router.post('/pools/:poolId/join', joinPool);
router.post('/pools/:poolId/contribute', contribute);
router.post('/pools/:poolId/payout', payout);
router.get('/pools/:poolId/state', getPoolState);

// Auth Routes
router.post('/auth/register', register);
router.post('/auth/verify-otp', verifyOtp);
router.post('/auth/resend-otp', resendOtp);

export default router;