// server/src/middleware/authMiddleware.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    console.log('🔑 Auth header received:', authHeader ? 'Yes' : 'No');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Access denied. No token provided.',
        });
    }

    const token = authHeader.split(' ')[1];
    console.log('🔑 Token received:', token.substring(0, 20) + '...');

    try {
        // Use the SAME secret as authController
        const secret = process.env.JWT_SECRET || 'fallback_secret_key';
        console.log('🔑 JWT_SECRET (first 10 chars):', secret.substring(0, 10) + '...');

        const decoded = jwt.verify(token, secret);
        console.log('✅ Token verified successfully. Decoded:', decoded);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('❌ Token verification error:', error.message);
        console.error('❌ Error name:', error.name);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token has expired.',
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({
                success: false,
                message: 'Invalid token.',
            });
        }
        return res.status(403).json({
            success: false,
            message: 'Invalid token.',
        });
    }
};