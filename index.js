// index.js
import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { config } from 'dotenv';
import cors from 'cors';

config();

const app = express();

app.use(cors({
  origin: 'https://964c4d45-feaa-4b3e-9e2b-b8dbb89f0f2f.lovableproject.com'
}));

const port = process.env.PORT || 3000;

if (!port) {
  console.error("❌ PORT environment variable is not set!");
  process.exit(1);
}

const upload = multer({ dest: 'uploads/' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    global: {
      fetch: (url, options = {}) => fetch(url, { ...options, duplex: 'half' })
    }
  }
);

app.post('/transcode', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const inputPath = req.file.path;
    const outputFileName = path.parse(req.file.originalname).name + '.mp3';
    const outputPath = `outputs/${outputFileName}`;

    console.log(`🎧 Transcoding file: ${req.file.originalname}`);

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-b:a', '320k', outputPath]);

      ffmpeg.stderr.on('data', data => console.error(`ffmpeg stderr: ${data}`));
      ffmpeg.on('close', code => {
        if (code === 0) {
          console.log(`✅ FFmpeg finished successfully`);
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', err => {
        reject(new Error(`Failed to start FFmpeg: ${err.message}`));
      });
    });

    const { data, error } = await supabase.storage
      .from('transcoded-audio')
      .upload(outputFileName, fs.createReadStream(outputPath), {
        contentType: 'audio/mpeg',
        upsert: true
      });

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    if (error || !data || !data.path) {
      console.error("❌ Supabase upload error or missing path:", error);
      return res.status(500).json({ error: error?.message || 'Upload failed or missing path' });
    }

    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/transcoded-audio/${outputFileName}`;
    console.log(`✅ File uploaded and accessible at: ${publicUrl}`);
    return res.status(200).json({ success: true, url: publicUrl });

  } catch (err) {
    console.error("❌ Transcoding error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Transcode server listening on port ${port}`);
});
