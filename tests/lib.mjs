// Общее для проверок: сервер страницы, браузер, учёт ошибок и итог (код выхода 1, если что-то не так)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const PC = {viewport: {width: 1440, height: 900}};
export const PHONE = {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true};

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg'};
// страница из папки репозитория — как на GitHub Pages
export function serveStatic(root = ROOT) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close()})));
}

// короткий WAV (тон) — образец голоса и озвучка в макете «Эхо»
export function wav(sec = 4, hz = 220) {
  const rate = 16000, n = Math.round(sec * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 9000), 44 + i * 2);
  return b;
}
export function tmpFile(name, buf) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-test-')), name);
  fs.writeFileSync(f, buf);
  return f;
}

// набор проверок: t.ok(условие, что проверяем, подробности); ошибки страницы собираются сами
export async function suite(name, run) {
  const fails = [], errors = [];
  let n = 0;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
  const t = {
    ok(cond, what, detail = '') { n++; if (!cond) fails.push(`${what}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); return !!cond; },
    // окно браузера: внешние сервисы не трогаем, service worker выключен
    async page(dev, label = '') {
      const ctx = await browser.newContext({...dev, serviceWorkers: 'block'});
      await ctx.route(/github\.io|googleapis\.com\/v1|generativelanguage|anthropic\.com|mymemory|hf\.space|huggingface/, r => r.abort());
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push(`${label}: ${e.message}`));
      p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
      return p;
    },
    // окно выбора файла по нажатию
    async choose(p, sel, files) {
      const [fc] = await Promise.all([p.waitForEvent('filechooser', {timeout: 5000}).catch(() => null), p.locator(sel).first().click()]);
      if (fc) { await fc.setFiles(files); await sleep(600); }
      return fc;
    },
    browser,
  };
  try { await run(t); } catch (e) { fails.push('упало: ' + (e.stack || e.message)); }
  await browser.close();
  t.ok(!errors.length, 'ошибок на странице нет', errors.join('\n'));
  console.log(fails.length ? `✗ ${name}: ${fails.length} из ${n}\n  - ${fails.join('\n  - ')}` : `✓ ${name}: ${n} проверок`);
  if (fails.length) process.exitCode = 1;
}
