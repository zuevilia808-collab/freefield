#!/usr/bin/env node
// Freefield MCP-сервер: даёт Claude инструменты генерации картинок и видео.
// Бесплатно: FLUX.1 schnell/dev и Wan 2.2 (бесплатные GPU Hugging Face), AI Horde (без лимита).
// Платно (по ключу Pollinations, оплата за каждую генерацию): 50+ моделей — Veo, Seedance, Nano Banana, GPT Image, FLUX.2…
// Результаты сохраняются в Freefield/outputs/<дата>/. Stdout занят протоколом MCP — логи только в stderr.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {readState, writeState} from './state.js';
import {recordGen, allBatches, runSync, startBatch, hubApi, ensureHub, hubRunning, setLog} from './studio.js';
import {fileInfo, aspectCheck} from './media.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FREEFIELD_OUTPUT_DIR || path.join(HERE, '..', 'outputs');
const HF_TOKEN = process.env.HF_TOKEN || '';
const POLL_KEY = process.env.POLLINATIONS_KEY || '';
const HORDE_KEY = process.env.HORDE_KEY || '0000000000';
const WAIT_MS = 1000 * (+process.env.FREEFIELD_WAIT_SECONDS || 45);   // дольше — возвращаем номер задачи
const log = (...a) => console.error('[freefield]', ...a);
setLog(log);

// ============================== модели ==============================
const FREE_IMAGE = {
  'flux-schnell': {title: 'FLUX.1 [schnell]', host: 'https://black-forest-labs-flux-1-schnell.hf.space', endpoint: 'infer',
    args: (p, w, h, s) => [p, s, false, w, h, 4], note: 'бесплатно, ~5 с, дневной лимит GPU Hugging Face'},
  'flux-dev': {title: 'FLUX.1 [dev]', host: 'https://black-forest-labs-flux-1-dev.hf.space', endpoint: 'infer',
    args: (p, w, h, s) => [p, s, false, w, h, 3.5, 28], note: 'бесплатно, выше качество, ~20–40 с, тратит больше лимита GPU'},
  'horde': {title: 'AI Horde · SDXL', note: 'бесплатно и без дневного лимита, но очередь 1–10 минут'},
};
const WAN = {title: 'Wan 2.2 Fast', host: 'https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space', endpoint: 'generate_video',
  note: 'бесплатно, картинка → видео до 5 с, дневной лимит GPU Hugging Face'};
const WAN_NEG = '色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走';
const HORDE = {api: 'https://aihorde.net/api/v2', agent: 'freefield-mcp:1.0:local',
  models: ['AlbedoBase XL 3.1', 'Juggernaut XL', 'ICBINP XL', 'AlbedoBase XL (SDXL)']};
const GEN = 'https://gen.pollinations.ai';
const ASPECTS = {'1:1': [1024, 1024], '4:5': [896, 1120], '3:4': [864, 1152], '2:3': [832, 1248],
  '9:16': [736, 1312], '16:9': [1312, 736], '21:9': [1344, 576]};

// ============================== утилиты ==============================
class GenError extends Error { constructor(msg, kind = 'other') { super(msg); this.kind = kind; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const randSeed = () => Math.floor(Math.random() * 2147483647);
const slug = s => (s || 'art').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'art';
const EXT = {'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm'};
const MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'};
const fmtUSD = v => v == null ? 'цена по факту' : '$' + (v < 0.1 ? +v.toPrecision(2) : v.toFixed(2));

// Ответ инструмента: для человека — текст и превью, для скриптов агента — JSON (structuredContent и последним текстовым
// блоком, тот же объект): абсолютные пути файлов и их параметры (ширина×высота, модель, формат…)
function toolResult(data, {text = '', images = [], isError = false} = {}) {
  return {content: [...images, ...(text ? [{type: 'text', text}] : []), {type: 'text', text: JSON.stringify(data)}],
    structuredContent: data, ...(isError ? {isError: true} : {})};
}
// файлы → описание для агента (картинки и видео — с шириной и высотой)
const filesInfo = (paths, extra = () => ({})) => paths.map((p, i) => fileInfo(typeof p === 'string' ? p : p.path, extra(p, i)));

function saveOutput(buf, mime, prompt, seed) {
  const dir = path.join(OUT, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, {recursive: true});
  let file = path.join(dir, `freefield-${slug(prompt)}-${seed}.${EXT[mime] || 'bin'}`);
  for (let i = 2; fs.existsSync(file); i++) file = file.replace(/(-\d+)?(\.\w+)$/, `-${i}$2`);
  fs.writeFileSync(file, buf);
  return file;
}

async function fetchBuffer(url, headers = {}) {
  const r = await fetch(url, {headers});
  if (!r.ok) throw new GenError(`не удалось скачать результат (${r.status})`);
  return {buf: Buffer.from(await r.arrayBuffer()), mime: (r.headers.get('content-type') || '').split(';')[0]};
}

function readLocalImage(p) {
  const file = path.resolve(p);
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new GenError('image_path должен указывать на картинку .png, .jpg, .webp или .gif');
  const st = fs.statSync(file, {throwIfNoEntry: false});
  if (!st?.isFile()) throw new GenError(`файл не найден: ${file}`);
  if (st.size > 20 * 1024 * 1024) throw new GenError('картинка больше 20 МБ');
  return {buf: fs.readFileSync(file), mime, name: path.basename(file)};
}

// ============================== бесплатно: Hugging Face (Gradio) ==============================
const hfHeaders = (extra = {}) => HF_TOKEN ? {...extra, Authorization: `Bearer ${HF_TOKEN}`} : extra;

function gpuError(raw, title = '') {
  const s = String(raw ?? '');
  if (/quota/i.test(s + ' ' + title)) {
    const m = s.match(/Try again in (\d+):(\d+):\d+/);
    const mins = m ? +m[1] * 60 + +m[2] : 0;
    const when = mins >= 60 ? ` (обновится через ≈ ${Math.round(mins / 60)} ч)` : mins > 0 ? ` (обновится через ${mins} мин)` : '';
    return new GenError(`закончился дневной бесплатный лимит GPU Hugging Face${when}`, 'quota');
  }
  if (!s || s === 'null') return new GenError('бесплатный GPU не справился — попробуйте ещё раз', 'busy');
  return new GenError(s.slice(0, 300));
}

const fnCache = {};
async function gradioFnIndex(host, endpoint) {
  const key = host + endpoint;
  if (fnCache[key] == null) {
    const r = await fetch(host + '/config').catch(() => null);
    if (!r?.ok) throw new GenError(`бесплатная модель сейчас недоступна (${r?.status || 'нет связи'})`, 'down');
    const deps = (await r.json()).dependencies || [];
    const i = deps.findIndex(d => d.api_name === endpoint);
    if (i < 0) throw new GenError('бесплатная модель изменила API', 'down');
    fnCache[key] = deps[i].id ?? i;
  }
  return fnCache[key];
}

async function gradioUpload(host, buf, name, mime) {
  const fd = new FormData();
  fd.append('files', new Blob([buf], {type: mime}), name);
  const r = await fetch(host + '/gradio_api/upload', {method: 'POST', body: fd, headers: hfHeaders()});
  if (!r.ok) throw new GenError(`бесплатный GPU недоступен (${r.status})`, 'down');
  const [p] = await r.json();
  return {path: p, meta: {_type: 'gradio.FileData'}};
}

async function gradioCall(host, endpoint, data, onStatus, runMsg) {
  const fn_index = await gradioFnIndex(host, endpoint);
  const session_hash = Math.random().toString(36).slice(2, 12);
  let r = await fetch(`${host}/gradio_api/queue/join`, {method: 'POST', headers: hfHeaders({'Content-Type': 'application/json'}),
    body: JSON.stringify({data, fn_index, session_hash, trigger_id: null, event_data: null})}).catch(() => null);
  if (!r) throw new GenError('нет связи с бесплатным GPU', 'down');
  if (r.status === 401) throw new GenError('HF_TOKEN не подошёл — проверьте токен Hugging Face', 'auth');
  if (!r.ok) throw new GenError(`бесплатный GPU недоступен (${r.status})`, 'down');
  onStatus('встаю в очередь GPU');
  r = await fetch(`${host}/gradio_api/queue/data?session_hash=${session_hash}`, {headers: hfHeaders()});
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let m;
        try { m = JSON.parse(line.slice(5)); } catch { continue; }
        if (m.msg === 'estimation') onStatus(m.rank > 0 ? `очередь GPU: ${m.rank + 1}-й` : 'сейчас начнём');
        else if (m.msg === 'process_starts') onStatus(runMsg);
        else if (m.msg === 'progress') { const p = m.progress_data?.[0]; if (p?.length) onStatus(`${runMsg} ${Math.round(100 * p.index / p.length)}%`); }
        else if (m.msg === 'process_completed') {
          if (m.success) return m.output.data;
          throw gpuError(m.output?.error, m.output?.title || m.title);
        } else if (m.msg === 'unexpected_error') throw gpuError(m.message);
      }
    }
  } finally { reader.cancel().catch(() => {}); }
  throw new GenError('бесплатный GPU оборвал соединение', 'busy');
}

async function freeImage(modelId, prompt, w, h, seed, onStatus) {
  const m = FREE_IMAGE[modelId];
  const r32 = v => Math.max(256, Math.min(2048, Math.round(v / 32) * 32));
  const out = await gradioCall(m.host, m.endpoint, m.args(prompt.slice(0, 1800), r32(w), r32(h), seed), onStatus, 'GPU рисует');
  const url = out?.[0]?.url;
  if (!url) throw new GenError('бесплатный GPU не вернул файл', 'busy');
  return fetchBuffer(url);
}

async function freeVideo(frame, prompt, duration, seed, onStatus) {
  onStatus('загружаю кадр');
  const f = await gradioUpload(WAN.host, frame.buf, frame.name || 'frame.jpg', frame.mime);
  const out = await gradioCall(WAN.host, WAN.endpoint, [f, prompt, 6, WAN_NEG, duration, 1, 1, seed, false], onStatus, 'GPU генерирует видео');
  const url = out?.[0]?.url || out?.[0]?.video?.url;
  if (!url) throw new GenError('бесплатный GPU не вернул видео', 'busy');
  onStatus('скачиваю видео');
  return fetchBuffer(url);
}

