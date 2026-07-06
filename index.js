import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import apiRoutes from './routes/api.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes);

app.get('/api/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`csmp-backend listening on port ${PORT}`));