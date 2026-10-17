// «🔥 Тренды» (пользователь 2026-10-17: «чтобы агент сам искал самые вирусные видео сейчас, мы собирали с них движение людей
// и делали motion control — заменяли персонажей, а движение и музыка оставались те же; локацию тоже можно менять;
// и подсовывал мне идеи, с чем сейчас сделать брейнрот»).
//  • поиск — бесплатно, сам: страницы хэштегов YouTube Shorts через yt-dlp (просмотры, дата → просмотров в день);
//    агент в чате добавляет TikTok и Reels через vidIQ и пишет идеи (MCP trends action=save); из приложения идеи пишет
//    Claude Code этого компьютера по подписке (write.js), как сценарии;
//  • скачивание — только ролик, который выбрал пользователь: yt-dlp → outputs/trends/<ролик>/source.mp4 (видео + звук);
//  • перенос движения — Wan2.2-Animate (открытая модель Alibaba) в Space alexnasa/Wan2.2-Animate-ZEROGPU на Hugging Face,
//    на дневной квоте ZeroGPU аккаунта пользователя (бесплатный аккаунт — 3,5 мин GPU в день ≈ один ролик до 10–15 с в 360p).
//    swap — персонаж встаёт на место человека в исходном кадре (локация та же); move — новый кадр «герой в новой локации»
//    (Google Flow, Nano Banana по первому кадру ролика) и движение переносится на него — локация меняется.
//    Звук — исходная дорожка ролика целиком, без пережатия речи; картинка поднимается до 720p.
// Чужая музыка в ролике может отключить звук или монетизацию на площадке — приложение предупреждает об этом.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {HERE} from './state.js';
import {run, lastErr, ensureFfmpeg, TOOLS} from './avtools.js';

const WIN = process.platform === 'win32';
const OUT = process.env.FREEFIELD_OUTPUT_DIR || path.join(HERE, '..', 'outputs');
export const TRENDS_DIR = path.join(OUT, 'trends');
const STORE = path.join(TRENDS_DIR, 'trends.json');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + (WIN ? 'yt-dlp.exe' : 'yt-dlp');
export const WAN_SPACE = 'alexnasa/Wan2.2-Animate-ZEROGPU';
// хэштеги, где лежат вирусные танцы, мемы и тренды со звуком — по ним Freefield ищет сам
const TAGS = ['brainrot', 'dancetrend', 'trend', 'meme', 'funny', 'viral', 'trending'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================== yt-dlp ==============================
let ytdlpP = null;
export function ensureYtdlp(note = () => {}) {
  const exe = path.join(TOOLS, 'yt-dlp', WIN ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(exe)) return Promise.resolve(exe);
  return ytdlpP ||= (async () => {
    note('Первый раз: ставлю загрузчик роликов yt-dlp (~18 МБ, один раз)…');
    fs.mkdirSync(path.dirname(exe), {recursive: true});
    const r = await fetch(YTDLP_URL, {redirect: 'follow'});
    if (!r.ok || !r.body) throw new Error(`yt-dlp не скачался (${r.status})`);
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(exe + '.part'));
    fs.renameSync(exe + '.part', exe);
    if (!WIN) fs.chmodSync(exe, 0o755);
    return exe;
  })().finally(() => { ytdlpP = null; });
}
// сайты меняются — yt-dlp обновляется сам, не чаще раза в 3 дня, когда что-то не скачалось
async function ytdlpUpdate(exe) {
  const f = exe + '.updated';
  try { if (Date.now() - fs.statSync(f).mtimeMs < 3 * 864e5) return false; } catch {}
  fs.writeFileSync(f, '');
  return (await run(exe, ['-U'])).code === 0;
}
async function ytJson(exe, args, ms = 90000) {
  let out = '';
  const p = run(exe, [...args, '--no-warnings', '--socket-timeout', '20'], {stdout: d => { out += d; }});
  const r = await Promise.race([p, sleep(ms).then(() => ({code: -2, tail: 'не ответил за ' + Math.round(ms / 1000) + ' с'}))]);
  if (r.code !== 0) throw new Error(lastErr(r.tail) || 'yt-dlp: код ' + r.code);
  return JSON.parse(out);
}
const pool = async (list, n, fn) => { const out = []; let i = 0; await Promise.all(Array.from({length: Math.min(n, list.length)}, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]).catch(() => null); } })); return out; };