// ============================== бесплатно: AI Horde ==============================
async function hordeImage(prompt, w, h, seed, onStatus) {
  const k = 1024 / Math.max(w, h);
  const W = Math.round(w * k / 64) * 64, H = Math.round(h * k / 64) * 64;
  const headers = {'Content-Type': 'application/json', apikey: HORDE_KEY, 'Client-Agent': HORDE.agent};
  const r = await fetch(HORDE.api + '/generate/async', {method: 'POST', headers, body: JSON.stringify({
    prompt: prompt.slice(0, 1500),
    params: {width: W, height: H, steps: 25, cfg_scale: 6, sampler_name: 'k_euler_a', seed: String(seed), n: 1, karras: true},
    models: HORDE.models, nsfw: false, censor_nsfw: true, r2: false, slow_workers: true,
  })}).catch(() => null);
  if (!r) throw new GenError('нет связи с AI Horde', 'down');
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new GenError('AI Horde: ' + (j.message || `ошибка ${r.status}`));
  const t0 = Date.now();
  while (true) {
    await sleep(5000);
    if (Date.now() - t0 > 20 * 60e3) {
      fetch(`${HORDE.api}/generate/status/${j.id}`, {method: 'DELETE', headers}).catch(() => {});
      throw new GenError('AI Horde не успел за 20 минут', 'busy');
    }
    const c = await fetch(`${HORDE.api}/generate/check/${j.id}`, {headers: {'Client-Agent': HORDE.agent}}).then(x => x.json()).catch(() => null);
    if (!c) continue;
    if (c.faulted) throw new GenError('AI Horde: генерация сорвалась', 'busy');
    if (c.is_possible === false) throw new GenError('AI Horde: сейчас нет подходящих видеокарт', 'busy');
    if (c.done) break;
    onStatus(c.processing ? 'рисуется у волонтёра' : `очередь AI Horde: #${c.queue_position}, ≈ ${c.wait_time} с`);
  }
  const s = await fetch(`${HORDE.api}/generate/status/${j.id}`, {headers: {'Client-Agent': HORDE.agent}}).then(x => x.json());
  const g = s.generations?.[0];
  if (!g?.img) throw new GenError('AI Horde не вернул картинку', 'busy');
  if (g.censored) throw new GenError('AI Horde скрыл картинку фильтром — измените промпт');
  if (/^https?:/.test(g.img)) return fetchBuffer(g.img);
  return {buf: Buffer.from(g.img, 'base64'), mime: 'image/webp'};
}

// ============================== платно: Pollinations ==============================
async function genFetch(pathname, params, {method = 'GET', body, timeout = 300000} = {}) {
  if (!POLL_KEY) throw new GenError('для платных моделей нужен ключ Pollinations: добавьте POLLINATIONS_KEY в настройки MCP-сервера (ключ — на enter.pollinations.ai)', 'auth');
  const url = GEN + pathname + (params ? '?' + new URLSearchParams(params) : '');
  const r = await fetch(url, {method, body, headers: {Authorization: 'Bearer ' + POLL_KEY}, signal: AbortSignal.timeout(timeout)})
    .catch(e => { throw new GenError(e.name === 'TimeoutError' ? 'превышено время ожидания' : 'нет связи с Pollinations', 'down'); });
  if (r.ok) return r;
  let msg = '';
  try { const j = await r.json(); msg = j.error?.message || j.message || ''; } catch {}
  if (r.status === 401) throw new GenError('POLLINATIONS_KEY не подошёл', 'auth');
  if (r.status === 402) throw new GenError('на балансе Pollinations не хватает pollen — пополните счёт', 'money');
  if (r.status === 403) throw new GenError('у ключа нет доступа к этой модели' + (msg ? ': ' + msg : ''), 'auth');
  if (r.status === 429) throw new GenError('слишком много запросов — подождите минуту', 'busy');
  throw new GenError(msg || `Pollinations ответил ${r.status}`);
}
const bufOf = async r => ({buf: Buffer.from(await r.arrayBuffer()), mime: (r.headers.get('content-type') || '').split(';')[0]});
const encPrompt = p => encodeURIComponent(p.replace(/[/\\]/g, ' ').slice(0, 1800));

async function paidImage(model, prompt, w, h, seed) {
  const out = await bufOf(await genFetch('/image/' + encPrompt(prompt), {model, width: w, height: h, seed}));
  if (!out.mime.startsWith('image/')) throw new GenError('сервис вернул не картинку');
  return out;
}

async function paidVideo(model, prompt, o, onStatus) {
  const q = {model, duration: o.duration, aspectRatio: o.aspect, seed: o.seed};
  if (o.resolution) q.resolution = o.resolution;
  if (o.audio) q.audio = 'true';
  if (o.frame) {
    onStatus('загружаю кадр');
    const fd = new FormData();
    fd.append('file', new Blob([o.frame.buf], {type: o.frame.mime}), o.frame.name || 'frame.jpg');
    const j = await (await genFetch('/upload', null, {method: 'POST', body: fd, timeout: 60000})).json();
    if (!j.url) throw new GenError('не удалось загрузить кадр');
    q.image = j.url;
  }
  onStatus('генерирую видео (платно)');
  const out = await bufOf(await genFetch('/video/' + encPrompt(prompt), q, {timeout: 900000}));
  if (!out.mime.startsWith('video/')) throw new GenError('сервис вернул не видео');
  return out;
}

// ---- живой каталог платных моделей и оценка цены (как в приложении) ----
let catalogCache = null;
async function catalog() {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60e3) return catalogCache.list;
  const lists = await Promise.all(['image', 'video'].map(k => fetch(`${GEN}/${k}/models`).then(r => r.ok ? r.json() : []).catch(() => [])));
  const seen = new Set(), list = [];
  for (const m of [...lists[1], ...lists[0]]) {
    if (m.community || String(m.name).startsWith('community/') || !['image', 'video'].includes(m.category) || seen.has(m.name)) continue;
    seen.add(m.name);
    list.push(m);
  }
  catalogCache = {at: Date.now(), list};
  return list;
}
function estimate(m, o = {}) {
  const v = m.pricing_variants?.find(x => x.name === o.resolution)?.pricing || m.pricing || {};
  if (m.category === 'image') {
    const c = +v.completionImageTokens;
    return c ? ((m.flat_rate || c >= 0.001) ? c : c * 1300) : null;
  }
  const s = +v.completionVideoSeconds;
  if (!s) return null;
  const d = o.duration || m.default_duration || m.min_duration || 5;
  return s * d + (o.audio && +v.completionAudioSeconds ? +v.completionAudioSeconds * d : 0);
}
async function findPaid(model, kind) {
  const m = (await catalog()).find(x => x.name === model || (x.aliases || []).includes(model));
  if (!m) throw new GenError(`модель «${model}» не найдена — посмотрите list_models`);
  if (m.category !== kind) throw new GenError(`«${model}» — модель для ${m.category === 'video' ? 'видео' : 'картинок'}`);
  if (m.health?.status === 'down') throw new GenError(`модель «${model}» сейчас не работает — выберите другую`);
  return m;
}

// ---- бесплатные кредиты на сайтах: берём список прямо из приложения (один источник правды) ----
function loadServices() {
  try {
    const html = fs.readFileSync(path.join(HERE, '..', 'app', 'index.html'), 'utf8');
    const start = html.indexOf('const SERVICES = [');
    const end = html.indexOf('\n];', start);
    if (start < 0 || end < 0) return [];
    return Function(`"use strict"; return (${html.slice(start + 'const SERVICES = '.length, end + 2)});`)();
  } catch (e) { log('services:', e.message); return []; }
}

// ============================== задачи (для долгих генераций) ==============================
const jobs = new Map();
let jobSeq = 0;

function startJob(kind, run) {
  const job = {id: `${kind}-${++jobSeq}-${Date.now().toString(36)}`, kind, status: 'running', message: 'в очереди',
    started: Date.now(), listeners: new Set(), result: null, error: null};
  job.promise = Promise.resolve().then(() => run(msg => { job.message = msg; job.listeners.forEach(f => f(msg)); }, job))
    .then(r => { job.status = 'done'; job.result = r; }, e => { job.status = 'error'; job.error = e; log(job.id, e.message); });
  jobs.set(job.id, job);
  return job;
}

async function waitJob(job, waitMs, extra) {
  const token = extra?._meta?.progressToken;
  let n = 0;
  const notify = msg => {
    if (token === undefined) return;
    extra.sendNotification({method: 'notifications/progress', params: {progressToken: token, progress: ++n, message: msg}}).catch(() => {});
  };
  job.listeners.add(notify);
  await Promise.race([job.promise, sleep(waitMs)]);
  job.listeners.delete(notify);
  return jobResult(job);
}

const HINTS = {
  quota: '\nЧто можно сделать: model="horde" (бесплатно без лимита, но медленно); добавить HF_TOKEN (бесплатный аккаунт Hugging Face — 5 мин GPU в день вместо 2); или платная модель из list_models.',
  auth: '\nКлючи задаются в настройках MCP-сервера freefield (переменные окружения HF_TOKEN / POLLINATIONS_KEY).',
  money: '\nПополнить баланс: enter.pollinations.ai.',
};

function jobResult(job) {
  const sec = Math.round((Date.now() - job.started) / 1000);
  if (job.status === 'running') return toolResult({job_id: job.id, status: 'running', message: job.message, elapsed_s: sec}, {text:
    `⏳ Ещё генерируется: ${job.message} (прошло ${sec} с). Вызови check_job с job_id="${job.id}", чтобы дождаться результата.`});
  if (job.status === 'error') return toolResult({job_id: job.id, status: 'error', error: job.error.message, error_kind: job.error.kind || 'other',
    ...(job.error.skipped?.length ? {skipped: job.error.skipped} : {})}, {text: `Ошибка: ${job.error.message}${HINTS[job.error.kind] || ''}`, isError: true});
  const r = job.result;
  if (!r?.structuredContent) return r;
  // номер задачи — в JSON результата (последний текстовый блок — тот же JSON)
  const data = {job_id: job.id, ...r.structuredContent};
  return {...r, structuredContent: data, content: [...r.content.slice(0, -1), {type: 'text', text: JSON.stringify(data)}]};
}

