import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

ffmpeg.setFfmpegPath(ffmpegPath.path);

const app = express();
const port = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

app.post('/transcode', upload.single('file'), async (req, res) => {
  try {
    const { file } = req;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const duration = parseFloat(req.body.duration);
    const bitrate = duration > 300 ? '128k' : '192k';

    const mp3Filename = `${uuidv4()}.mp3`;
    const mp3FilePath = `transcoded/${mp3Filename}`;

    // Ensure the transcoded directory exists
    fs.mkdirSync('transcoded', { recursive: true });

    await new Promise((resolve, reject) => {
      ffmpeg(file.path)
        .audioBitrate(bitrate)
        .toFormat('mp3')
        .on('end', resolve)
        .on('error', reject)
        .save(mp3FilePath);
    });

    const mp3Buffer = fs.readFileSync(mp3FilePath);

    const uploadResult = await supabase.storage
      .from('transcoded-audio')
      .upload(mp3Filename, mp3Buffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    fs.unlinkSync(file.path);
    fs.unlinkSync(mp3FilePath);

    if (uploadResult.error) {
      console.error(uploadResult.error);
      return res.status(500).json({ error: 'Failed to upload to Supabase' });
    }

    const publicUrlResult = supabase.storage
      .from('transcoded-audio')
      .getPublicUrl(mp3Filename);

    if (!publicUrlResult?.data?.publicUrl) {
      console.error('Failed to generate public URL');
      return res.status(500).json({ error: 'No public URL returned' });
    }

    return res.json({ publicUrl: publicUrlResult.data.publicUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Transcoding failed' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
