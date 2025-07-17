import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { v4 as uuidv4 } from 'uuid';
import tmp from 'tmp';
import fetch from 'node-fetch';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ storage: multer.memoryStorage() });

app.get('/ping', (req, res) => {
  res.send('pong');
});

app.use(cors({
  origin: [
    'https://964c4d45-feaa-4b3e-9e2b-b8dbb89f0f2f.lovableproject.com',
    /\.lovableproject\.com$/,
    'http://localhost:5173'
  ]
}));

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.post('/transcode', upload.single('audio'), async (req, res) => {
  const { originalname } = req.file;
  const tempInputPath = tmp.tmpNameSync({ postfix: path.extname(originalname) });
  const tempOutputPath = tmp.tmpNameSync({ postfix: '.mp3' });

  try {
    // Save the file locally
    fs.writeFileSync(tempInputPath, req.file.buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .audioBitrate(128)
        .toFormat('mp3')
        .on('end', resolve)
        .on('error', reject)
        .save(tempOutputPath);
    });

    const fileData = fs.readFileSync(tempOutputPath);
    const fileName = `${uuidv4()}.mp3`;

    const { error } = await supabase.storage
      .from('transcoded-audio')
      .upload(fileName, fileData, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (error) throw error;

    const { data } = supabase.storage
      .from('transcoded-audio')
      .getPublicUrl(fileName);

    res.json({ publicUrl: data.publicUrl });
  } catch (error) {
    console.error('Transcoding error:', error);
    res.status(500).send('Internal Server Error');
  } finally {
    [tempInputPath, tempOutputPath].forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
  }
});

app.listen(port, () => {
  console.log(`Transcoding server listening on port ${port}`);
});
