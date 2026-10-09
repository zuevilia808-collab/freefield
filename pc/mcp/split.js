// Звук ролика → голос отдельно и фон отдельно (Demucs — открытая модель, бесплатно, на этом компьютере).
// Нужен для «🎙 Голос персонажа» (пользователь 2026-10-09): Flow свой голос загрузить не даёт, поэтому Flow говорит своим
// голосом, а приложение меняет тембр только голосовой дорожки и кладёт обратно на фон — шаги, ветер, посуда остаются,
// губы совпадают (слова и паузы те же). Python и Demucs ставятся один раз сами в папку Freefield\voice-env (~1 ГБ).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {HERE} from './state.js';
import {readConfig} from './config.js';

const WIN = process.platform === 'win32';
const ENV = process.env.FREEFIELD_VOICE_ENV || path.join(HERE, '..', 'voice-env');
const WORK = path.join(process.env.FREEFIELD_OUTPUT_DIR || path.join(HERE, '..', 'outputs'), 'split');
const DEMUCS = 'demucs==4.1.0';
// сам разделитель: wav → voice.wav (голос) и rest.wav (всё остальное = исходник − голос, чтобы фон остался как был)
const PY = String.raw`
import sys, os, json
import numpy as np, soundfile as sf, torch
from demucs.apply import apply_model
def say(**k): print(json.dumps(k), flush=True)
src, out, name = sys.argv[1], sys.argv[2], sys.argv[3]
if name == 'test-random':   # проверки: та же цепочка без скачивания весов
    from demucs.htdemucs import HTDemucs
    model = HTDemucs(sources=['drums', 'bass', 'other', 'vocals'])
else:
    from demucs.pretrained import get_model
    say(note='model')
    model = get_model(name)
model.eval()
dev = 'cuda' if torch.cuda.is_available() else 'cpu'
wav, sr = sf.read(src, always_2d=True, dtype='float32')
x = torch.from_numpy(np.ascontiguousarray(wav.T))
if sr != model.samplerate:
    import julius
    x = julius.resample_frac(x, sr, model.samplerate)
if x.shape[0] == 1: x = x.repeat(2, 1)
x = x[:2]
ref = x.mean(0); mean, std = ref.mean(), ref.std() + 1e-8
say(note='split', device=dev)
with torch.no_grad():
    s = apply_model(model, ((x - mean) / std)[None], device=dev, split=True, overlap=0.25, progress=False)[0]
voice = s[model.sources.index('vocals')] * std + mean
rest = x - voice
os.makedirs(out, exist_ok=True)
sf.write(os.path.join(out, 'voice.wav'), voice.T.numpy(), model.samplerate, subtype='PCM_16')
sf.write(os.path.join(out, 'rest.wav'), rest.T.numpy(), model.samplerate, subtype='PCM_16')
say(done=True, sec=round(x.shape[1] / model.samplerate, 2), device=dev)
`;

const envPy = () => process.env.FREEFIELD_SPLIT_PY || path.join(ENV, WIN ? 'Scripts\\python.exe' : 'bin/python');
const READY = path.join(ENV, '.ready');
// чем создать окружение: путь из config.json ("python") или Python из системы
const sysPython = () => { const p = readConfig().python; return typeof p === 'string' && p ? [p] : WIN ? ['py', '-3'] : ['python3']; };

