import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);
app.get('/', (req, res) => {
    res.send('CSMP Backend is running!');
});

// RATE LIMITING
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 100, // 100 requests
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(limiter);

app.listen(PORT, () => {
    console.log(`Server is listening on http://localhost:${PORT}`);
});