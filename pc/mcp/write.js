// Сценарии пишет Claude Code этого компьютера — по подписке пользователя, без ключа и без доплат (пользователь 2026-10-09:
// «AI Studio постоянно проблемы с ключом… у меня подписка есть»; «Freefield отдаёт задание в Claude Code, сценарий идёт куда надо»).
// Приложение присылает системный промпт и задание с картинками → claude.exe -p (без инструментов, MCP, настроек и истории) → текст.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {HERE} from './state.js';

const WIN = process.platform === 'win32';
// где Claude Code: установка через npm (claude.exe рядом с claude.cmd) или claude в PATH
export function claudeExe() {
  const npm = WIN && process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  if (npm && fs.existsSync(npm)) return npm;
  const local = path.join(os.homedir(), '.local', 'bin', WIN ? 'claude.exe' : 'claude');
  if (fs.existsSync(local)) return local;
  try {
    const r = spawnSync(WIN ? 'where' : 'which', ['claude'], {encoding: 'utf8', windowsHide: true, timeout: 5000});
    const hit = (r.stdout || '').split(/\r?\n/).map(s => s.trim()).find(s => /\.exe$/i.test(s) || (!WIN && s));
    return hit && fs.existsSync(hit) ? hit : null;
  } catch { return null; }
}

// каждое задание и ответ — файлом: outputs/Сценарии Claude/<дата>/<время>.md (картинки — только подписи)
export const WRITE_DIR = path.join(process.env.FREEFIELD_OUTPUT_DIR || path.join(HERE, '..', 'outputs'), 'Сценарии Claude');
function keep(job, sys, blocks) {
  try {
    const d = new Date(job.at), pad = n => String(n).padStart(2, '0');
    const dir = path.join(WRITE_DIR, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    fs.mkdirSync(dir, {recursive: true});
    const task = blocks.map(b => b.type === 'image' ? '[картинка]' : b.text).join('\n');
    job.file = path.join(dir, `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${job.id.slice(0, 4)}.md`);
    fs.writeFileSync(job.file, `# Claude ${job.model} — ${d.toLocaleString('ru-RU')}\n\n## Ответ\n\n${job.text || job.error}\n\n## Задание\n\n${task}\n\n## Системный промпт\n\n${sys}\n`);
  } catch { /* не записалось — ответ всё равно уходит в приложение */ }
}
const jobs = new Map();
let queue = Promise.resolve();   // по одному: несколько заданий сразу быстро выбирают лимит подписки
const MODELS = ['opus', 'sonnet', 'haiku'];
const IMG = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

// content — [{type:'text', text} | {type:'image', data: 'data:image/…;base64,…'}]
export function writeStart({system, content, model} = {}) {
  if (!claudeExe()) throw new Error('на компьютере нет Claude Code — установите его или выберите другой ИИ');
  const sys = String(system || '').slice(0, 200000);
  if (!Array.isArray(content) || !content.length) throw new Error('пустое задание');
  let bytes = 0;
  const blocks = content.slice(0, 60).map(b => {
    if (b?.type === 'image') {
      const m = IMG.exec(String(b.data || ''));
      if (!m) return null;
      bytes += m[2].length;
      return {type: 'image', source: {type: 'base64', media_type: m[1], data: m[2]}};
    }
    return b?.type === 'text' && b.text ? {type: 'text', text: String(b.text).slice(0, 200000)} : null;
  }).filter(Boolean);
  if (bytes > 40e6) throw new Error('слишком большие картинки — уменьшите их');
  if (!blocks.some(b => b.type === 'text')) throw new Error('пустое задание');
  for (const [k, j] of jobs) if (Date.now() - j.at > 36e5) jobs.delete(k);
  const id = crypto.randomBytes(8).toString('hex');
  const job = {id, status: 'queued', at: Date.now(), model: MODELS.includes(model) ? model : 'opus'};
  jobs.set(id, job);
  queue = queue.then(() => work(job, sys, blocks)).then(() => keep(job, sys, blocks)).catch(() => {});
  return {id};
}

function work(job, sys, blocks) {
  job.status = 'running';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-write-')), sysFile = path.join(dir, 'system.txt');
  fs.writeFileSync(sysFile, sys || 'You are a helpful screenwriter.');
  return new Promise(resolve => {
    const done = patch => { Object.assign(job, patch); fs.rmSync(dir, {recursive: true, force: true}); resolve(); };
    // голый Claude: без инструментов, MCP, настроек, навыков и истории — только текст в ответ
    const p = spawn(claudeExe(), ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', job.model,
      '--system-prompt-file', sysFile, '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--disable-slash-commands'],
    {cwd: dir, windowsHide: true, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ANTHROPIC_(API_KEY|AUTH_TOKEN)$/.test(k)))});   // ключ API в окружении не тратим — только подписка
    let out = '', err = '';
    const kill = setTimeout(() => p.kill(), 15 * 60e3);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => { clearTimeout(kill); done({status: 'error', error: 'Claude Code не запустился: ' + e.message}); });
    p.on('close', code => {
      clearTimeout(kill);
      const res = out.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).find(j => j.type === 'result');
      if (res && !res.is_error && res.result) return done({status: 'done', text: res.result, cut: res.stop_reason === 'max_tokens'});
      const why = String(res?.result || err || out.slice(-600) || `код ${code}`).trim();
      done({status: 'error', error: /not logged in|login|authenticat|\/login/i.test(why) ? 'Claude Code не вошёл в аккаунт — откройте Claude на компьютере и войдите'
        : /usage limit|rate limit|limit reached|resets? at/i.test(why) ? 'лимит подписки Claude на сейчас исчерпан — подождите или выберите другой ИИ'
        : 'Claude Code: ' + why.slice(0, 400)});
    });
    p.stdin.end(JSON.stringify({type: 'user', message: {role: 'user', content: blocks}}) + '\n');
  });
}

export function writeGet(id) {
  const j = jobs.get(id);
  if (!j) return null;
  return {id, status: j.status, error: j.error || null, ...(j.status === 'done' ? {text: j.text, cut: !!j.cut, model: j.model} : {})};
}