// ============================== хранилище ==============================
export function trendsList() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {updated: 0, items: [], ideas: []}; }
}
function writeStore(s) { fs.mkdirSync(TRENDS_DIR, {recursive: true}); fs.writeFileSync(STORE, JSON.stringify(s, null, 1)); return s; }
export const trendId = url => {
  const u = String(url);
  const yt = u.match(/(?:shorts\/|v=|youtu\.be\/)([\w-]{11})/), tt = u.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/), ig = u.match(/instagram\.com\/(?:reel|reels|p)\/([\w-]+)/);
  return yt ? 'yt-' + yt[1] : tt ? 'tt-' + tt[1] : ig ? 'ig-' + ig[1] : 'u-' + crypto.createHash('sha1').update(u).digest('hex').slice(0, 10);
};
const platformOf = url => /tiktok\.com/.test(url) ? 'tiktok' : /instagram\.com/.test(url) ? 'instagram' : /youtu/.test(url) ? 'youtube' : 'other';
const str = (v, n) => v == null ? '' : String(v).trim().slice(0, n);
const num = v => Number.isFinite(+v) && +v >= 0 ? Math.round(+v) : null;
// одна запись тренда — только известные поля (агент, приложение и поиск пишут в одно место)
function cleanItem(x, old = {}) {
  const url = str(x.url || old.url, 500);
  if (!/^https:\/\/(www\.|m\.|vm\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com)\//.test(url)) return null;
  const ideas = (Array.isArray(x.ideas) ? x.ideas : old.ideas || []).map(i => typeof i === 'string' ? {title: str(i, 300)} : {title: str(i?.title, 300), hero: str(i?.hero, 80), how: str(i?.how, 600)}).filter(i => i.title).slice(0, 6);
  return {id: trendId(url), url, platform: platformOf(url), title: str(x.title ?? old.title, 300), author: str(x.author ?? old.author, 80),
    views: num(x.views ?? old.views), growth: str(x.growth ?? old.growth, 80), views_per_day: num(x.views_per_day ?? old.views_per_day),
    age_days: x.age_days ?? old.age_days ?? null, duration: x.duration ?? old.duration ?? null, thumb: /^https:\/\//.test(x.thumb || '') ? str(x.thumb, 500) : old.thumb || '',
    about: str(x.about ?? old.about, 600), motion: str(x.motion ?? old.motion, 400), sound: str(x.sound ?? old.sound, 200),
    fit: x.fit != null ? Math.max(0, Math.min(10, +x.fit || 0)) : old.fit ?? null, ideas,
    source: str(x.source ?? old.source ?? 'freefield', 40), found: old.found || Date.now(), updated: Date.now(),
    ...(old.local && {local: old.local})};
}
// items — новые или дополненные тренды; replace — вся лента заново; ideas — общие идеи брейнрота «что снять сейчас»
export function saveTrends({items = [], ideas, replace = false} = {}) {
  const s = replace ? {updated: 0, items: [], ideas: []} : trendsList();
  const byId = new Map(s.items.map(i => [i.id, i]));
  let added = 0;
  for (const x of items) {
    const id = x?.url ? trendId(x.url) : null;
    const it = cleanItem(x || {}, byId.get(id) || {});
    if (!it) continue;
    if (!byId.has(it.id)) added++;
    byId.set(it.id, it);
  }
  s.items = [...byId.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 80);
  if (Array.isArray(ideas)) s.ideas = ideas.map(i => typeof i === 'string' ? {title: str(i, 300)} : {title: str(i?.title, 300), hero: str(i?.hero, 80), how: str(i?.how, 600), trend: str(i?.trend, 40)}).filter(i => i.title).slice(0, 12);
  s.updated = Date.now();
  writeStore(s);
  return {added, total: s.items.length};
}
export function trendDelete(id) {
  const s = trendsList();
  s.items = s.items.filter(i => i.id !== id);
  writeStore(s);
  return true;
}

// ============================== поиск ==============================
// Свежие самые просматриваемые Shorts по хэштегам: просмотры, возраст, просмотров в день. TikTok и Reels — через vidIQ у агента.
export async function findTrends({tags = TAGS, query, limit = 12, days = 21, onStatus = () => {}} = {}) {
  const exe = await ensureYtdlp(onStatus);
  const list = [...new Set([...(query ? String(query).toLowerCase().split(/[\s,#]+/) : []), ...(query ? [] : tags)].map(t => t.replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean))].slice(0, 8);
  onStatus(`Ищу вирусные Shorts: #${list.join(' #')}`);
  const pages = await pool(list, 4, t => ytJson(exe, ['--flat-playlist', '-J', '--playlist-end', '30', `https://www.youtube.com/hashtag/${encodeURIComponent(t)}/shorts`], 60000));
  const seen = new Map();
  pages.forEach((p, k) => (p?.entries || []).forEach(e => { const id = e.id || trendId(e.url); if (e.view_count && !seen.has(id)) seen.set(id, {id, url: `https://www.youtube.com/shorts/${id}`, views: e.view_count, tag: list[k]}); }));
  if (!seen.size) throw new Error('YouTube не отдал ни одного ролика — нет интернета или yt-dlp устарел');
  const top = [...seen.values()].sort((a, b) => b.views - a.views).slice(0, Math.max(limit * 3, 24));
  onStatus(`Нашёл ${seen.size} роликов — смотрю даты и звук у ${top.length} самых просматриваемых`);
  const now = Date.now();
  const full = await pool(top, 6, async c => {
    const j = await ytJson(exe, ['-J', '--skip-download', c.url], 60000);
    const d = String(j.upload_date || '');
    const at = j.timestamp ? j.timestamp * 1000 : d.length === 8 ? Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T12:00:00Z`) : null;
    const age = at ? Math.max(0.5, (now - at) / 864e5) : null;
    return {url: c.url, title: j.title || '', author: j.uploader || j.channel || '', views: j.view_count || c.views, age_days: age != null ? Math.round(age * 10) / 10 : null,
      views_per_day: age ? Math.round((j.view_count || c.views) / age) : null, duration: j.duration || null, thumb: j.thumbnail || `https://i.ytimg.com/vi/${c.id}/hq2.jpg`,
      sound: [j.track, j.artist].filter(Boolean).join(' — '), about: str(j.description, 300), tag: c.tag};
  });
  const fresh = full.filter(Boolean).filter(x => x.age_days == null || x.age_days <= days);
  const items = (fresh.length >= 4 ? fresh : full.filter(Boolean)).sort((a, b) => (b.views_per_day || 0) - (a.views_per_day || 0)).slice(0, limit)
    .map(x => ({...x, growth: x.views_per_day ? `≈ ${fmtN(x.views_per_day)} просмотров в день` : '', source: 'youtube'}));
  return {items, tags: list, scanned: seen.size};
}
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тыс.' : String(n);

// Идеи брейнрота под героев пользователя — пишет Claude Code этого компьютера (подписка); не вышло — тренды без идей
export const IDEAS_SYSTEM = 'You help a Russian creator remake viral short videos with their own non-human cartoon characters via AI motion transfer ' +
  '(the movement and the original sound stay, the person is replaced by the character, the location may change). For every trend return: ' +
  'about — what happens in the clip; motion — the body movement to copy; sound — the music/sound; fit — 0..10 how well it suits motion transfer ' +
  '(10 = one person, full body, static camera, clear dance or gesture; 0 = talking head, many cuts, text-only); ideas — 3 brainrot ideas with the given heroes: ' +
  'title (short, funny, absurd, built on contrast between the hero and the trend), hero (which hero), how (new location / twist in one sentence). ' +
  'Then 3-5 general ideas «what to make right now». Write all texts in Russian, short. Answer ONLY with JSON: ' +
  '{"items":[{"url":"…","about":"…","motion":"…","sound":"…","fit":7,"ideas":[{"title":"…","hero":"…","how":"…"}]}],"ideas":[{"title":"…","hero":"…","how":"…","trend":"<url>"}]}';
export async function writeIdeas(items, heroes = [], onStatus = () => {}) {
  const W = await import('./write.js');
  if (!W.claudeExe()) return {error: 'на компьютере нет Claude Code — идеи напишет Claude в чате (MCP trends)'};
  onStatus('Claude пишет идеи брейнрота под ваших героев…');
  // герои — из приложения, иначе сохранённые агентом (heroes.js); нет никого — идеи для «вашего героя» без имени
  // (пользователь 2026-10-17: «везде рохля, хотя персонажа нет»)
  if (!heroes.length) heroes = (await import('./heroes.js')).heroesList().map(h => ({name: h.name, about: h.about || ''}));
  const text = (heroes.length ? 'Heroes:\n' + heroes.map(h => `- ${h.name}${h.about ? ': ' + h.about : ''}`).join('\n')
    : 'Heroes: none yet. Write ideas for «ваш герой» — any cartoon or absurd character the user will pick later; never invent a hero name, leave "hero" empty.') + '\n\nTrends:\n' +
    items.map((x, i) => `${i + 1}. ${x.url}\n   title: ${x.title}\n   views: ${x.views}${x.views_per_day ? `, ${x.views_per_day}/day` : ''}${x.duration ? `, ${x.duration}s` : ''}\n   sound: ${x.sound || '?'}\n   description: ${x.about || ''}`).join('\n');
  const ans = await W.claudeAsk(IDEAS_SYSTEM, text, 'sonnet', 240000);
  if (!ans) return {error: 'Claude не ответил (лимит подписки или нет входа) — тренды сохранены без идей'};
  try {
    const j = JSON.parse(ans.slice(ans.indexOf('{'), ans.lastIndexOf('}') + 1));
    return {items: Array.isArray(j.items) ? j.items : [], ideas: Array.isArray(j.ideas) ? j.ideas : []};
  } catch { return {error: 'Claude ответил не по форме — тренды сохранены без идей'}; }
}

// ============================== скачивание ==============================
export async function downloadTrend(url, {onStatus = () => {}} = {}) {
  if (!/^https:\/\//.test(String(url || ''))) throw new Error('нужна ссылка на ролик (https://…)');
  const id = trendId(url), dir = path.join(TRENDS_DIR, id);
  const have = fs.existsSync(dir) && fs.readdirSync(dir).find(f => /^source\.(mp4|mkv|webm|mov)$/.test(f));
  const {ffmpeg, ffprobe} = await ensureFfmpeg(onStatus);
  if (!have) {
    const exe = await ensureYtdlp(onStatus);
    fs.mkdirSync(dir, {recursive: true});
    const args = ['--no-playlist', '-f', 'bv*[height<=1920]+ba/b', '--merge-output-format', 'mp4', '--ffmpeg-location', path.dirname(ffmpeg),
      '-o', path.join(dir, 'source.%(ext)s'), '--write-info-json', '--no-warnings', '--newline', url];
    const go = () => run(exe, args, {onLine: l => { const m = l.match(/\[download\]\s+([\d.]+)%/); if (m) onStatus(`Скачиваю ролик: ${Math.floor(+m[1])} %`); }});
    onStatus('Скачиваю ролик…');
    let r = await go();
    if (r.code !== 0 && await ytdlpUpdate(exe)) { onStatus('Обновил yt-dlp — скачиваю ещё раз…'); r = await go(); }
    if (r.code !== 0) {
      const why = lastErr(r.tail);
      throw new Error(/login|sign in|cookies|private/i.test(why) ? 'сайт не отдаёт этот ролик без входа (часто так у Instagram) — возьмите ролик с TikTok или YouTube' : 'ролик не скачался: ' + why);
    }
  }
  const video = path.join(dir, fs.readdirSync(dir).find(f => /^source\.(mp4|mkv|webm|mov)$/.test(f)));
  let info = {};
  try { info = JSON.parse(fs.readFileSync(path.join(dir, 'source.info.json'), 'utf8')); } catch {}
  const probe = await probeMedia(ffprobe, video);
  const audio = path.join(dir, 'audio.m4a');
  if (probe.audio && !fs.existsSync(audio)) await run(ffmpeg, ['-y', '-i', video, '-vn', '-c:a', 'aac', '-b:a', '192k', audio]);
  // запомнить, что ролик уже на компьютере
  const s = trendsList(), it = s.items.find(x => x.id === id);
  if (it) { it.local = {video, audio: probe.audio ? audio : null}; writeStore(s); }
  return {id, dir, video, audio: probe.audio ? audio : null, duration: probe.duration, width: probe.width, height: probe.height, fps: probe.fps,
    title: info.title || it?.title || '', author: info.uploader || it?.author || '', url};
}
async function probeMedia(ffprobe, file) {
  let out = '';
  await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file], {stdout: d => { out += d; }});
  const j = JSON.parse(out || '{}'), v = (j.streams || []).find(s => s.codec_type === 'video');
  const [a, b] = String(v?.r_frame_rate || '30/1').split('/').map(Number);
  return {duration: +(+j.format?.duration || 0).toFixed(2), width: v?.width || 0, height: v?.height || 0, fps: b ? Math.round(a / b) : 30, audio: (j.streams || []).some(s => s.codec_type === 'audio')};
}

// ============================== перенос движения ==============================
// GPU-секунды Space на ролик (его же таблица; «Low Res» — половина; функция на size='xlarge' — квота идёт вдвое):
// дневная квота ZeroGPU по документации HF (октябрь 2026): без входа — 120 с, бесплатный аккаунт — 300 с, PRO — 2400 с
const WAN_COST = {1: 90, 2: 110, 3: 150, 4: 150, 5: 150, 6: 210, 7: 220, 8: 260, 9: 270, 10: 270, 11: 320, 12: 340, 13: 360, 14: 390, 15: 390, 16: 450, 17: 460, 18: 470, 19: 480, 20: 500};
export const wanGpuSeconds = (sec, quality = 'low') => Math.round(WAN_COST[Math.max(2, Math.min(20, Math.round(sec)))] * (quality === 'medium' ? 1 : 0.5) * 2);
export const HF_QUOTA = {anon: 120, free: 300, pro: 2400};
// сколько секунд ролика помещается в квоту
export const wanMaxSeconds = (quality = 'low', budget = HF_QUOTA.free) => { let s = 2; for (let k = 2; k <= 20; k++) if (wanGpuSeconds(k, quality) <= budget) s = k; return s; };

const HERO_RULE = 'exactly like the character in the hero reference image — same body shape, materials, colors, clothes and proportions; if the hero has no head or no face, keep it that way (no human head, no human face)';
export function locationPrompt(location, hasLocPhoto) {
  return 'Replace the person in the first reference image with the character from the second reference image, ' + HERO_RULE + '. ' +
    'Keep exactly the same pose, body position, framing, camera angle and scale as the person in the first image, full body visible, nothing cropped. ' +
    (hasLocPhoto ? 'Background: the place from the third reference image' + (location ? `, ${location}` : '') + '. ' : `Background: ${location}. `) +
    'Realistic photo, natural light matching the scene, vertical frame. Only one character in the frame. No text, no logos, no watermark.';
}

// В каком профиле Chrome Freefield пользователь вошёл в Hugging Face (2026-10-17: вошёл не в первом профиле, а Freefield
// открывал Space в первом — «нужно войти»): ищем открытую вкладку huggingface.co со входом, запоминаем профиль
async function hfProfile() {
  const S = await import('./state.js'), B = await import('./bridge.js');
  try {
    const c = await B.rawCdp();
    try {
      const hf = (await c.pages()).filter(t => /^https:\/\/huggingface\.co\//.test(t.url));
      for (const t of hf) {
        const {sessionId} = await c.send('Target.attachToTarget', {targetId: t.targetId, flatten: true});
        const r = await c.send('Runtime.evaluate', {expression: "fetch('/api/whoami-v2',{credentials:'include'}).then(r=>r.ok)", awaitPromise: true, returnByValue: true}, sessionId, 15000).catch(() => null);
        await c.send('Target.detachFromTarget', {sessionId}).catch(() => {});
        if (!r?.result?.value) continue;
        const dir = Object.entries((await B.openProfilesNow()).map).find(([, ctx]) => ctx === t.browserContextId)?.[0];
        const id = dir === 'Default' ? 1 : +(dir?.match(/^Profile (\d+)$/)?.[1]) + 1;
        if (id > 0) { S.writeState({hfProfile: id}); return id; }
      }
    } finally { c.close(); }
  } catch { /* Chrome закрыт — берём запомненный */ }
  return S.readState().hfProfile || S.currentProfile();
}

// source — путь к видео или ссылка; hero — фото героя; location — описание новой локации (по-английски) и/или locationImage — её фото
// mode: auto (move, если задана локация, иначе swap) | swap | move; start, seconds — какой кусок ролика взять
export async function motionTransfer({source, hero, location = '', locationImage = null, mode = 'auto', start = 0, seconds, quality = 'low', name = '', budget = HF_QUOTA.free, anonymous = false, onStatus = () => {}, outDir}) {
  if (!hero || !fs.existsSync(hero)) throw new Error('нужно фото героя (hero)');
  if (locationImage && !fs.existsSync(locationImage)) throw new Error('нет фото локации ' + locationImage);
  const {ffmpeg, ffprobe} = await ensureFfmpeg(onStatus);
  let src = source;
  if (/^https:\/\//.test(String(source || ''))) src = (await downloadTrend(source, {onStatus})).video;
  if (!src || !fs.existsSync(src)) throw new Error('нет ролика: ' + source);
  const P0 = await probeMedia(ffprobe, src);
  const want = mode === 'auto' ? (location || locationImage ? 'move' : 'swap') : mode;
  const S = Math.max(0, Math.min(+start || 0, Math.max(0, P0.duration - 2)));
  const cap = wanMaxSeconds(quality, budget);
  const secs = Math.max(2, Math.min(20, Math.round(seconds || Math.min(P0.duration - S, cap)), Math.floor(P0.duration - S) || 2));
  const work = fs.mkdtempSync(path.join(TRENDS_DIR, '.work-'));
  try {
    // 1) кусок ролика (H.264 + AAC) и его первый кадр
    onStatus(`Вырезаю ${secs} с ролика с ${S} с`);
    const seg = path.join(work, 'segment.mp4'), frame0 = path.join(work, 'frame0.jpg');
    let r = await run(ffmpeg, ['-y', '-ss', String(S), '-t', String(secs), '-i', src, '-vf', 'scale=w=min(1080\\,iw):h=-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', seg]);
    if (r.code !== 0) throw new Error('ролик не вырезался: ' + lastErr(r.tail));
    await run(ffmpeg, ['-y', '-i', seg, '-frames:v', '1', '-q:v', '2', frame0]);
    const P = await probeMedia(ffprobe, seg);
    const portrait = P.height >= P.width;
    // 2) кем заменить: swap — фото героя; move — герой в новой локации в позе первого кадра (Google Flow, бесплатно)
    let ref = hero, refNote = '';
    if (want === 'move') {
      if (!location && !locationImage) throw new Error('для смены локации нужна локация: описание или фото');
      onStatus('Google Flow ставит героя в новую локацию в позе из ролика…');
      const Pt = await import('./portals.js');
      const res = await Pt.flowImage({prompt: locationPrompt(location, !!locationImage), aspect: portrait ? '9:16' : '16:9', count: 1,
        model: Pt.FLOW_IMAGE_MODELS['nano-banana-2.1'], imagePaths: [frame0, hero, ...(locationImage ? [locationImage] : [])], onStatus, allowCredits: false});
      const img = res?.find(x => x?.buf);
      if (!img) throw new Error('Google Flow не сделал кадр героя в локации' + (res?.[0]?.error ? ': ' + res[0].error : ''));
      ref = path.join(work, 'hero-in-location' + (/png/.test(img.mime || '') ? '.png' : '.jpg'));
      fs.writeFileSync(ref, img.buf);
      refNote = 'кадр героя в новой локации — Google Flow';
    }
    // 3) Wan2.2-Animate на Hugging Face (квота ZeroGPU пользователя)
    const sp = anonymous ? await (await import('./gradio.js')).openSpace({space: WAN_SPACE, anonymous: true, onStatus})
      : await (await import('./state.js')).withProfile(await hfProfile(), async () => (await import('./mesh3d.js')).hfSession(WAN_SPACE, onStatus));
    const dep = sp.find('animate_scene');
    if (!dep) throw new Error(`в Space ${WAN_SPACE} нет функции animate_scene — его интерфейс изменился`);
    const html = (dep.inputs || []).filter(id => sp.cfg.components.find(c => c.id === id)?.type === 'html');
    const vid = await sp.upload(fs.readFileSync(seg), 'segment.mp4', 'video/mp4');
    const im = await sp.upload(fs.readFileSync(ref), path.basename(ref), /\.png$/i.test(ref) ? 'image/png' : 'image/jpeg');
    // Gradio 6 принимает видео как обычный файл, Gradio 4–5 — как {video, subtitles}
    const set = {'input video': +String(sp.cfg.version || '6').split('.')[0] >= 6 ? vid : {video: vid, subtitles: null}, 'max duration': secs, 'ref image': im};
    if (html[0] != null) set[html[0]] = want === 'move' ? 'Pose Retarget' : 'Character Swap';
    if (html[1] != null) set[html[1]] = quality === 'medium' ? 'Medium Res' : 'Low Res';
    const gpu = wanGpuSeconds(secs, quality);
    onStatus(`Wan 2.2 Animate переносит движение (${secs} с, ${quality === 'medium' ? '480p' : '360p'}, ≈ ${gpu} с GPU из квоты)…`);
    const out = await sp.call(dep, set, {status: 'Wan 2.2 Animate переносит движение', timeoutMs: 25 * 60e3});
    const v = out[0]?.video || out[0];
    const url = sp.fileUrl(v);
    if (!url) throw new Error('Wan 2.2 Animate не вернул видео');
    const wan = path.join(work, 'wan.mp4');
    fs.writeFileSync(wan, await sp.fetchFile(url));
    // 4) картинка — до 720p (вертикаль 720×1280), звук — исходная дорожка ролика
    onStatus('Склеиваю: новое видео + исходный звук ролика, 720p');
    const W = portrait ? 720 : 1280, H = portrait ? 1280 : 720;
    const dir = outDir || path.join(OUT, new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dir, {recursive: true});
    const slug = (name || 'trend').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30) || 'trend';
    const file = path.join(dir, `trend-${slug}-${Date.now().toString(36)}.mp4`);
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,unsharp=5:5:0.6,fps=30,format=yuv420p`;
    r = await run(ffmpeg, ['-y', '-i', wan, '-i', seg, '-map', '0:v:0', ...(P.audio ? ['-map', '1:a:0'] : []), '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
      ...(P.audio ? ['-c:a', 'aac', '-b:a', '192k'] : []), '-shortest', '-movflags', '+faststart', file]);
    if (r.code !== 0) throw new Error('не склеилось: ' + lastErr(r.tail));
    const F = await probeMedia(ffprobe, file);
    let refFile = null;
    if (want === 'move') { refFile = file.replace(/\.mp4$/, '-frame.jpg'); fs.copyFileSync(ref, refFile); }
    return {path: file, mode: want, seconds: F.duration, width: F.width, height: F.height, audio: P.audio ? 'исходный звук ролика' : 'в ролике нет звука',
      engine: `Wan 2.2 Animate (${WAN_SPACE}, ${quality === 'medium' ? '480p' : '360p'} → 720p)`, gpu_seconds: gpu, space_mode: sp.mode,
      ref_frame: refFile, ref_note: refNote, start: S, source: src};
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
}
