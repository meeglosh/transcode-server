// index.js
import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch'; // ← added
import { config } from 'dotenv';

config();

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

app.post('/transcode', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputFileName = path.parse(req.file.originalname).name + '.mp3';
    const outputPath = `outputs/${outputFileName}`;

    // Run FFmpeg to transcode
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-i', inputPath, '-b:a', '320k', outputPath]);
      ffmpeg.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });
    });

    // Upload using fetch with duplex: 'half'
    const uploadUrl = `${process.env.SUPABASE_URL}/storage/v1/object/${encodeURIComponent('transcoded-audio/' + outputFileName)}`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'audio/mpeg'
      },
      body: fs.createReadStream(outputPath),
      duplex: 'half' // 👈 important for stream upload
    });

    const responseBody = await response.json();

    // Clean up files
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    if (!response.ok) {
      return res.status(500).json({ error: `Supabase upload failed: ${response.statusText}`, details: responseBody });
    }

    return res.status(200).json({ success: true, path: responseBody.Key || outputFileName });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Transcode server listening on port ${port}`);
});