function run(cmd, args, onLine = () => {}) {
  return new Promise(res => {
    let tail = '';
    const ch = spawn(cmd, args, {windowsHide: true, env: {...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1'}});
    const eat = d => { tail = (tail + d).slice(-4000); String(d).split(/\r?\n/).filter(Boolean).forEach(onLine); };
    ch.stdout.on('data', eat); ch.stderr.on('data', eat);
    ch.on('error', e => res({code: -1, tail: e.message}));
    ch.on('exit', code => res({code, tail}));
  });
}
const lastErr = t => (String(t).trim().split(/\r?\n/).filter(l => /error|не |not /i.test(l)).pop() || String(t).trim().split(/\r?\n/).pop() || '').slice(0, 200);

// окружение с Demucs — один раз; одновременно — одна установка
let setup = null;
async function ensureEnv(note) {
  if (process.env.FREEFIELD_SPLIT_PY || fs.existsSync(READY)) return envPy();
  setup ||= (async () => {
    note('Первый раз: ставлю разделение звука (Demucs, ~1 ГБ, 5–15 минут, один раз)…');
    if (!fs.existsSync(envPy())) {
      const [cmd, ...pre] = sysPython();
      const r = await run(cmd, [...pre, '-m', 'venv', ENV]);
      if (r.code !== 0) throw new Error(r.code === -1
        ? 'на компьютере не нашёлся Python — установите Python 3.11 с python.org (галочка «Add python.exe to PATH») или впишите путь в config.json Freefield: "python"'
        : 'не создалось окружение Python: ' + lastErr(r.tail));
    }
    const r = await run(envPy(), ['-m', 'pip', 'install', '--disable-pip-version-check', DEMUCS, 'soundfile'],
      l => { const m = l.match(/^(?:Collecting|Downloading|Installing)\s+(\S+)/); if (m) note(`Ставлю разделение звука: ${m[1].slice(0, 60)}…`); });
    if (r.code !== 0) throw new Error('Demucs не установился: ' + lastErr(r.tail));
    fs.writeFileSync(READY, new Date().toISOString());
  })().finally(() => { setup = null; });
  await setup;
  return envPy();
}

const jobs = new Map();
let queue = Promise.resolve();   // по одному: Demucs занимает видеокарту или все ядра
// старые задания (больше суток) — с диска долой
function sweep() {
  try {
    for (const d of fs.readdirSync(WORK)) {
      const p = path.join(WORK, d);
      if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.rmSync(p, {recursive: true, force: true});
    }
  } catch { /* папки ещё нет */ }
}
// звук (data URL WAV) → задание; ход — splitGet(id)
export function splitStart(dataUrl) {
  const m = /^data:audio\/(?:wav|x-wav|wave);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('нужен звук WAV (data URL)');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 1000 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('это не WAV');
  sweep();
  const id = crypto.randomBytes(8).toString('hex'), dir = path.join(WORK, id);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'in.wav'), buf);
  const job = {id, dir, status: 'queued', note: 'В очереди…', at: Date.now()};
  jobs.set(id, job);
  queue = queue.then(() => work(job)).catch(() => {});
  return {id};
}
async function work(job) {
  job.status = 'running';
  try {
    const py = await ensureEnv(n => { job.note = n; });
    const script = path.join(WORK, 'split.py');
    fs.writeFileSync(script, PY);
    job.note = 'Отделяю голос от фона…';
    const r = await run(py, [script, path.join(job.dir, 'in.wav'), job.dir, process.env.FREEFIELD_SPLIT_MODEL || 'htdemucs'], l => {
      try { const j = JSON.parse(l); if (j.note === 'model') job.note = 'Загружаю модель Demucs (первый раз ~80 МБ)…'; if (j.note === 'split') job.note = `Отделяю голос от фона${j.device === 'cuda' ? ' (видеокарта)' : ''}…`; } catch { /* строка журнала */ }
    });
    if (r.code !== 0 || !fs.existsSync(path.join(job.dir, 'voice.wav'))) throw new Error('Demucs не справился: ' + lastErr(r.tail));
    Object.assign(job, {status: 'done', note: ''});
  } catch (e) { Object.assign(job, {status: 'error', error: e.message, note: ''}); }
}
export function splitGet(id) {
  const j = jobs.get(id);
  if (!j) return null;
  return {id, status: j.status, note: j.note, error: j.error || null,
    ...(j.status === 'done' ? {voice: `/api/split/${id}/voice.wav`, rest: `/api/split/${id}/rest.wav`} : {})};
}
export function splitFile(id, which) {
  const j = jobs.get(id);
  return j && j.status === 'done' && ['voice', 'rest'].includes(which) ? path.join(j.dir, which + '.wav') : null;
}
