// Инструменты монтажа: ffmpeg (резка, склейка, рендер) и whisper.cpp (субтитры по словам) — бесплатно, на этом компьютере.
// Как voice-env у split.js: при первом запуске сами скачиваются в папку Freefield\tools (~110 МБ + ~190 МБ модель), один раз.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {HERE} from './state.js';
import {readConfig} from './config.js';

const WIN = process.platform === 'win32';
export const TOOLS = process.env.FREEFIELD_TOOLS || path.join(HERE, '..', 'tools');
const FFMPEG_ZIP = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip';
const WHISPER_ZIP = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-blas-bin-x64.zip';
const WHISPER_MODELS = {   // small — хорошо понимает русский; base — быстрее, хуже
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
  medium: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
};

export function run(cmd, args, {onLine = () => {}, stdout = null, cwd} = {}) {
  return new Promise(res => {
    let tail = '';
    const ch = spawn(cmd, args, {windowsHide: true, cwd});
    const eat = d => { tail = (tail + d).slice(-6000); String(d).split(/\r?\n|\r/).filter(Boolean).forEach(onLine); };
    if (stdout) ch.stdout.on('data', stdout); else ch.stdout.on('data', eat);
    ch.stderr.on('data', eat);
    ch.on('error', e => res({code: -1, tail: e.message}));
    ch.on('exit', code => res({code, tail}));
  });
}
export const lastErr = t => (String(t).trim().split(/\r?\n/).filter(l => /error|invalid|not found|failed|не /i.test(l)).pop() || String(t).trim().split(/\r?\n/).pop() || '').slice(0, 300);

async function download(url, file, note, label) {
  const r = await fetch(url, {redirect: 'follow'});
  if (!r.ok || !r.body) throw new Error(`${label}: не скачался (${r.status})`);
  const total = +r.headers.get('content-length') || 0;
  let got = 0, shown = -1;
  const body = Readable.fromWeb(r.body);
  body.on('data', b => {
    got += b.length;
    const pct = total ? Math.floor(got / total * 100 / 5) * 5 : Math.floor(got / 1e7);
    if (pct !== shown) { shown = pct; note(`Скачиваю ${label}: ${total ? pct + ' %' : Math.round(got / 1e6) + ' МБ'}`); }
  });
  const tmp = file + '.part';
  await pipeline(body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, file);
}
// zip распаковывает встроенный в Windows tar (bsdtar), не tar из Git
async function unzip(zip, dir) {
  fs.mkdirSync(dir, {recursive: true});
  const tar = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'unzip';
  const r = WIN ? await run(tar, ['-xf', zip, '-C', dir]) : await run(tar, ['-q', '-o', zip, '-d', dir]);
  if (r.code !== 0) throw new Error('не распаковался архив: ' + lastErr(r.tail));
}
const findFile = (dir, name) => {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
  }
  return null;
};

const once = new Map();   // одна установка каждого инструмента за раз
const single = (key, fn) => { if (!once.has(key)) once.set(key, fn().finally(() => once.delete(key))); return once.get(key); };

// ffmpeg: config.json "ffmpeg" → tools\ffmpeg → скачать
export async function ensureFfmpeg(note = () => {}) {
  const cfg = readConfig().ffmpeg;
  if (typeof cfg === 'string' && fs.existsSync(cfg)) return {ffmpeg: cfg, ffprobe: path.join(path.dirname(cfg), WIN ? 'ffprobe.exe' : 'ffprobe')};
  const dir = path.join(TOOLS, 'ffmpeg');
  const exe = path.join(dir, WIN ? 'ffmpeg.exe' : 'ffmpeg'), probe = path.join(dir, WIN ? 'ffprobe.exe' : 'ffprobe');
  if (fs.existsSync(exe) && fs.existsSync(probe)) return {ffmpeg: exe, ffprobe: probe};
  if (!WIN) throw new Error('ffmpeg не найден — установите ffmpeg или впишите путь в config.json Freefield: "ffmpeg"');
  await single('ffmpeg', async () => {
    note('Первый раз: ставлю ffmpeg для монтажа (~110 МБ, один раз)…');
    const work = path.join(TOOLS, 'dl-ffmpeg');
    fs.rmSync(work, {recursive: true, force: true}); fs.mkdirSync(work, {recursive: true});
    const zip = path.join(work, 'ffmpeg.zip');
    await download(FFMPEG_ZIP, zip, note, 'ffmpeg');
    note('Распаковываю ffmpeg…');
    await unzip(zip, path.join(work, 'x'));
    fs.mkdirSync(dir, {recursive: true});
    for (const n of ['ffmpeg.exe', 'ffprobe.exe']) {
      const f = findFile(path.join(work, 'x'), n);
      if (!f) throw new Error('в архиве ffmpeg нет ' + n);
      fs.copyFileSync(f, path.join(dir, n));
    }
    fs.rmSync(work, {recursive: true, force: true});
  });
  return {ffmpeg: exe, ffprobe: probe};
}

// whisper.cpp + модель: config.json "whisper_model" = small (по умолчанию) | base | medium
export async function ensureWhisper(note = () => {}) {
  const dir = path.join(TOOLS, 'whisper');
  const exe = path.join(dir, WIN ? 'whisper-cli.exe' : 'whisper-cli');
  const size = WHISPER_MODELS[readConfig().whisper_model] ? readConfig().whisper_model : 'small';
  const model = path.join(dir, path.basename(WHISPER_MODELS[size]));
  if (!WIN && !fs.existsSync(exe)) throw new Error('субтитры на этом компьютере пока только для Windows');
  await single('whisper-' + size, async () => {
    if (!fs.existsSync(exe)) {
      note('Первый раз: ставлю распознавание речи whisper.cpp (~15 МБ, один раз)…');
      const work = path.join(TOOLS, 'dl-whisper');
      fs.rmSync(work, {recursive: true, force: true}); fs.mkdirSync(work, {recursive: true});
      const zip = path.join(work, 'whisper.zip');
      await download(WHISPER_ZIP, zip, note, 'whisper.cpp');
      await unzip(zip, path.join(work, 'x'));
      const cli = findFile(path.join(work, 'x'), 'whisper-cli.exe');
      if (!cli) throw new Error('в архиве whisper.cpp нет whisper-cli.exe');
      fs.mkdirSync(dir, {recursive: true});
      for (const f of fs.readdirSync(path.dirname(cli))) if (/\.dll$/i.test(f) || f.toLowerCase() === 'whisper-cli.exe') fs.copyFileSync(path.join(path.dirname(cli), f), path.join(dir, f));
      fs.rmSync(work, {recursive: true, force: true});
    }
    if (!fs.existsSync(model)) {
      note(`Первый раз: скачиваю модель распознавания речи (${size}, ~${size === 'small' ? 190 : size === 'base' ? 60 : 540} МБ, один раз)…`);
      fs.mkdirSync(dir, {recursive: true});
      await download(WHISPER_MODELS[size], model, note, 'модель Whisper');
    }
  });
  return {whisper: exe, model};
}
