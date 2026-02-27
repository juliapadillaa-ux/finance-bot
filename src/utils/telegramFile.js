import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function telegramGetFileUrl(token, fileId) {
  const r = await axios.get(`https://api.telegram.org/bot${token}/getFile`, { params: { file_id: fileId } });
  if (!r.data?.ok) throw new Error(`Telegram getFile failed: ${JSON.stringify(r.data)}`);
  const filePath = r.data.result.file_path;
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

export async function downloadToTmp(url, filenameHint = 'file') {
  const tmpDir = os.tmpdir();
  const outPath = path.join(tmpDir, `${Date.now()}-${filenameHint}`);
  const w = fs.createWriteStream(outPath);
  const r = await axios.get(url, { responseType: 'stream', timeout: 60000 });
  await new Promise((resolve, reject) => {
    r.data.pipe(w);
    w.on('finish', resolve);
    w.on('error', reject);
  });
  return outPath;
}
