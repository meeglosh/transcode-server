import express from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import tmp from 'tmp';
import fs from 'fs';

const app = express();
const upload = multer();
const port = process.env.PORT || 3000;

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const supabase = createClient(
  'https://woakvdhlpludrttjixxq.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json());

app.post('/transcode', upload.none(), async (req, res) => {
  const fileUrl = req.body.fileUrl;
  const originalFilename = req.body.filename || 'audio.wav';

  if (!fileUrl) {
    return res.status(400).json({ error: 'Missing fileUrl' });
  }

  try {
    console.log(`Fetching file from: ${fileUrl}`);
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const wavBuffer = Buffer.from(arrayBuffer);

    const inputTmpFile = tmp.tmpNameSync({ postfix: '.wav' });
    const outputTmpFile = tmp.tmpNameSync({ postfix: '.mp3' });

    fs.writeFileSync(inputTmpFile, wavBuffer);

    const bitrate = originalFilename.toLowerCase().includes('ctf') ? '128k' : '192k';

    await new Promise((resolve, reject) => {
      ffmpeg(inputTmpFile)
        .audioBitrate(bitrate)
        .toFormat('mp3')
        .on('error', reject)
        .on('end', resolve)
        .save(outputTmpFile);
    });

    const mp3Buffer = fs.readFileSync(outputTmpFile);
    const filename = `${uuidv4()}.mp3`;

    const uploadResult = await supabase.storage
      .from('transcoded-audio')
      .upload(filename, mp3Buffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadResult.error) {
      console.error('Supabase upload error:', uploadResult.error);
      return res.status(500).json({ error: 'Upload to Supabase failed', details: uploadResult.error });
    }

    const publicUrlResult = supabase.storage
      .from('transcoded-audio')
      .getPublicUrl(filename);

    if (!publicUrlResult || !publicUrlResult.data || !publicUrlResult.data.publicUrl) {
      return res.status(500).json({ error: 'Failed to generate public URL' });
    }

    return res.json({ publicUrl: publicUrlResult.data.publicUrl });
  } catch (error) {
    console.error('Server-side transcoding error:', error);
    return res.status(500).json({ error: 'Server-side error during transcoding', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Transcoding server listening at http://localhost:${port}`);
});
