import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';

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

app.listen(PORT, () => {
    console.log(`Server is listening on http://localhost:${PORT}`);
});