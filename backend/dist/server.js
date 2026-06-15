"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const database_1 = require("./database");
const routes_1 = __importDefault(require("./routes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Apply CORS to allow requests from Chrome extensions
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key']
}));
app.use(express_1.default.json());
// Register API Routes
app.use('/api', routes_1.default);
// Initialize DB and Boot server
async function startServer() {
    try {
        await (0, database_1.initDatabase)();
        app.listen(PORT, () => {
            console.log(`=================================================`);
            console.log(`   Meeting Data Ingestion Backend Service Running `);
            console.log(`   Local URL: http://localhost:${PORT}            `);
            console.log(`   API Endpoint: http://localhost:${PORT}/api      `);
            console.log(`=================================================`);
        });
    }
    catch (err) {
        console.error('CRITICAL: Ingestion Server Startup Failed:', err);
        process.exit(1);
    }
}
startServer();
