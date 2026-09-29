// Фото-референсы: присланные в чат Claude Code, отправленные из приложения (телефона) или просто файлом.
// Все сохраняются в outputs/refs/ (одинаковое фото — один файл), дальше их путь передаётся в генерацию:
// видео — оживить картинку (Arena), картинка — сделать по референсу (Flow Nano Banana 2 / Dola Seedream).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'};

export function saveRef(outDir, buf, mime) {
  if (!EXT[mime]) throw new Error('фото-референс должен быть png, jpg, webp или gif');
  if (buf.length > 15e6) throw new Error('фото-референс больше 15 МБ');
  const dir = path.join(outDir, 'refs');
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `ref-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)}.${EXT[mime]}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return file;
}

// data:image/jpeg;base64,… (так фото приходит из приложения)
export function saveDataUrl(outDir, url) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (!m) throw new Error('фото-референс не распознано');
  return saveRef(outDir, Buffer.from(m[2], 'base64'), m[1]);
}

// Claude Code хранит переписку на этом компьютере: ~/.claude/projects/<папка проекта>/<чат>.jsonl — фото там в base64.
// Берём последние фото, которые прислал сам пользователь (не скриншоты инструментов), из самого свежего чата.
export function chatPhotos(outDir, count = 1) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(root)) return {photos: [], chat: null};
  const chats = fs.readdirSync(root).flatMap(d => {
    try { return fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')).map(f => path.join(root, d, f)); } catch { return []; }
  }).map(f => ({f, t: fs.statSync(f).mtimeMs})).sort((a, b) => b.t - a.t).slice(0, 3);
  for (const {f} of chats) {
    const found = [];
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.includes('"image"')) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      // обычное сообщение пользователя или сообщение, присланное, пока Claude работал (attachment → prompt)
      const blocks = j.type === 'user' ? j.message?.content : j.type === 'attachment' ? j.attachment?.prompt : null;
      if (!Array.isArray(blocks)) continue;
      for (const c of blocks)
        if (c.type === 'image' && c.source?.type === 'base64' && EXT[c.source.media_type]) found.push({data: c.source.data, mime: c.source.media_type, at: j.timestamp || null});
    }
    if (found.length) return {chat: f, photos: found.slice(-count).map(p => ({path: saveRef(outDir, Buffer.from(p.data, 'base64'), p.mime), mime: p.mime, at: p.at}))};
  }
  return {photos: [], chat: chats[0]?.f || null};
}
