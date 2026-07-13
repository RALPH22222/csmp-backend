import express from 'express';
import { createPool, joinPool, contribute, payout, getPoolState, getAllPools, getMyPools, getPoolById } from '../controllers/poolController.js';
import { register, verifyOtp, resendOtp, login, verifyLoginOtp, refreshSession } from '../controllers/authController.js';

const router = express.Router();

router.get('c', getAllPools);
router.get('/pools/user/:userId', getMyPools);
router.get('/pools/:poolId', getPoolById);
router.post('/pools', createPool);
router.post('/pools/:poolId/join', joinPool);
router.post('/pools/:poolId/contribute', contribute);
router.post('/pools/:poolId/payout', payout);
router.get('/pools/:poolId/state', getPoolState);

// Auth Routes
router.post('/auth/register', register);
router.post('/auth/verify-otp', verifyOtp);
router.post('/auth/resend-otp', resendOtp);
router.post('/auth/login', login);
router.post('/auth/verify-login', verifyLoginOtp);
router.post('/auth/refresh', refreshSession);

export default router;