import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs/promises';

const app = express();
const upload = multer();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors({
  origin: [
    'https://964c4d45-feaa-4b3e-9e2b-b8dbb89f0f2f.lovableproject.com',
    'https://*.lovableproject.com',
    'https://wovenmusic.app',
    'http://localhost:5173'
  ]
}));

// Health check route
app.get('/health', (req, res) => {
  res.send('OK');
});

// POST /transcode
app.post('/transcode', upload.single('audio'), async (req, res) => {
  try {
    const { file } = req;
    const { originalname } = file;
    const fileId = uuidv4();
    const tempInputPath = `/tmp/${fileId}-${originalname}`;
    const tempOutputPath = `/tmp/${fileId}.mp3`;

    console.log(`Saving uploaded file: ${originalname}`);
    await fs.writeFile(tempInputPath, file.buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .audioBitrate(256)
        .toFormat('mp3')
        .on('end', resolve)
        .on('error', reject)
        .save(tempOutputPath);
    });

    console.log('Transcoding complete, uploading to Supabase...');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase.storage
      .from('transcoded-audio')
      .upload(`${fileId}.mp3`, await fs.readFile(tempOutputPath), {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (error) {
      console.error('Upload error:', error);
      return res.status(500).json({ error: 'Failed to upload file' });
    }

    const {
      data: { publicUrl }
    } = supabase.storage
      .from('transcoded-audio')
      .getPublicUrl(`${fileId}.mp3`);

    console.log(`Returning public URL: ${publicUrl}`);
    res.json({
      publicUrl,
      originalFilename: path.parse(originalname).name
    });
  } catch (err) {
    console.error('Transcoding error:', err);
    res.status(500).json({ error: 'Transcoding failed' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
