import jwt from 'jsonwebtoken';

/**
 * JWT Authentication Middleware
 *
 * Verifies the Bearer token from the Authorization header.
 * On success, attaches the decoded payload to `req.user`.
 *
 * Usage in routes:
 *   import { verifyToken } from '../middleware/authMiddleware.js';
 *   router.get('/protected', verifyToken, yourController);
 */
export const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Access denied. No token provided.',
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Attach decoded payload (e.g. { id, email, role })
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token has expired.',
            });
        }
        return res.status(403).json({
            success: false,
            message: 'Invalid token.',
        });
    }
};
