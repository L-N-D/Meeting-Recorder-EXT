import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Recording, RecordingChunk } from './database';

const router = Router();

// Setup upload folder directories
const CHUNKS_DIR = path.resolve(__dirname, '../../uploads/chunks');
const ASSEMBLED_DIR = path.resolve(__dirname, '../../uploads/assembled');

fs.mkdirSync(CHUNKS_DIR, { recursive: true });
fs.mkdirSync(ASSEMBLED_DIR, { recursive: true });

// Configure multer storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// --- Cryptographic Hash Helpers ---
function calculateSHA256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Health check endpoint
router.get('/recordings/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// 1. Create Recording Session
router.post('/recordings', async (req: Request, res: Response) => {
  try {
    const { sessionId, platform, startedAt } = req.body;
    if (!sessionId || !platform || !startedAt) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    let rec = await Recording.findByPk(sessionId);
    if (!rec) {
      rec = await Recording.create({
        sessionId,
        platform,
        startedAt: new Date(startedAt),
        status: 'recording'
      });
      console.log(`Created new recording session: ${sessionId}`);
    } else {
      // If it exists but was created as a placeholder (e.g., platform is 'unknown'), update it
      let updated = false;
      if (rec.platform === 'unknown' && platform !== 'unknown') {
        rec.platform = platform;
        updated = true;
      }
      // Compare dates using getTime() if both exist
      const clientDate = new Date(startedAt);
      if (rec.startedAt && rec.startedAt.getTime() !== clientDate.getTime()) {
        rec.startedAt = clientDate;
        updated = true;
      }
      if (updated) {
        await rec.save();
        console.log(`Updated placeholder recording session with client metadata: ${sessionId}`);
      }
    }

    res.status(201).json(rec);
  } catch (err: any) {
    console.error('Error creating recording:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Upload Chunk (Idempotency and Checksum validation)
router.post('/recordings/:id/chunks', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    const { chunkIndex, checksum } = req.body;
    const file = req.file;
    const idempotencyKey = req.headers['idempotency-key'] as string;

    if (!file || chunkIndex === undefined || !checksum || !idempotencyKey) {
      return res.status(400).json({ error: 'Missing file, chunkIndex, checksum or Idempotency-Key' });
    }

    // A. Check Idempotency
    const existingChunk = await RecordingChunk.findByPk(idempotencyKey);
    if (existingChunk) {
      console.log(`Duplicate chunk upload detected (Idempotent): ${idempotencyKey}. Skipping duplicate write.`);
      return res.status(200).json({ success: true, message: 'Chunk already saved (idempotent)' });
    }

    // B. Verify Checksum Integrity
    const calculatedChecksum = calculateSHA256(file.buffer);
    if (calculatedChecksum !== checksum) {
      console.error(`Checksum mismatch! Expected: ${checksum}, Calculated: ${calculatedChecksum}`);
      return res.status(400).json({ error: 'Data integrity error: SHA-256 checksum mismatch' });
    }

    // C. Save chunk file to disk
    const chunkFileName = `${sessionId}_${chunkIndex}.webm`;
    const chunkFilePath = path.join(CHUNKS_DIR, chunkFileName);
    fs.writeFileSync(chunkFilePath, file.buffer);

    // D. Persist chunk meta
    // Ensure the recording session exists to prevent foreign key constraint failures
    let rec = await Recording.findByPk(sessionId);
    if (!rec) {
      rec = await Recording.create({
        sessionId,
        platform: 'unknown',
        startedAt: new Date(),
        status: 'recording'
      });
      console.log(`Created placeholder recording session for chunk: ${sessionId}`);
    }

    const chunk = await RecordingChunk.create({
      chunkId: idempotencyKey,
      sessionId,
      chunkIndex: parseInt(chunkIndex, 10),
      checksum,
      filePath: chunkFilePath,
      uploadedAt: new Date()
    });

    console.log(`Saved chunk index ${chunkIndex} for session ${sessionId}.`);
    res.status(201).json({ success: true, chunkId: chunk.chunkId });

  } catch (err: any) {
    console.error('Error saving chunk:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Mark Recording Completed & Trigger Stream Assembly
router.post('/recordings/:id/complete', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    const rec = await Recording.findByPk(sessionId);
    if (!rec) {
      return res.status(404).json({ error: 'Recording session not found' });
    }

    // Load all chunks sorted by index
    const chunks = await RecordingChunk.findAll({
      where: { sessionId },
      order: [['chunkIndex', 'ASC']]
    });

    if (chunks.length === 0) {
      return res.status(400).json({ error: 'No chunks found for this recording' });
    }

    // Verify there are no missing indices
    const indices = chunks.map(c => c.chunkIndex);
    const maxIndex = Math.max(...indices);
    const missingIndices: number[] = [];
    for (let i = 0; i <= maxIndex; i++) {
      if (!indices.includes(i)) {
        missingIndices.push(i);
      }
    }

    if (missingIndices.length > 0) {
      console.warn(`Recording completion warning: missing chunk indices: ${missingIndices.join(', ')}`);
      // In production you might queue a retry, but here we compile what we have or return error.
      // We will assemble what we have to be resilient, but return warning in details.
    }

    // Perform sequential assembly
    const finalFileName = `${sessionId}.webm`;
    const finalFilePath = path.join(ASSEMBLED_DIR, finalFileName);
    const writeStream = fs.createWriteStream(finalFilePath);

    for (const chunk of chunks) {
      if (fs.existsSync(chunk.filePath)) {
        const data = fs.readFileSync(chunk.filePath);
        writeStream.write(data);
      } else {
        console.error(`Chunk file missing during compilation: ${chunk.filePath}`);
      }
    }
    writeStream.end();

    // Update session status
    rec.status = 'completed';
    rec.endedAt = new Date();
    await rec.save();

    console.log(`Successfully assembled raw stream for session ${sessionId} to: ${finalFilePath}`);
    
    res.json({
      success: true,
      message: 'Assembly complete',
      filePath: finalFilePath,
      missingChunks: missingIndices
    });

  } catch (err: any) {
    console.error('Error compiling chunks:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Retrieve Status
router.get('/recordings/:id/status', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    const rec = await Recording.findByPk(sessionId, {
      include: [{ model: RecordingChunk, as: 'chunks' }]
    });

    if (!rec) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(rec);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
