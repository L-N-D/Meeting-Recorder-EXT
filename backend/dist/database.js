"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sequelize = exports.RecordingChunk = exports.Recording = void 0;
exports.initDatabase = initDatabase;
const sequelize_1 = require("sequelize");
const path_1 = __importDefault(require("path"));
// Determine connection details
const isPostgres = !!process.env.PGHOST || !!process.env.DATABASE_URL;
let sequelize;
if (isPostgres) {
    console.log('Connecting to PostgreSQL database...');
    exports.sequelize = sequelize = new sequelize_1.Sequelize(process.env.DATABASE_URL || '', {
        dialect: 'postgres',
        logging: false
    });
}
else {
    const dbPath = path_1.default.resolve(__dirname, '../../database.sqlite');
    console.log(`Connecting to SQLite fallback database at: ${dbPath}`);
    exports.sequelize = sequelize = new sequelize_1.Sequelize({
        dialect: 'sqlite',
        storage: dbPath,
        logging: false
    });
}
// --- Define Models ---
class Recording extends sequelize_1.Model {
}
exports.Recording = Recording;
Recording.init({
    sessionId: {
        type: sequelize_1.DataTypes.STRING,
        primaryKey: true
    },
    platform: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false
    },
    startedAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false
    },
    endedAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true
    },
    status: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        defaultValue: 'recording'
    }
}, {
    sequelize,
    modelName: 'Recording',
    tableName: 'recordings',
    timestamps: false
});
class RecordingChunk extends sequelize_1.Model {
}
exports.RecordingChunk = RecordingChunk;
RecordingChunk.init({
    chunkId: {
        type: sequelize_1.DataTypes.STRING,
        primaryKey: true
    },
    sessionId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false
    },
    chunkIndex: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: false
    },
    checksum: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false
    },
    filePath: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false
    },
    uploadedAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize_1.DataTypes.NOW
    }
}, {
    sequelize,
    modelName: 'RecordingChunk',
    tableName: 'recording_chunks',
    timestamps: false
});
// Establish relationship
Recording.hasMany(RecordingChunk, { foreignKey: 'sessionId', as: 'chunks' });
RecordingChunk.belongsTo(Recording, { foreignKey: 'sessionId' });
async function initDatabase() {
    await sequelize.authenticate();
    await sequelize.sync();
    console.log('Database synced successfully.');
}
