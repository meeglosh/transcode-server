import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import fetch from 'node-fetch';

const app = express();
const upload = multer({
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'https://wovenmusic.app',
    'https://964c4d45-feaa-4b3e-9e2b-b8dbb89f0f2f.lovableproject.com',
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.send('OK');
});

app.post('/api/transcode', upload.single('audio'), async (req, res) => {
  let fileBuffer;
  let fileName;
  let source = '';

  const fileId = uuidv4();
  const outputFormat = (req.body.outputFormat || 'mp3').toLowerCase();
  const bitrate = (req.body.bitrate || '320k').replace('k', '');
  const supportedFormats = ['aac', 'mp3'];

  if (!supportedFormats.includes(outputFormat)) {
    return res.status(400).json({ error: `Unsupported format: ${outputFormat}` });
  }

  const ext = outputFormat === 'aac' ? 'm4a' : 'mp3';
  const codec = outputFormat === 'aac' ? 'aac' : 'libmp3lame';
  const contentType = outputFormat === 'aac' ? 'audio/mp4' : 'audio/mpeg';
  const inputPath = `/tmp/${fileId}-input`;
  const outputPath = `/tmp/${fileId}.${ext}`;

  if (req.file) {
  console.log('📤 Received file upload:', req.file.originalname, req.file.mimetype);
  fileBuffer = req.file.buffer;
  fileName = req.file.originalname;
  source = 'upload';
  } else if (req.body.audioUrl && req.body.fileName) {
    try {
      const response = await fetch(req.body.audioUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      fileName = req.body.fileName;
      source = 'url';
    } catch (err) {
      console.error('❌ Error fetching remote audio file:', err);
      return res.status(500).json({ error: 'Failed to download remote audio file' });
    }
  } else {
    return res.status(400).json({ error: 'No audio file or URL provided' });
  }

  try {
    await fs.writeFile(inputPath, fileBuffer);

    console.log(`🎧 Transcoding (${source}): ${fileName} → ${outputFormat.toUpperCase()}`);
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec(codec)
        .audioBitrate(bitrate)
        .audioChannels(2)
        .audioFrequency(44100)
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const transcodedBuffer = await fs.readFile(outputPath);

    const { data, error } = await supabase.storage
      .from('transcoded-audio')
      .upload(`${fileId}.${ext}`, transcodedBuffer, {
        contentType,
        upsert: true
      });

    if (error) {
      console.error('❌ Supabase upload error:', error);
      return res.status(500).json({ error: 'Failed to upload to Supabase' });
    }

    const {
      data: { publicUrl }
    } = supabase.storage.from('transcoded-audio').getPublicUrl(`${fileId}.${ext}`);

    console.log(`✅ Transcoding successful: ${publicUrl}`);

    res.json({
      publicUrl,
      originalFilename: path.parse(fileName).name,
      originalSize: fileBuffer.length,
      transcodedSize: transcodedBuffer.length
    });
  } catch (err) {
    console.error('❌ Transcoding pipeline failed:', err);
    res.status(500).json({ error: 'Transcoding failed' });
  } finally {
    try { await fs.unlink(inputPath); } catch {}
    try { await fs.unlink(outputPath); } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`🎧 Transcoding server listening on port ${PORT}`);
});