function imageResult(out, info) {
  const file = saveOutput(out.buf, out.mime, info.prompt, info.seed);
  recordGen({kind: 'image', site: 'freefield', model: info.model, appModel: info.appModel, prompt: info.prompt, aspect: info.aspect, files: [{path: file, mime: out.mime}]});
  const images = out.buf.length <= 3.5 * 1024 * 1024 ? [{type: 'image', data: out.buf.toString('base64'), mimeType: out.mime}] : [];
  const fi = fileInfo(file, {model: info.model, aspect_ratio: info.aspect, seed: info.seed});
  Object.assign(fi, aspectCheck(fi.width, fi.height, info.aspect));
  return toolResult({status: 'done', service: 'freefield', files: [fi], cost_usd: info.cost || 0, ...(info.note ? {note: info.note} : {})}, {images, text: [`Готово: ${info.model}${info.cost ? ` · ≈ ${fmtUSD(info.cost)}` : ' · бесплатно'}`,
    `Файл: ${file}`, `Формат: ${info.aspect} · seed ${info.seed}`, info.note].filter(Boolean).join('\n')});
}

// ============================== сервер и инструменты ==============================
const SERVER_INFO = {name: 'freefield', version: '1.2.0'};
const SERVER_OPTS = {
  instructions: 'Freefield генерирует картинки и видео. Пиши промпты на английском, подробно (объект, действие, окружение, свет, стиль, камера). ' +
    'По умолчанию используй бесплатные модели. Платные модели списывают деньги с баланса Pollinations: перед их вызовом назови пользователю цену из list_models и дождись согласия. ' +
    'Долгие задачи возвращают job_id — дождись результата через check_job. ' +
    'Бесплатно и в лучшем качестве — через сайты под аккаунтом пользователя: flow_video / flow_image (Google Flow), arena_video (Arena, 2 видео за раз), dola_image (Dola). ' +
    'Несколько сценариев сразу — batch_generate: он сам разложит их по сервисам. Задания с телефона — phone_tasks, подключить телефон — phone_link. ' +
    'Рабочий порядок: пользователь пишет сценарии в чат — сразу перепиши каждый в подробный английский промпт и запусти batch_generate (для картинок по умолчанию ' +
    'Nano Banana 2.1 во Flow и Seedream 5.0 в Dola — без кредитов), не переспрашивай по мелочам. Прислал фото в чат — вызови chat_photos, получи путь и передай его ' +
    'как image_path: для видео — оживить фото (Arena), для картинки — сделать по референсу (Flow / Dola). Готовые файлы сами появляются в галерее приложения ' +
    'Freefield (открытого по ссылке из phone_link на компьютере или телефоне) — в чат коротко: что готово и что не получилось. ' +
    'Пайплайн «персонаж → игровая 3D-модель»: flow_image (референсы в image_paths, resolution 2k) → при необходимости upscale_image → image_to_3d → check_job. ' +
    'Каждый результат содержит JSON с абсолютными путями файлов и их параметрами — бери пути оттуда. Платные кредиты — только с allow_credits / allow_paid и согласия пользователя. ' +
    'Токены и пароли пользователя не проси в чате: токен Hugging Face пользователь сам вписывает в config.json Freefield. ' +
    'Озвучка голосом персонажа — программа пользователя «Эхо» на этом компьютере: echo_voices (какие голоса есть; имя голоса = имя персонажа), ' +
    'echo_speak («озвучь голосом Паша радостно: …» → voice="Паша", emotion="happy"), echo_clone_voice (новый голос из отрезка видео или аудио). ' +
    '«Эхо» не запущено — попроси пользователя открыть ярлык «Эхо — озвучка» на рабочем столе; сам его не запускай.',
};
const server = new McpServer(SERVER_INFO, SERVER_OPTS);
// все инструменты запоминаем: по ссылке http://…:5180/mcp?k=… (Claude Code, Cursor и другие программы) — тот же набор
const TOOLS = [];
{ const reg = server.registerTool.bind(server); server.registerTool = (...a) => { TOOLS.push(a); return reg(...a); }; }

