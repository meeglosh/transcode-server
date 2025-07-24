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

app.post('/api/transcode', upload.single('audio'), async (req, res) => {
  const { file } = req;
  const { originalname } = file;
  const fileId = uuidv4();
  const inputPath = `/tmp/${fileId}-${originalname}`;
  let requestedFormat = (req.query.format || 'mp3').toLowerCase();

  // Validate supported formats
  if (!['aac', 'mp3'].includes(requestedFormat)) {
    return res.status(400).json({ error: `Unsupported format: ${requestedFormat}` });
  }

  // Dynamic vars based on output format
  let outputFormat = requestedFormat;
  let outputExt = outputFormat === 'aac' ? 'm4a' : 'mp3';
  let contentType = outputFormat === 'aac' ? 'audio/mp4' : 'audio/mpeg';
  let outputPath = `/tmp/${fileId}.${outputExt}`;

  console.log(`\n=== Transcoding ${originalname} to ${outputFormat.toUpperCase()} ===`);

  try {
    await fs.writeFile(inputPath, file.buffer);

    const transcodeTo = (codec, outPath) => {
      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .audioCodec(codec)
          .audioBitrate(320)
          .audioChannels(2)
          .audioFrequency(44100)
          .on('end', () => resolve(outPath))
          .on('error', reject)
          .save(outPath);
      });
    };

    try {
      const codec = outputFormat === 'aac' ? 'aac' : 'libmp3lame';
      await transcodeTo(codec, outputPath);
    } catch (primaryError) {
      console.warn(`⚠️ Primary transcode to ${outputFormat} failed:`, primaryError);

      if (outputFormat !== 'mp3') {
        console.log('🔁 Falling back to MP3...');
        outputFormat = 'mp3';
        outputExt = 'mp3';
        contentType = 'audio/mpeg';
        outputPath = `/tmp/${fileId}.mp3`;
        await transcodeTo('libmp3lame', outputPath);
      } else {
        throw primaryError;
      }
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const fileBuffer = await fs.readFile(outputPath);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('transcoded-audio')
      .upload(`${fileId}.${outputExt}`, fileBuffer, {
        contentType,
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
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
    try { await fs.unlink(inputPath); } catch {}
    try { await fs.unlink(outputPath); } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`🎧 Transcoding server listening on port ${PORT}`);
});
