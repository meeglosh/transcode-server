import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';

const app = express();
const upload = multer();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'https://964c4d45-feaa-4b3e-9e2b-b8dbb89f0f2f.lovableproject.com',
    'https://*.lovableproject.com',
    'https://wovenmusic.app',
    'http://localhost:5173'
  ]
}));

app.get('/health', (req, res) => {
  res.send('OK');
});

app.post('/transcode', upload.single('audio'), async (req, res) => {
  const { file } = req;
  const { originalname } = file;
  const fileId = uuidv4();
  const inputPath = `/tmp/${fileId}-${originalname}`;
  const requestedFormat = (req.query.format || 'mp3').toLowerCase();
  const outputFormat = requestedFormat === 'aac' ? 'aac' : 'mp3';
  const outputExt = outputFormat === 'aac' ? 'm4a' : 'mp3';
  const contentType = outputFormat === 'aac' ? 'audio/mp4' : 'audio/mpeg';
  const outputPath = `/tmp/${fileId}.${outputExt}`;

  console.log(`\n=== Transcoding ${originalname} to ${outputFormat} ===`);

  try {
    await fs.writeFile(inputPath, file.buffer);

    const transcodeTo = (format, outPath) => {
      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .audioCodec(format === 'aac' ? 'aac' : 'libmp3lame')
          .audioBitrate(320)
          .audioChannels(2)
          .audioFrequency(44100)
          .on('end', () => resolve(outPath))
          .on('error', reject)
          .save(outPath);
      });
    };

    try {
      await transcodeTo(outputFormat, outputPath);
    } catch (primaryError) {
      console.warn(`Primary transcode to ${outputFormat} failed:`, primaryError);

      if (outputFormat !== 'mp3') {
        console.log('Falling back to MP3...');
        outputFormat = 'mp3';
        outputExt = 'mp3';
        contentType = 'audio/mpeg';
        const fallbackPath = `/tmp/${fileId}.mp3`;
        await transcodeTo('mp3', fallbackPath);
      } else {
        throw primaryError;
      }
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const fileBuffer = await fs.readFile(`/tmp/${fileId}.${outputExt}`);

    const { data, error } = await supabase.storage
      .from('transcoded-audio')
      .upload(`${fileId}.${outputExt}`, fileBuffer, {
        contentType,
        upsert: true
      });

    if (error) {
      console.error('Upload error:', error);
      return res.status(500).json({ error: 'Upload to Supabase failed.' });
    }

    const {
      data: { publicUrl }
    } = supabase.storage
      .from('transcoded-audio')
      .getPublicUrl(`${fileId}.${outputExt}`);

    console.log(`✅ Transcoding successful: ${publicUrl}`);

    res.json({
      publicUrl,
      originalFilename: path.parse(originalname).name
    });
  } catch (err) {
    console.error('❌ Transcoding pipeline error:', err);
    res.status(500).json({ error: 'Transcoding failed' });
  } finally {
    // Clean up
    try {
      await fs.unlink(inputPath);
      await fs.unlink(outputPath);
    } catch (e) {
      // File might not exist
    }
  }
});

app.listen(PORT, () => {
  console.log(`🎧 Transcoding server listening on port ${PORT}`);
});