server.registerTool('generate_image', {
  title: 'Сгенерировать картинку',
  description: 'Генерирует картинку и сохраняет её в папку Freefield/outputs. Бесплатно: model="flux-schnell" (по умолчанию, ~5 с), "flux-dev" (качественнее), "horde" (без лимита, медленно). ' +
    'Платно: id модели из list_models (например "google/gemini-3.1-flash-image" — Nano Banana 2); нужен POLLINATIONS_KEY и согласие пользователя на цену.',
  inputSchema: {
    prompt: z.string().min(3).describe('Подробный промпт на английском: объект и действие, окружение, композиция и камера, свет, настроение, стиль (40–80 слов).'),
    model: z.string().default('flux-schnell').describe('flux-schnell | flux-dev | horde | id платной модели из list_models'),
    aspect_ratio: z.enum(['1:1', '4:5', '3:4', '2:3', '9:16', '16:9', '21:9']).default('1:1'),
    seed: z.number().int().min(0).max(2147483647).optional().describe('Для повторяемого результата'),
    max_cost_usd: z.number().min(0).default(0.5).describe('Предел цены для платной модели: дороже — откажет. Повышай только с согласия пользователя.'),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({prompt, model, aspect_ratio, seed, max_cost_usd}, extra) => {
  const [w, h] = ASPECTS[aspect_ratio];
  const s = seed ?? randSeed();
  let cost = 0, title = FREE_IMAGE[model]?.title;
  if (!FREE_IMAGE[model]) {
    try {
      const m = await findPaid(model, 'image');
      cost = estimate(m);
      if (cost != null && cost > max_cost_usd) return {isError: true, content: [{type: 'text', text:
        `Эта генерация стоит ≈ ${fmtUSD(cost)} — больше предела max_cost_usd=${max_cost_usd}. Спроси пользователя и, если он согласен, повтори с большим max_cost_usd.`}]};
      title = m.title || m.name;
    } catch (e) { return {isError: true, content: [{type: 'text', text: 'Ошибка: ' + e.message}]}; }
  }
  const job = startJob('image', async status => {
    let out, used = title, note = '', appModel = FREE_IMAGE[model] ? 'free:' + model : 'pol:' + model;
    if (model === 'horde') out = await hordeImage(prompt, w, h, s, status);
    else if (FREE_IMAGE[model]) {
      try { out = await freeImage(model, prompt, w, h, s, status); }
      catch (e) {
        if (e.kind !== 'quota') throw e;
        status('лимит FLUX исчерпан → AI Horde');
        out = await hordeImage(prompt, w, h, s, status);
        used = FREE_IMAGE.horde.title;
        appModel = 'free:horde';
        note = 'Дневной лимит FLUX закончился — картинка сделана через AI Horde. Больше лимита: HF_TOKEN.';
      }
    } else out = await paidImage(model, prompt, w, h, s);
    return imageResult(out, {prompt, seed: s, aspect: aspect_ratio, model: used, cost, note, appModel});
  });
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('generate_video', {
  title: 'Сгенерировать видео',
  description: 'Генерирует видео и сохраняет его в Freefield/outputs. Бесплатно: model="wan-2.2" (по умолчанию) — оживляет картинку из image_path, ' +
    'а без картинки сначала рисует кадр через FLUX; длительность 1–5 с. Платно: id видеомодели из list_models (например "google/veo-3.1-fast"); нужен POLLINATIONS_KEY и согласие на цену. ' +
    'Обычно занимает 1–3 минуты: если вернулся job_id — вызови check_job.',
  inputSchema: {
    prompt: z.string().min(3).describe('На английском: что происходит в кадре и как движется камера (для image_path — главное движение).'),
    image_path: z.string().optional().describe('Путь к локальной картинке, которую нужно оживить (например, файл из outputs).'),
    model: z.string().default('wan-2.2').describe('wan-2.2 | id платной видеомодели из list_models'),
    duration: z.number().min(1).max(15).default(3.5).describe('Секунды. Бесплатно: 1–5.'),
    aspect_ratio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
    seed: z.number().int().min(0).max(2147483647).optional(),
    max_cost_usd: z.number().min(0).default(0.5).describe('Предел цены для платной модели.'),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({prompt, image_path, model, duration, aspect_ratio, seed, max_cost_usd}, extra) => {
  const s = seed ?? randSeed();
  let frame = null;
  try { if (image_path) frame = readLocalImage(image_path); } catch (e) { return {isError: true, content: [{type: 'text', text: 'Ошибка: ' + e.message}]}; }
  const free = model === 'wan-2.2' || model === 'wan';
  let paid = null, cost = 0;
  if (!free) {
    try {
      paid = await findPaid(model, 'video');
      cost = estimate(paid, {duration});
      if (cost != null && cost > max_cost_usd) return {isError: true, content: [{type: 'text', text:
        `Это видео стоит ≈ ${fmtUSD(cost)} — больше предела max_cost_usd=${max_cost_usd}. Спроси пользователя и, если он согласен, повтори с большим max_cost_usd.`}]};
    } catch (e) { return {isError: true, content: [{type: 'text', text: 'Ошибка: ' + e.message}]}; }
  }
  const job = startJob('video', async status => {
    let out, poster = null;
    if (free) {
      if (!frame) {
        status('рисую первый кадр (FLUX)');
        const [w, h] = ASPECTS[aspect_ratio];
        const img = await freeImage('flux-schnell', prompt, w, h, s, status);
        frame = {...img, name: 'frame.' + (EXT[img.mime] || 'png')};
        poster = saveOutput(img.buf, img.mime, prompt + ' frame', s);
      }
      out = await freeVideo(frame, prompt + ', smooth natural motion, cinematic', Math.min(5, Math.max(1, duration)), s, status);
    } else {
      out = await paidVideo(paid.name, prompt, {duration: Math.round(duration), aspect: aspect_ratio, seed: s, frame}, status);
    }
    const file = saveOutput(out.buf, out.mime || 'video/mp4', prompt, s);
    recordGen({kind: 'video', site: 'freefield', model: free ? WAN.title : paid.title || paid.name, appModel: free ? 'free:wan22' : 'pol:' + paid.name,
      prompt, aspect: aspect_ratio, files: [{path: file, mime: out.mime || 'video/mp4'}]});
    return toolResult({status: 'done', service: 'freefield', files: [fileInfo(file, {model: free ? WAN.title : paid.title || paid.name, aspect_ratio, seed: s}),
      ...(poster ? [fileInfo(poster, {role: 'first_frame'})] : [])], cost_usd: cost || 0}, {text: [`Готово: видео ${free ? WAN.title + ' · бесплатно' : (paid.title || paid.name) + ` · ≈ ${fmtUSD(cost)}`}`,
      `Файл: ${file}`, poster ? `Первый кадр: ${poster}` : '', `Длительность: ${duration} с · ${aspect_ratio} · seed ${s}`].filter(Boolean).join('\n')});
  });
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('check_job', {
  title: 'Дождаться генерации',
  description: 'Ждёт (до wait_seconds) и возвращает результат долгой задачи по job_id (generate_*, flow_*, arena_video, dola_image, batch_generate, image_to_3d, upscale_image, echo_speak, echo_clone_voice). ' +
    'Последний текстовый блок ответа (и structuredContent) — JSON: status (running | done | error), а у готовой — абсолютные пути файлов и их параметры.',
  inputSchema: {
    job_id: z.string(),
    wait_seconds: z.number().min(0).max(120).default(45),
  },
  annotations: {readOnlyHint: true, openWorldHint: false},
}, async ({job_id, wait_seconds}, extra) => {
  const job = jobs.get(job_id);
  if (!job) return {isError: true, content: [{type: 'text', text: `Задача ${job_id} не найдена (сервер мог перезапуститься) — запустите генерацию заново.`}]};
  return waitJob(job, wait_seconds * 1000, extra);
});

server.registerTool('list_models', {
  title: 'Модели и цены',
  description: 'Список моделей Freefield: бесплатные (без ключа) и платные с оценкой цены за одну генерацию. Живой каталог.',
  inputSchema: {
    kind: z.enum(['image', 'video', 'all']).default('all'),
    tier: z.enum(['free', 'paid', 'all']).default('all'),
  },
  annotations: {readOnlyHint: true, openWorldHint: true},
}, async ({kind, tier}) => {
  const lines = [];
  if (tier !== 'paid') {
    lines.push('БЕСПЛАТНО (без ключа):');
    if (kind !== 'video') for (const [id, m] of Object.entries(FREE_IMAGE)) lines.push(`  [картинка] ${id} — ${m.title}: ${m.note}`);
    if (kind !== 'image') lines.push(`  [видео] wan-2.2 — ${WAN.title}: ${WAN.note}`);
  }
  if (tier !== 'free') {
    const list = (await catalog()).filter(m => kind === 'all' || m.category === kind);
    lines.push(`ПЛАТНО (Pollinations, оплата за генерацию${POLL_KEY ? '' : ' — нужен POLLINATIONS_KEY'}):`);
    for (const m of list.sort((a, b) => (estimate(a) ?? 9) - (estimate(b) ?? 9))) {
      const e = estimate(m);
      const price = m.category === 'video' ? `${fmtUSD(+(m.pricing?.completionVideoSeconds || 0) || null)}/с` : `≈ ${fmtUSD(e)} за картинку`;
      const dur = m.allowed_durations ? ` · ${m.allowed_durations.join('/')} с` : m.min_duration ? ` · ${m.min_duration}–${m.max_duration} с` : '';
      lines.push(`  [${m.category === 'video' ? 'видео' : 'картинка'}] ${m.name} — ${m.title || ''} · ${price}${dur}${m.health?.status === 'down' ? ' · СЕЙЧАС НЕ РАБОТАЕТ' : ''}`);
    }
    if (!list.length) lines.push('  (каталог сейчас недоступен)');
  }
  return {content: [{type: 'text', text: lines.join('\n')}]};
});

server.registerTool('free_credit_services', {
  title: 'Где бесплатные кредиты',
  description: 'Сайты с бесплатными кредитами на генерацию (Dola, Kling, Google Flow/Vids, Dreamina, Qwen, PixVerse…): сколько дают и на сколько картинок/видео хватит. ' +
    'Генерация там — на сайте под аккаунтом пользователя; здесь только справка и ссылки.',
  inputSchema: {kind: z.enum(['image', 'video', 'all']).default('all')},
  annotations: {readOnlyHint: true, openWorldHint: false},
}, async ({kind}) => {
  const periods = {day: 'каждый день', week: 'каждую неделю', month: 'каждый месяц', once: 'разово'};
  const list = loadServices().filter(x => kind === 'all' || x[kind]);
  if (!list.length) return {isError: true, content: [{type: 'text', text: 'Не удалось прочитать список сервисов из app/index.html.'}]};
  const text = list.map(x => [`${x.name} (${x.by}) — ${periods[x.period]} — ${x.url}`, `  кредиты: ${x.credits}`,
    x.image ? `  картинки: ${x.image.models} → ${x.image.equiv}` : '', x.video ? `  видео: ${x.video.models} → ${x.video.equiv}` : '',
    x.note ? `  ⚠ ${x.note}` : ''].filter(Boolean).join('\n')).join('\n');
  return {content: [{type: 'text', text: 'Данные на сентябрь 2026 — сервисы иногда меняют лимиты.\n\n' + text}]};
});

server.registerTool('account_status', {
  title: 'Лимиты и баланс',
  description: 'Показывает, какие ключи подключены к Freefield MCP, баланс Pollinations и куда сохраняются файлы.',
  inputSchema: {},
  annotations: {readOnlyHint: true, openWorldHint: true},
}, async () => {
  let bal = 'ключ не подключён';
  if (POLL_KEY) {
    const r = await fetch(GEN + '/account/balance', {headers: {Authorization: 'Bearer ' + POLL_KEY}}).catch(() => null);
    bal = r?.ok ? `${(await r.json()).balance ?? '?'} pollen (≈ $)` : r?.status === 401 ? 'ключ не подошёл' : 'ключ подключён';
  }
  let hf = 'без входа: 2 мин GPU в день (несколько генераций)';
  if (HF_TOKEN) {
    const r = await fetch('https://huggingface.co/api/whoami-v2', {headers: {Authorization: 'Bearer ' + HF_TOKEN}}).catch(() => null);
    hf = r?.ok ? `вход как ${(await r.json()).name} — 5 мин GPU в день` : 'HF_TOKEN не подошёл';
  }
  return {content: [{type: 'text', text: [`Hugging Face (FLUX, Wan): ${hf}`, `AI Horde: ${HORDE_KEY === '0000000000' ? 'анонимно (медленная очередь)' : 'свой ключ'}`,
    `Pollinations (платные модели): ${bal}`, `Файлы сохраняются в: ${OUT}`].join('\n')}]};
});

// ============================== сайты: Google Flow, Dola, Arena (через браузер Freefield) ==============================
// Модуль браузера загружается только при первом вызове — сервер работает и без него.
let portalsMod = null, batchModP = null;
const portals = async () => (portalsMod ??= await import('./portals.js'));
const batchMod = async () => (batchModP ??= await import('./batch.js'));
const mesh3d = () => import('./mesh3d.js');
const upscaleMod = () => import('./upscale.js');

async function preview(out) {
  // в чат — уменьшенная копия (оригинал сохраняется целиком); нет библиотеки sharp — большую картинку в чат не показываем
  if (out.buf.length <= 1.5 * 1024 * 1024 && /jpeg|png|webp/.test(out.mime)) return {data: out.buf.toString('base64'), mimeType: out.mime};
  try {
    const sharp = (await import('sharp')).default;
    const small = await sharp(out.buf).resize({width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true}).jpeg({quality: 85}).toBuffer();
    return {data: small.toString('base64'), mimeType: 'image/jpeg'};
  } catch { return null; }
}
const previewItem = async out => { const p = await preview(out).catch(() => null); return p ? [{type: 'image', ...p}] : []; };

async function portalResult(results, info) {
  const content = [], files = [];
  for (const out of results) {
    files.push(saveOutput(out.buf, out.mime || 'image/jpeg', info.prompt, randSeed()));
    if (out.mime?.startsWith('image/')) content.push(...(await previewItem(out)));
  }
  recordGen({kind: 'image', site: info.siteId, model: info.model, prompt: info.prompt, aspect: info.aspect,
    files: files.map((p, i) => ({path: p, mime: results[i].mime || 'image/jpeg'}))});
  const fis = filesInfo(files, () => ({model: info.model, aspect_ratio: info.aspect}));
  for (const f of fis) Object.assign(f, aspectCheck(f.width, f.height, info.aspect));
  return toolResult({status: 'done', service: info.siteId, files: fis}, {images: content, text: [`Готово: ${info.site} · ${info.model} · бесплатные кредиты вашего аккаунта`,
    ...files.map((f, i) => `Файл ${i + 1}: ${f}`), `Формат: ${info.aspect}`].join('\n')});
}

const PORTAL_HINT = 'Генерация идёт на сайте под аккаунтом пользователя в отдельном окне Chrome Freefield (вход выполнен им самим один раз). ' +
  'Если сайт попросит войти или пройти проверку «я не робот» — инструмент остановится: попроси пользователя сделать это в окне Chrome и повтори.';

// Картинки Flow: сохранить как есть, описать каждый файл для агента (путь, размер, модель, формат кадра)
async function flowImageResult(results, info) {
  const P = await portals();
  const files = [], images = [], warnings = [], errors = [];
  for (const out of results) {
    const file = saveOutput(out.buf, out.mime || 'image/png', info.prompt, randSeed());
    const fi = fileInfo(file, {model: out.model || info.model, aspect_ratio: info.aspect, resolution: out.resolution ?? null, upscaled: !!out.upscaled, flow_id: out.id || null});
    if (out.width && !fi.width) Object.assign(fi, {width: out.width, height: out.height});
    Object.assign(fi, aspectCheck(fi.width, fi.height, info.aspect));
    if (fi.aspect_ok === false) warnings.push(`${fi.name}: кадр ${fi.width}×${fi.height} (${fi.aspect_ratio_actual}) не совпадает с ${info.aspect} — Freefield его не обрезал и не сдвигал`);
    if (out.warning) { fi.warning = out.warning; warnings.push(`${fi.name}: ${out.warning}`); }
    if (out.error) errors.push(out.error);
    files.push(fi);
    P.rememberFlowFile(file, out.id);
    if (images.length < 4 && /^image\//.test(fi.mime)) images.push(...(await previewItem({buf: out.buf, mime: fi.mime})));
  }
  recordGen({kind: 'image', site: 'flow', model: files[0]?.model || info.model, prompt: info.prompt, aspect: info.aspect, files: files.map(f => ({path: f.path, mime: f.mime}))});
  const err = errors[0];
  const data = {status: 'done', service: 'flow', model_requested: info.model, aspect_ratio: info.aspect, resolution_requested: info.resolution, files, warnings,
    ...(err ? {error: err, error_kind: 'credits'} : {})};
  const text = [err ? `⚠ ${err}. Сохранён оригинал 1K (без увеличения).` : `Готово: Google Flow · ${[...new Set(files.map(f => f.model))].join(', ')} · бесплатные кредиты вашего аккаунта`,
    ...files.map((f, i) => `Файл ${i + 1}: ${f.path} · ${f.width}×${f.height}${f.resolution ? ' · ' + f.resolution : ''}`), ...warnings.map(w => '⚠ ' + w)].join('\n');
  return toolResult(data, {text, images, isError: !!err});
}

server.registerTool('flow_image', {
  title: 'Картинка через Google Flow',
  description: 'Генерирует картинки моделями Nano Banana на сайте Google Flow за бесплатные кредиты Flow. ' +
    'model: nano-banana-2.1 (по умолчанию — её Freefield выбирает во Flow сам; если её нет в аккаунте или Flow просит за неё кредиты без allow_credits — Flow сделает на nano-banana-2, ' +
    'какая модель сработала — в поле model каждого файла), nano-banana-2 и nano-banana-2-lite — без кредитов, nano-banana-pro — тратит кредиты (только с allow_credits=true). ' +
    'image_paths — до 4 фото-референсов («ингредиенты» Flow: персонаж, развёртка, стиль). ' +
    'resolution — размер файла через меню Flow «Скачать»: 1k — оригинал, 2k — увеличение Flow (по умолчанию, максимум без подписки), 4k — обычно только с подпиской Google AI. ' +
    'Если размер стоит кредитов, без allow_credits=true Freefield их не тратит и возвращает ошибку с ценой (оригинал 1K сохраняется). ' +
    'Файлы сохраняются как их отдаёт Flow (PNG/JPEG), без пережатия; кадр не обрезается и не сдвигается — формат проверяется (aspect_ok). ' +
    'Ответ и check_job содержат JSON: files[] с path (абсолютный), width, height, model, aspect_ratio, resolution. ' + PORTAL_HINT,
  inputSchema: {
    prompt: z.string().min(3).describe('Подробный промпт (лучше на английском).'),
    model: z.enum(['nano-banana-2.1', 'nano-banana-2', 'nano-banana-2-lite', 'nano-banana-pro']).default('nano-banana-2.1'),
    aspect_ratio: z.enum(['16:9', '4:3', '1:1', '3:4', '9:16']).default('16:9'),
    count: z.number().int().min(1).max(4).default(1).describe('Сколько вариантов за раз (x1–x4).'),
    image_paths: z.array(z.string()).max(4).optional().describe('До 4 фото-референсов (png, jpg, webp) — «ингредиенты» Flow. Фото из чата — через chat_photos.'),
    image_path: z.string().optional().describe('Один референс (старый параметр; то же, что image_paths из одного файла).'),
    resolution: z.enum(['1k', '2k', '4k']).default('2k').describe('Размер скачивания через меню Flow: 1k оригинал, 2k (по умолчанию), 4k.'),
    allow_credits: z.boolean().default(false).describe('true — разрешить тратить кредиты Flow (платная модель или платный размер). Только с согласия пользователя.'),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({prompt, model, aspect_ratio, count, image_paths = [], image_path, resolution, allow_credits}, extra) => {
  let refs;
  try {
    refs = [...new Set([...image_paths, ...(image_path ? [image_path] : [])].map(p => { readLocalImage(p); return path.resolve(p); }))];
    if (refs.length > 4) throw new GenError('Flow принимает до 4 фото-референсов');
  } catch (e) { return toolResult({status: 'error', error: e.message, error_kind: 'input'}, {text: 'Ошибка: ' + e.message, isError: true}); }
  const P = await portals();
  const blocked = P.flowResBlocked(resolution, allow_credits);
  if (blocked) return toolResult({status: 'error', error: blocked, error_kind: /недоступно/.test(blocked) ? 'plan' : 'credits', resolution_requested: resolution},
    {text: `Ошибка: ${blocked}. Возьми resolution="2k" или "1k"${/недоступно/.test(blocked) ? '' : ', или allow_credits=true с согласия пользователя'}.`, isError: true});
  const m = P.FLOW_IMAGE_MODELS[model];
  const job = startJob('flow', async status => flowImageResult(await P.flowImage({prompt, aspect: aspect_ratio, count, model: m, imagePaths: refs, onStatus: status,
    allowCredits: allow_credits, resolution}), {model: m.label, prompt, aspect: aspect_ratio, resolution}));
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('flow_video', {
  title: 'Видео через Google Flow',
  description: 'Генерирует видео на сайте Google Flow за бесплатные кредиты (50 в день: Omni 1.1 Flash по умолчанию ≈ 20 кредитов, Veo 3.1 Lite ≈ 10, Fast ≈ 20, Quality ≈ 100 — не хватит). ' +
    'Обычно 1–3 минуты — дождись результата через check_job. ' + PORTAL_HINT,
  inputSchema: {
    prompt: z.string().min(3).describe('Сцена и движение камеры (лучше на английском).'),
    model: z.enum(['omni-1.1-flash', 'veo-3.1-lite', 'veo-3.1-fast', 'veo-3.1-quality']).default('omni-1.1-flash'),
    aspect_ratio: z.enum(['16:9', '9:16']).default('16:9'),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({prompt, model, aspect_ratio}, extra) => {
  const P = await portals();
  const m = P.FLOW_VIDEO_MODELS[model];
  const job = startJob('flowvideo', async status => {
    const res = await P.flowVideo({prompt, aspect: aspect_ratio, count: 1, model: m, onStatus: status});
    const files = res.map(o => saveOutput(o.buf, o.mime || 'video/mp4', prompt, randSeed()));
    recordGen({kind: 'video', site: 'flow', model: m.label, prompt, aspect: aspect_ratio, files: files.map(p => ({path: p, mime: 'video/mp4'}))});
    return toolResult({status: 'done', service: 'flow', files: filesInfo(files, () => ({model: m.label, aspect_ratio}))},
      {text: [`Готово: видео Google Flow · ${m.label} · бесплатные кредиты`, ...files.map(f => `Файл: ${f}`), `Формат: ${aspect_ratio}`].join('\n')});
  });
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('vids_video', {
  title: 'Видео через Google Vids',
  description: 'Генерирует видео в Google Vids (docs.google.com/videos) аккаунтом Google пользователя — бесплатно: модель Omni, 720p, 10 секунд, со звуком, ' +
    'вертикально (9:16) или горизонтально (16:9); обычно ~1 минута. Промпт — на английском (реплики героя можно по-русски в «»). ' +
    'image_paths — фото героя как «ингредиенты» (до 3). ' +
    'Дождись результата через check_job. ' + PORTAL_HINT,
  inputSchema: {
    prompt: z.string().min(3).describe('Сцена, действие, камера, звук — на английском.'),
    aspect_ratio: z.enum(['9:16', '16:9']).default('9:16'),
    image_paths: z.array(z.string()).max(3).optional().describe('Фото-ингредиенты (герой, предмет); фото из чата — через chat_photos'),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({prompt, aspect_ratio, image_paths = []}, extra) => {
  const P = await portals();
  try { image_paths = image_paths.map(p => { readLocalImage(p); return path.resolve(p); }); }
  catch (e) { return {isError: true, content: [{type: 'text', text: 'Ошибка: ' + e.message}]}; }
  const job = startJob('vidsvideo', async status => {
    const res = await P.vidsVideo({prompt, aspect: aspect_ratio, imagePaths: image_paths, onStatus: status});
    const files = res.map(o => saveOutput(o.buf, o.mime || 'video/mp4', prompt, randSeed()));
    recordGen({kind: 'video', site: 'vids', model: 'Omni · Google Vids', prompt, aspect: aspect_ratio, files: files.map(p => ({path: p, mime: 'video/mp4'}))});
    return toolResult({status: 'done', service: 'vids', files: filesInfo(files, () => ({model: 'Omni · Google Vids', aspect_ratio}))},
      {text: ['Готово: видео Google Vids · Omni · 720p · 10 с · бесплатно', ...files.map(f => `Файл: ${f}`), `Формат: ${aspect_ratio}`].join('\n')});
  });
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('dola_image', {
  title: 'Картинка через Dola (Seedream)',
  description: 'Генерирует картинку моделью Seedream на сайте Dola (ByteDance) за бесплатные ежедневные кредиты Dola. ' +
    'seedream-5-pro (Seedream 5.0, по умолчанию) — лучше качество и не тратит кредиты; seedream-4.5 — прошлая версия. Dola сама решает, сколько вариантов сделать (обычно 1–4). ' + PORTAL_HINT,
  inputSchema: {
    prompt: z.string().min(3).describe('Подробный промпт (английский или русский).'),
    model: z.enum(['seedream-5-pro', 'seedream-4.5']).default('seedream-5-pro'),
    aspect_ratio: z.enum(['1:1', '2:3', '3:4', '4:3', '9:16', '16:9']).default('16:9'),
    image_path: z.string().optional().describe('Фото-референс (png, jpg, webp): картинка будет сделана по нему. Фото из чата — через chat_photos.'),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({prompt, model, aspect_ratio, image_path}, extra) => {
  let ref = null;
  try { if (image_path) { readLocalImage(image_path); ref = path.resolve(image_path); } } catch (e) { return {isError: true, content: [{type: 'text', text: 'Ошибка: ' + e.message}]}; }
  const P = await portals();
  const m = P.DOLA_IMAGE_MODELS[model];
  const job = startJob('dola', async status => portalResult(await P.dolaImage({prompt, aspect: aspect_ratio, model: m, imagePath: ref, onStatus: status}),
    {site: 'Dola', siteId: 'dola', model: m.label, prompt, aspect: aspect_ratio}));
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('arena_video', {
  title: 'Видео через Arena (сразу 2 модели)',
  description: 'Генерирует видео на arena.ai бесплатно (аккаунт пользователя в окне Chrome Freefield). Режим «битва»: один промпт → два видео ' +
    'от двух случайных анонимных топ-моделей (Veo, Kling, Seedance, Hailuo…). Можно оживить картинку (image_path). Формат кадра Arena не выбирает — ' +
    'укажи его словами в промпте (например "vertical 9:16"). Имена моделей Arena показывает после голосования на сайте — Freefield не голосует. ' +
    'Arena может публиковать промпты для исследований — не отправляй личные данные. Обычно 2–4 минуты — дождись через check_job. ' + PORTAL_HINT,
  inputSchema: {
    prompt: z.string().min(3).max(2500).describe('Сцена, действие и движение камеры (лучше на английском).'),
    image_path: z.string().optional().describe('Путь к локальной картинке, которую нужно оживить (png, jpg, webp).'),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({prompt, image_path}, extra) => {
  let img = null;
  try { if (image_path) { readLocalImage(image_path); img = path.resolve(image_path); } } catch (e) { return {isError: true, content: [{type: 'text', text: 'Ошибка: ' + e.message}]}; }
  const P = await portals();
  const job = startJob('arena', async status => {
    const {results, chat} = await P.arenaVideo({prompt, imagePath: img, onStatus: status});
    const saved = results.map(o => ({path: saveOutput(o.buf, o.mime || 'video/mp4', prompt, randSeed()), mime: o.mime || 'video/mp4', label: o.label}));
    recordGen({kind: 'video', site: 'arena', model: 'битва двух анонимных моделей', prompt, files: saved});
    const files = saved.map(f => `${f.label}: ${f.path}`);
    return toolResult({status: 'done', service: 'arena', chat, files: filesInfo(saved, f => ({model: f.label}))}, {text: [`Готово: Arena · ${results.length} видео от двух анонимных моделей · бесплатно`, ...files,
      `Чат на Arena (там можно проголосовать — после этого Arena покажет названия моделей): ${chat}`].join('\n')});
  });
  return waitJob(job, WAIT_MS, extra);
});

function progressLine(items) {
  const done = items.filter(i => i.status === 'done' || i.status === 'error').length;
  const run = items.filter(i => i.status === 'running').map(i => `${i.n}: ${i.message}`);
  return `готово ${done} из ${items.length}${run.length ? ' · ' + run.join(' · ') : ''}`;
}

async function batchResult(batch) {
  const B = await batchMod();
  const content = [];
  for (const it of batch.items) for (const f of it.files || []) {
    if (!f.mime.startsWith('image/') || content.length >= 8) continue;
    try { content.push(...(await previewItem({buf: fs.readFileSync(f.path), mime: f.mime}))); } catch {}
  }
  const ok = batch.items.filter(i => i.status === 'done').length;
  const items = batch.items.map(i => ({n: i.n, status: i.status, kind: i.kind, site: i.site, model: i.model || null, ...(i.message && i.status === 'error' ? {error: i.message} : {}),
    files: filesInfo(i.files || [], () => ({model: i.model || null, aspect_ratio: i.aspect || null}))}));
  return toolResult({status: 'done', batch_id: batch.id, done: ok, total: batch.items.length, items},
    {images: content, text: `Пакет ${batch.id}: готово ${ok} из ${batch.items.length} · бесплатные кредиты сайтов\n\n` + B.summary(batch.items)});
}

server.registerTool('batch_generate', {
  title: 'Пакет сценариев: Vids + Flow + Arena + Dola',
  description: 'Запускает сразу несколько сценариев (1–10) на бесплатных кредитах сайтов и сам раскладывает их по сервисам: видео — по кругу Google Vids (Omni, 720p, 10 с, бесплатно), Google Flow ' +
    '(Veo 3.1 Lite или Omni 1.1 Flash из 50 дневных кредитов), Dola (Seedance 2.5 за баллы Dola) и Arena (2 видео от двух анонимных топ-моделей за запрос); картинки — Google Flow (Nano Banana 2.1) и Dola ' +
    '(Seedream 5.0, обычно 4 варианта) — обе без кредитов; Arena рисует картинки (2 от двух моделей), только если указать service="arena". Все сценарии идут одновременно (Flow — до 4, Dola и Arena — до 2 за раз): промпты отправляются подряд, результаты ждутся вместе; если сайт не справился — сценарий переезжает на запасной. ' +
    'Перед вызовом перепиши каждый сценарий пользователя в подробный английский промпт (сцена, действие, камера, свет, стиль). ' +
    'Обычно 3–10 минут — дождись результата через check_job. ' + PORTAL_HINT,
  inputSchema: {
    scenarios: z.array(z.object({
      prompt: z.string().min(3).max(2500),
      kind: z.enum(['video', 'image']).default('video'),
      service: z.enum(['auto', 'flow', 'arena', 'dola', 'vids']).default('auto').describe('auto — Freefield выберет сам по оставшимся кредитам; vids — Google Vids (только видео: Omni, 9:16 или 16:9, 10 с)'),
      aspect_ratio: z.enum(['16:9', '9:16', '1:1', '3:4', '4:3', '2:3', '21:9']).optional().describe('Формат. Видео: Flow — только 16:9 и 9:16, Dola — 1:1, 3:4, 4:3, 9:16, 16:9, 21:9. ' +
        'Фото: Flow — 16:9, 4:3, 1:1, 3:4, 9:16; Dola — 1:1, 2:3, 3:4, 4:3, 9:16, 16:9. «auto» выберет сервис, где формат есть; Arena формат не выбирает — Freefield допишет его в промпт'),
      count: z.number().int().min(1).max(4).optional().describe('Сколько картинок за раз во Flow (x1–x4); Dola обычно даёт 4, Arena — 2'),
      seconds: z.union([z.literal(5), z.literal(8), z.literal(10)]).optional().describe('Длина видео: во Flow 8 — Veo 3.1 Lite (10 кредитов), 10 — Omni 1.1 Flash (20 кредитов); ' +
        'в Dola 5 или 10. Бери по сценарию пользователя: расписан на 10 секунд — ставь 10.'),
      model: z.string().optional().describe('Модель на выбранном сервисе (иначе — по умолчанию): Flow видео omni-1.1-flash (по умолчанию) | veo-3.1-lite | veo-3.1-fast | veo-3.1-quality; ' +
        'Flow фото nano-banana-2 | nano-banana-2.1 (новая) | nano-banana-2-lite | nano-banana-pro; Dola видео seedance-2.0-fast | seedance-2.5 | seedance-1.0; Dola фото seedream-5-pro | seedream-4.5.'),
      image_path: z.string().optional().describe('Фото-референс: для видео — оживить его (Arena), для картинки — сделать по нему (Flow Nano Banana 2 / Dola / Arena). Фото из чата — через chat_photos.'),
      image_paths: z.array(z.string()).max(4).optional().describe('Несколько фото-референсов: Flow берёт все как «ингредиенты», Dola и Arena — первое'),
    })).min(1).max(10),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({scenarios}, extra) => {
  try {
    for (const s of scenarios) {
      if (s.image_path) { readLocalImage(s.image_path); s.image_path = path.resolve(s.image_path); }
      if (s.image_paths) s.image_paths = s.image_paths.map(p => { readLocalImage(p); return path.resolve(p); });
    }
  } catch (e) { return {isError: true, content: [{type: 'text', text: 'Ошибка: ' + e.message}]}; }
  const batch = await startBatch(scenarios, 'claude');
  const job = startJob('batch', async status => {
    status(progressLine(batch.items));
    const t = setInterval(() => status(progressLine(batch.items)), 3000);
    try { await batch.promise; } finally { clearInterval(t); }
    return batchResult(batch);
  });
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('image_to_3d', {
  title: 'Картинка → 3D-модель',
  description: 'Делает 3D-модель по картинке персонажа или предмета на бесплатных лимитах, под аккаунтами пользователя. Асинхронно: возвращает job_id — результат через check_job. ' +
    'service: auto (по умолчанию: сайт Hunyuan 3D — 20 бесплатных в день → Spaces на Hugging Face → Tripo → Meshy; если сервис не смог — следующий), ' +
    'hunyuan (официальный сайт Hunyuan 3D, международная версия), tripo (Tripo Studio, бесплатные кредиты в месяц), meshy (Meshy, 100 кредитов и 10 скачиваний в месяц), ' +
    'hf (Spaces microsoft/TRELLIS.2 и tencent/Hunyuan3D-2.1, мультивью — tencent/Hunyuan3D-2mv, на квоте ZeroGPU аккаунта пользователя: ≈ 3,5 мин GPU в день — 1–3 модели). ' +
    'Вход: image_path (одна картинка) ИЛИ views {front, back, left, right} (мультивью, где сервис умеет). quality: standard | high | max (max — максимум полигонов и текстур, что даёт сервис). ' +
    'texture (по умолчанию true), pbr, format: glb (по умолчанию) | fbx | obj — если сервис не отдаёт нужный формат, Freefield переводит сам (OBJ — сам, FBX — через установленный Blender). ' +
    'Результат (JSON): model_path и files[] — абсолютные пути модели и текстур в Freefield/outputs/3d/<job>/, polygons (треугольники, вершины), service, free_left (сколько бесплатного осталось). ' +
    'Платные кредиты не тратит без allow_paid=true. Если сайт просит войти или пройти проверку «я не робот» — остановится: попроси пользователя сделать это в окне Chrome Freefield и повтори. ' +
    'Совет: картинка — персонаж целиком на однотонном фоне, без обрезанных рук и ног (A- или T-поза лучше для игры).',
  inputSchema: {
    image_path: z.string().optional().describe('Картинка (png, jpg, webp) — персонаж или предмет целиком.'),
    views: z.object({front: z.string(), back: z.string().optional(), left: z.string().optional(), right: z.string().optional()}).optional()
      .describe('Мультивью: пути к видам спереди (обязательно), сзади, слева, справа.'),
    service: z.enum(['auto', 'hunyuan', 'tripo', 'meshy', 'hf']).default('auto'),
    quality: z.enum(['standard', 'high', 'max']).default('high'),
    texture: z.boolean().default(true),
    pbr: z.boolean().default(false).describe('PBR-материалы (metallic/roughness/normal). TRELLIS.2 и Hunyuan3D-2.1 дают их всегда.'),
    format: z.enum(['glb', 'fbx', 'obj']).default('glb'),
    allow_paid: z.boolean().default(false).describe('true — разрешить тратить платные кредиты сервиса. Только с согласия пользователя.'),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({image_path, views, service, quality, texture, pbr, format, allow_paid}, extra) => {
  const bad = msg => toolResult({status: 'error', error: msg, error_kind: 'input'}, {text: 'Ошибка: ' + msg, isError: true});
  if (!image_path && !views) return bad('нужна картинка: image_path или views.front');
  if (image_path && views) return bad('укажи что-то одно: image_path или views');
  let img = null, vw = null;
  try {
    if (image_path) { readLocalImage(image_path); img = path.resolve(image_path); }
    if (views) vw = Object.fromEntries(Object.entries(views).filter(([, v]) => v).map(([k, v]) => { readLocalImage(v); return [k, path.resolve(v)]; }));
  } catch (e) { return bad(e.message); }
  const M = await mesh3d();
  const job = startJob('3d', async (status, j) => {
    const outDir = path.join(OUT, '3d', j.id);
    const r = await M.imageTo3d({image: img, views: vw, service, quality, texture, pbr, format, allowPaid: allow_paid, outDir, onStatus: status});
    const left = r.free_left, leftText = r.service === 'hf'
      ? `${left.quota}${left.seconds_left != null ? `, осталось ≈ ${left.seconds_left} с` : ''} (≈ ${left.generations_left_estimate} моделей)`
      : `бесплатно осталось ≈ ${left.left} ${left.unit} за ${left.per} (${left.source})`;
    const text = [r.error ? `⚠ ${r.error}` : `Готово: 3D-модель · ${r.service_label} · ${r.engine}`,
      `Модель: ${r.model_path}`, r.polygons ? `Полигоны: ${r.polygons.triangles.toLocaleString('ru')} треугольников, ${r.polygons.vertices.toLocaleString('ru')} вершин` : 'Полигоны: сервис не дал посчитать',
      `Текстуры: ${r.textures}${r.pbr ? ' · PBR' : ''}`, `Остаток: ${leftText}`,
      ...r.skipped.map(x => `Пропущен ${x.service}: ${x.reason}`), ...r.warnings.map(w => '⚠ ' + w)].join('\n');
    return toolResult(r, {text, isError: !!r.error});
  });
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('upscale_image', {
  title: 'Увеличить картинку ×2 / ×4',
  description: 'Увеличивает картинку в 2 или 4 раза бесплатно. Картинку сделал Flow через Freefield — увеличивает сам Flow (меню «Скачать» → 2K/4K, 4K обычно только с подпиской Google AI; ' +
    'если размер стоит кредитов — без allow_credits=true не тратит). Иначе — Real-ESRGAN в Space на Hugging Face под аккаунтом пользователя (токен в config.json Freefield или вход в окне Chrome Freefield). ' +
    'Результат (JSON): path (абсолютный), width, height, factor_actual. Картинку не обрезает. Асинхронно: если вернулся job_id — дождись через check_job.',
  inputSchema: {
    path: z.string().describe('Картинка (png, jpg, webp).'),
    factor: z.union([z.literal(2), z.literal(4)]).default(2),
    service: z.enum(['auto', 'flow', 'hf']).default('auto'),
    allow_credits: z.boolean().default(false),
  },
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({path: file, factor, service, allow_credits}, extra) => {
  try { readLocalImage(file); } catch (e) { return toolResult({status: 'error', error: e.message, error_kind: 'input'}, {text: 'Ошибка: ' + e.message, isError: true}); }
  const U = await upscaleMod();
  const job = startJob('upscale', async status => {
    const r = await U.upscaleImage({file: path.resolve(file), factor, service, allowCredits: allow_credits, outDir: path.join(OUT, new Date().toISOString().slice(0, 10)), onStatus: status});
    recordGen({kind: 'image', site: r.service === 'flow' ? 'flow' : 'freefield', model: `увеличение ×${factor} · ${r.engine}`, prompt: `увеличение ×${factor}: ${path.basename(file)}`, files: [{path: r.path, mime: r.mime}]});
    return toolResult(r, {text: [`Готово: ×${r.factor_actual ?? factor} · ${r.engine}`, `Файл: ${r.path}`, `Размер: ${r.width}×${r.height} (было ${r.source.width}×${r.source.height})`,
      ...r.warnings.map(w => '⚠ ' + w)].join('\n')});
  });
  return waitJob(job, WAIT_MS, extra);
});

/* ---- «Эхо»: клон голоса и озвучка (отдельная программа пользователя http://127.0.0.1:7865; её код не меняем) ---- */
const ECHO_URL = process.env.ECHO_URL || 'http://127.0.0.1:7865';
const ECHO_EMOTIONS = ['neutral', 'calm', 'happy', 'excited', 'sad', 'serious'];
const ECHO_LANGS = ['russian', 'english', 'german', 'french', 'spanish', 'italian', 'portuguese', 'japanese', 'korean', 'chinese', 'auto'];
class EchoError extends Error { constructor(msg, kind = 'echo') { super(msg); this.kind = kind; } }
async function echo(p, body) {
  let r;
  try {
    r = await fetch(ECHO_URL + p, {method: body ? 'POST' : 'GET', headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  } catch { throw new EchoError('«Эхо» не запущено — попроси пользователя открыть ярлык «Эхо — озвучка» на рабочем столе', 'not_running'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new EchoError(typeof data.detail === 'string' ? data.detail : data.error || `«Эхо» ответило ${r.status}`);
  return data;
}
// долгие операции «Эхо» — задача {id, status, progress, message, result, error}; видеокарта одна, задачи идут по очереди
async function echoWait(job, status) {
  while (job.status === 'queued' || job.status === 'running') {
    status(job.message || '«Эхо» работает…');
    await sleep(1000);
    job = await echo('/api/jobs/' + encodeURIComponent(job.id));
  }
  if (job.status === 'error') throw new EchoError(job.error || '«Эхо»: ошибка');
  return job.result;
}
const echoFail = e => toolResult({status: 'error', error: e.message, error_kind: e.kind || 'echo'}, {text: 'Ошибка: ' + e.message, isError: true});

server.registerTool('echo_voices', {
  title: 'Голоса в «Эхо»',
  description: 'Голоса, сохранённые в «Эхо» (клон голоса из отрезка видео или аудио, на этом компьютере): имя (обычно = имя персонажа Freefield), ' +
    'живые образцы эмоций, ★ избранные. JSON: voices [{name, favorite, emotions, samples: [{id, emotion, duration_s, text}]}].',
  inputSchema: {},
  annotations: {readOnlyHint: true, openWorldHint: false},
}, async () => {
  try {
    const groups = new Map();
    for (const v of await echo('/api/voices')) {
      const k = String(v.name).toLowerCase(), g = groups.get(k) || {name: v.name, favorite: false, emotions: [], samples: []};
      g.favorite ||= !!v.favorite;
      if (!g.emotions.includes(v.emotion || 'neutral')) g.emotions.push(v.emotion || 'neutral');
      g.samples.push({id: v.id, emotion: v.emotion || 'neutral', duration_s: v.duration ?? null, text: v.text || ''});
      groups.set(k, g);
    }
    const voices = [...groups.values()];
    return toolResult({status: 'done', voices}, {text: voices.length ? voices.map(g => `${g.favorite ? '★ ' : ''}${g.name} — образцы: ${g.emotions.join(', ')}`).join('\n') : 'В «Эхо» пока нет сохранённых голосов.'});
  } catch (e) { return echoFail(e); }
});

server.registerTool('echo_speak', {
  title: 'Озвучить текст голосом из «Эхо»',
  description: 'Озвучивает текст сохранённым в «Эхо» голосом (клон, на видеокарте этого компьютера, бесплатно). ' +
    'Эмоция: neutral = как в образце, calm, happy, excited, sad, serious. Есть у голоса живой образец этой эмоции — берётся он (emotion_natural=true), ' +
    'иначе эмоция добавляется обработкой интонации с силой intensity. Результат (JSON): files [{path (MP3, абсолютный), wav, duration_s, emotion, emotion_natural, take}]. ' +
    'Асинхронно: если вернулся job_id — дождись через check_job.',
  inputSchema: {
    voice: z.string().min(1).max(60).describe('Имя голоса из echo_voices (обычно имя персонажа)'),
    text: z.string().min(1).max(5000),
    emotion: z.enum(ECHO_EMOTIONS).default('neutral'),
    intensity: z.number().min(0.2).max(1).default(0.7),
    takes: z.number().int().min(1).max(3).default(1).describe('Сколько вариантов'),
    speed: z.number().min(0.8).max(1.3).default(1),
    language: z.enum(ECHO_LANGS).default('russian'),
  },
  annotations: {readOnlyHint: false, openWorldHint: false},
}, async (args, extra) => {
  const job = startJob('echo', async status => {
    const takes = await echoWait(await echo('/api/speak', args), status);
    const files = (takes || []).map(t => ({path: t.file_mp3, wav: t.file_wav || null, mime: 'audio/mpeg', duration_s: t.duration ?? null, voice: t.voice_name,
      emotion: t.emotion, emotion_natural: !!t.emotion_natural, intensity: t.intensity ?? null, take: t.take, takes: t.takes, speed: t.speed, language: t.language, echo_id: t.id}));
    return toolResult({status: 'done', service: 'echo', voice: args.voice, text: args.text, files}, {text: ['Готово:',
      ...files.map(f => `🎙 ${f.voice} · ${f.emotion}${f.emotion_natural ? ' (живой образец)' : ''} · ${f.duration_s} с — ${f.path}`)].join('\n')});
  });
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('echo_clone_voice', {
  title: 'Новый голос в «Эхо» из видео или аудио',
  description: 'Берёт голос из отрезка видео или аудио на этом компьютере (лучше 6–15 с чистой речи одного человека) и сохраняет в «Эхо» под именем. ' +
    'Тот же name с другой emotion — живой образец эмоции для уже существующего голоса. Асинхронно: если вернулся job_id — дождись через check_job.',
  inputSchema: {
    path: z.string().describe('Путь к видео или аудио на этом компьютере'),
    start: z.number().min(0).default(0),
    end: z.number().optional().describe('Конец отрезка, с; по умолчанию start+12'),
    name: z.string().min(1).max(60).describe('Имя голоса — обычно имя персонажа'),
    emotion: z.enum(ECHO_EMOTIONS).default('neutral').describe('Как человек говорит в этом отрезке'),
    clean: z.boolean().default(true).describe('Убрать музыку и шум'),
  },
  annotations: {readOnlyHint: false, openWorldHint: false},
}, async (args, extra) => {
  const file = path.resolve(args.path);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return toolResult({status: 'error', error: `нет файла ${file}`, error_kind: 'input'}, {text: `Ошибка: нет файла ${file}`, isError: true});
  const job = startJob('echo', async status => {
    const v = await echoWait(await echo('/api/voice-from-file', {...args, path: file, end: args.end ?? args.start + 12}), status);
    return toolResult({status: 'done', service: 'echo', voice: {id: v.id, name: v.name, emotion: v.emotion || 'neutral', duration_s: v.duration ?? null, text: v.text || ''}, source: file},
      {text: `Голос «${v.name}» (${v.emotion || 'neutral'}) сохранён в «Эхо». Распознанный текст образца: ${v.text || '—'}`});
  });
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('sync_sites', {
  title: 'Забрать всё с сайтов в Freefield',
  description: 'Проходит по сайтам (сейчас — проект Google Flow) и забирает в Freefield все готовые картинки и видео, которых там ещё нет ' +
    '(например, если генерацию запускали вручную или она «потерялась»). Файлы — в outputs, приложение само добавит их в галерею. ' +
    'После batch_generate синхронизация запускается сама.',
  inputSchema: {},
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async (_, extra) => {
  const job = startJob('sync', async status => {
    const r = await runSync(status);
    return {content: [{type: 'text', text: (r.added.length ? `Забрано с сайтов: ${r.added.length}\n` + r.added.map(i => `${i.kind === 'video' ? '🎬' : '🖼'} ${i.files[0].path}`).join('\n')
      : 'Новых файлов на сайтах нет — в Freefield уже всё.') + (r.errors.length ? '\nНе получилось: ' + r.errors.join('; ') : '')}]};
  });
  return waitJob(job, WAIT_MS, extra);
});

server.registerTool('chat_photos', {
  title: 'Фото из чата → референс',
  description: 'Сохраняет фото, которые пользователь прислал в этот чат Claude Code, в Freefield/outputs/refs и возвращает пути — их передают как image_path ' +
    'в batch_generate, arena_video, flow_image или dola_image. Вызывай, когда пользователь прислал фото и просит сделать что-то по нему. ' +
    'Если пользователь перетащил файл и в сообщении виден путь — можно передать этот путь сразу, без chat_photos.',
  inputSchema: {count: z.number().int().min(1).max(10).default(1).describe('Сколько последних фото из чата взять')},
  annotations: {readOnlyHint: false, openWorldHint: false},
}, async ({count}) => {
  const {chatPhotos} = await import('./refs.js');
  const {photos} = chatPhotos(OUT, count);
  if (!photos.length) return {isError: true, content: [{type: 'text', text: 'В чате Claude Code не нашёл присланных фото. Попроси пользователя вставить фото в чат ' +
    '(Ctrl+V или перетащить файл) или назвать путь к файлу.'}]};
  const content = [];
  for (const p of photos) try { content.push(...(await previewItem({buf: fs.readFileSync(p.path), mime: p.mime}))); } catch {}
  content.push({type: 'text', text: [`Фото из чата сохранены (${photos.length}):`, ...photos.map((p, i) => `${i + 1}. ${p.path}`),
    'Передай путь как image_path.'].join('\n')});
  return {content};
});

server.registerTool('phone_tasks', {
  title: 'Задания с телефона',
  description: 'Показывает пакеты сценариев, отправленные с телефона (раздел «Для Клода» в приложении Freefield) и запущенные Claude: что сгенерировано, где лежат файлы, какие ошибки. ' +
    'Сценарии с телефона компьютер запускает сам сразу после отправки.',
  inputSchema: {limit: z.number().int().min(1).max(30).default(5)},
  annotations: {readOnlyHint: true, openWorldHint: false},
}, async ({limit}) => {
  const B = await batchMod();
  const list = allBatches().slice(0, limit);
  if (!list.length) return {content: [{type: 'text', text: 'Пакетов пока не было. Телефон подключается инструментом phone_link.'}]};
  return {content: [{type: 'text', text: list.map(b => `${b.source === 'phone' ? '📱 С телефона' : '🤖 От Claude'} · ${new Date(b.created).toLocaleString('ru')} · ${b.done ? 'завершён' : 'идёт'} · ${b.id}\n` +
    B.summary(b.items)).join('\n\n')}]};
});

server.registerTool('phone_link', {
  title: 'Подключить телефон',
  description: 'Включает связь Freefield с телефоном по домашнему Wi-Fi (напрямую с компьютером, без посредников в интернете) и показывает QR-код. ' +
    'Пользователь сканирует его телефоном — открывается Freefield с разделом «Для Клода»: там пишут до 10 сценариев, компьютер сам запускает их через ' +
    'Google Flow / Arena / Dola и возвращает готовые видео и картинки в галерею телефона. Покажи пользователю QR-код и инструкцию из ответа.',
  inputSchema: {new_key: z.boolean().default(false).describe('true — выдать новый секретный ключ (старая ссылка на телефоне перестанет работать)')},
  annotations: {readOnlyHint: false, openWorldHint: false},
}, async ({new_key}) => {
  try {
    if (new_key) writeState({hubKey: crypto.randomBytes(18).toString('base64url')});
    const urls = await ensureHub();
    if (!urls.length) return {isError: true, content: [{type: 'text', text: 'Компьютер не подключён к домашней сети (Wi-Fi или кабель) — телефону не к чему подключиться.'}]};
    const qrcode = (await import('qrcode-generator')).default;
    const qr = qrcode(0, 'M');
    qr.addData(urls[0]);
    qr.make();
    const sharp = (await import('sharp')).default;
    const png = await sharp(Buffer.from(qr.createSvgTag({cellSize: 10, margin: 4}))).flatten({background: '#ffffff'}).png().toBuffer();
    return {content: [{type: 'image', data: png.toString('base64'), mimeType: 'image/png'}, {type: 'text', text: [
      'Связь с телефоном включена.',
      '1. Телефон должен быть в той же сети Wi-Fi, что и компьютер.',
      `2. Наведите камеру телефона на QR-код или откройте ссылку: ${urls[0]}`,
      urls.length > 1 ? `   Если не открывается — другой адрес этого компьютера: ${urls.slice(1).join(' , ')}` : '',
      '3. Откроется Freefield → раздел «🤖 Для Клода»: пишите сценарии и жмите «Запустить на компьютере». Готовые файлы сами появятся в галерее телефона.',
      'Если Windows спросит, разрешить ли Node.js доступ к сети, — разрешите для частных сетей, иначе телефон не подключится.',
      'Компьютер должен быть включён, Claude Desktop — открыт, окно Chrome Freefield — с выполненным входом.',
      'Ссылка секретная: любой, у кого она есть, может запускать генерации на ваших аккаунтах. Сменить ключ: phone_link с new_key=true.',
    ].filter(Boolean).join('\n')}]};
  } catch (e) { return {isError: true, content: [{type: 'text', text: 'Не удалось включить связь с телефоном: ' + e.message}]}; }
});

server.registerTool('switch_account', {
  title: 'Сменить аккаунт на сайте',
  description: 'Открывает в окне Chrome Freefield смену аккаунта на сайте Google Flow, Arena или Dola — например, когда на этом аккаунте закончились кредиты. ' +
    'Другой аккаунт выбирает и входит в него сам пользователь; пароли Freefield не вводит. После смены проверь вход через portal_status.',
  inputSchema: {site: z.enum(['flow', 'arena', 'dola', 'vids'])},
  annotations: {readOnlyHint: false, openWorldHint: true},
}, async ({site}) => {
  const r = await hubApi.switchAccount(site);
  return {isError: !r.ok, content: [{type: 'text', text: r.message}]};
});

server.registerTool('portal_status', {
  title: 'Вход в сервисы и остаток бесплатного',
  description: 'Проверяет вход в окне Chrome Freefield и остаток бесплатного: Google Flow (кредиты на сегодня), Dola, Arena, Vids, а для 3D — Hunyuan 3D (генераций на сегодня), ' +
    'Tripo и Meshy (кредиты на месяц), Hugging Face (вход и квота ZeroGPU). open=true — открыть сайты, чтобы пользователь мог войти.',
  inputSchema: {open: z.boolean().default(false)},
  annotations: {readOnlyHint: true, openWorldHint: true},
}, async ({open}) => {
  try {
    const P = await portals();
    const st = await P.status(open);
    const u = P.usageReport();
    const M = await mesh3d();
    const st3 = await M.status3d(open).catch(e => ({error: e.message}));
    const free3 = Object.fromEntries(Object.keys(M.SERVICES_3D).map(k => [k, M.freeLeft(k)]));
    return toolResult({sites: st, sites_3d: st3, free_left_3d: free3, usage_today: {flow: u.flow, dola: u.dola, arena: u.arena, vids: u.vids}},
      {text: Object.entries(st).map(([k, v]) => `${P.SITES[k].name}: ${v}`).join('\n') +
      `\n\n3D:\n` + Object.entries(st3).map(([k, v]) => `${M.SERVICES_3D[k]?.name || k}: ${v}`).join('\n') +
      `\n\nРасход сегодня:\nGoogle Flow: ${u.flow}\nDola: ${u.dola}\nArena: ${u.arena}\nGoogle Vids: ${u.vids}`});
  } catch (e) { return {isError: true, content: [{type: 'text', text: 'Не удалось открыть браузер Freefield: ' + e.message}]}; }
});

// MCP по ссылке (Streamable HTTP, без сессий): на каждый запрос — свой экземпляр с теми же инструментами и общими задачами (check_job)
hubApi.mcp = async (req, res) => {
  const s = new McpServer(SERVER_INFO, SERVER_OPTS);
  for (const a of TOOLS) s.registerTool(...a);
  const t = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
  res.on('close', () => { t.close().catch(() => {}); s.close().catch(() => {}); });
  await s.connect(t);
  await t.handleRequest(req, res);
};

await server.connect(new StdioServerTransport());
log(`запущен · файлы: ${OUT}`);

// связь с телефоном включается один раз (phone_link) и дальше поднимается сама; если её держит другой Freefield — ждём своей очереди
if (readState().hubEnabled) {
  const tryHub = () => { if (!hubRunning() && readState().hubEnabled) ensureHub().catch(e => log('телефон:', e.message)); };
  tryHub();
  setInterval(tryHub, 60e3).unref();
}
