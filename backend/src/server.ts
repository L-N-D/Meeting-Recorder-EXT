import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDatabase } from './database';
import routes from './routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Apply CORS to allow requests from Chrome extensions
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key']
}));

app.use(express.json());

// Register API Routes
app.use('/api', routes);

// Initialize DB and Boot server
async function startServer() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`=================================================`);
      console.log(`   Meeting Data Ingestion Backend Service Running `);
      console.log(`   Local URL: http://localhost:${PORT}            `);
      console.log(`   API Endpoint: http://localhost:${PORT}/api      `);
      console.log(`=================================================`);
    });
  } catch (err) {
    console.error('CRITICAL: Ingestion Server Startup Failed:', err);
    process.exit(1);
  }
}

startServer();
