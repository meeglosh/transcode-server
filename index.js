// index.js
import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { config } from 'dotenv';

config();

const app = express();
const port = process.env.PORT;

if (!port) {
  console.error("❌ PORT environment variable is not set!");
  process.exit(1);
}

const upload = multer({ dest: 'uploads/' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.post('/transcode', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputFileName = path.parse(req.file.originalname).name + '.mp3';
    const outputPath = `outputs/${outputFileName}`;

    console.log(`🎧 Transcoding file: ${req.file.originalname}`);

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-i', inputPath, '-b:a', '320k', outputPath]);

      ffmpeg.stdout.on('data', data => console.log(`ffmpeg stdout: ${data}`));
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

    const fileStream = fs.createReadStream(outputPath);

    const { data, error } = await supabase.storage
      .from('transcoded-audio')
      .upload(outputFileName, fileStream, {
        contentType: 'audio/mpeg'
      });

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    if (error) {
      console.error("❌ Supabase upload error:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`✅ File uploaded to Supabase: ${data.path}`);
    return res.status(200).json({ success: true, path: data.path });

  } catch (err) {
    console.error("❌ Transcoding error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Transcode server listening on port ${port}`);
});
