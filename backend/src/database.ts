import { Sequelize, DataTypes, Model } from 'sequelize';
import path from 'path';
import fs from 'fs';

// Determine connection details
const isPostgres = !!process.env.PGHOST || !!process.env.DATABASE_URL;

let sequelize: Sequelize;

if (isPostgres) {
  console.log('Connecting to PostgreSQL database...');
  sequelize = new Sequelize(process.env.DATABASE_URL || '', {
    dialect: 'postgres',
    logging: false
  });
} else {
  const dbPath = path.resolve(__dirname, '../../database.sqlite');
  console.log(`Connecting to SQLite fallback database at: ${dbPath}`);
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false
  });
}

// --- Define Models ---

export class Recording extends Model {
  declare sessionId: string;
  declare platform: string;
  declare startedAt: Date;
  declare endedAt: Date | null;
  declare status: string;
}

Recording.init(
  {
    sessionId: {
      type: DataTypes.STRING,
      primaryKey: true
    },
    platform: {
      type: DataTypes.STRING,
      allowNull: false
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    endedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'recording'
    }
  },
  {
    sequelize,
    modelName: 'Recording',
    tableName: 'recordings',
    timestamps: false
  }
);

export class RecordingChunk extends Model {
  declare chunkId: string;
  declare sessionId: string;
  declare chunkIndex: number;
  declare checksum: string;
  declare filePath: string;
  declare uploadedAt: Date;
}

RecordingChunk.init(
  {
    chunkId: {
      type: DataTypes.STRING,
      primaryKey: true
    },
    sessionId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    chunkIndex: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    checksum: {
      type: DataTypes.STRING,
      allowNull: false
    },
    filePath: {
      type: DataTypes.STRING,
      allowNull: false
    },
    uploadedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    sequelize,
    modelName: 'RecordingChunk',
    tableName: 'recording_chunks',
    timestamps: false
  }
);

// Establish relationship
Recording.hasMany(RecordingChunk, { foreignKey: 'sessionId', as: 'chunks' });
RecordingChunk.belongsTo(Recording, { foreignKey: 'sessionId' });

export async function initDatabase() {
  await sequelize.authenticate();
  await sequelize.sync();
  console.log('Database synced successfully.');
}

export { sequelize };
