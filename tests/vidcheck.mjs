// проверка ролика: кадры (0.3, 1.5, 3, 5, 7, 9.5 с — по частям эталона) + звук 16 кГц моно для распознавания речи
// node vidcheck.mjs <video.mp4> <outdir>
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const [video, out] = process.argv.slice(2);
fs.mkdirSync(out, {recursive: true});
const srv = http.createServer((q, r) => {
  if (q.url === '/v.mp4') {   // кусками (Range) — иначе видео не перематывается и все кадры — первый
    const size = fs.statSync(video).size, m = /bytes=(\d+)-(\d*)/.exec(q.headers.range || '');
    if (!m) { r.writeHead(200, {'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes'}); return fs.createReadStream(video).pipe(r); }
    const a = +m[1], b = m[2] ? +m[2] : size - 1;
    r.writeHead(206, {'Content-Type': 'video/mp4', 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes'});
    return fs.createReadStream(video, {start: a, end: b}).pipe(r);
  }
  r.writeHead(200, {'Content-Type': 'text/html'}); r.end('<!doctype html><body></body>');
}).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/`;
const b = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']});
const p = await b.newPage();
await p.goto(url);
const res = await p.evaluate(async () => {
  const v = document.createElement('video'); v.src = '/v.mp4'; v.muted = true; v.preload = 'auto';
  await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error('видео не открылось')); });
  const shots = [];
  for (const t of [0.3, 1.5, 3, 5, 7, 9.5].filter(t => t < v.duration)) {
    v.currentTime = t; await new Promise(r => v.onseeked = r);
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0); shots.push([t, c.toDataURL('image/jpeg', 0.85)]);
  }
  // звук → 16 кГц моно
  const buf = await (await fetch('/v.mp4')).arrayBuffer();
  let pcm = null;
  try {
    const ac = new OfflineAudioContext(1, 16000, 16000), dec = await ac.decodeAudioData(buf);
    const oc = new OfflineAudioContext(1, Math.ceil(dec.duration * 16000), 16000), s = oc.createBufferSource();
    s.buffer = dec; s.connect(oc.destination); s.start(); pcm = Array.from((await oc.startRendering()).getChannelData(0), x => Math.round(Math.max(-1, Math.min(1, x)) * 32767));
  } catch (e) { pcm = null; }
  return {dur: v.duration, w: v.videoWidth, h: v.videoHeight, shots, pcm};
});
for (const [t, d] of res.shots) fs.writeFileSync(path.join(out, `f${String(t).replace('.', '_')}.jpg`), Buffer.from(d.split(',')[1], 'base64'));
if (res.pcm) {
  const n = res.pcm.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  res.pcm.forEach((x, i) => buf.writeInt16LE(x, 44 + i * 2));
  fs.writeFileSync(path.join(out, 'audio.wav'), buf);
}
console.log(JSON.stringify({dur: +res.dur.toFixed(2), size: `${res.w}x${res.h}`, frames: res.shots.length, audio: !!res.pcm}));
await b.close(); srv.close();
