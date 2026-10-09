// Связь с телефоном по домашнему Wi-Fi — напрямую с компьютером, без посредников в интернете.
// Телефон открывает Freefield с этого компьютера по ссылке из QR-кода (в ссылке — секретный ключ) и отправляет
// сценарии; компьютер генерирует их через Flow / Arena / Dola и отдаёт готовые файлы обратно в галерею телефона.
// Без ключа сервер отдаёт только само приложение (его файлы и так публичны на GitHub Pages).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {ECHO, echoUp, echoLauncher, startEcho, ECHO_NOT_FOUND} from './echo.js';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.apk': 'application/vnd.android.package-archive',
  '.glb': 'model/gltf-binary', '.obj': 'model/obj', '.fbx': 'application/octet-stream', '.zip': 'application/zip'};
// фото из приложения (data URL, до ~15 МБ)
const photo = x => typeof x === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(x) && x.length < 21e6;

// Адреса компьютера в домашней сети (сначала обычные домашние 192.168.x.x)
export function lanAddresses() {
  const all = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  const rank = a => a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3;
  return all.filter(a => rank(a) < 3).sort((a, b) => rank(a) - rank(b));
}

// Сайт Freefield на GitHub Pages (там хранятся персонажи и галерея пользователя) — ему можно к программе с этого же компьютера:
// «Профили» на сайте показывают профили Chrome, генерация идёт отсюда (пользователь 2026-09-29: «в Профилях на сайте должны быть профили»).
// Остальным сайтам — нет: браузер не отдаст им ответ без этих заголовков.
const SITE = 'https://zuevilia808-collab.github.io';
const siteCors = req => req.headers.origin === SITE ? {'Access-Control-Allow-Origin': SITE, 'Vary': 'Origin', 'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Freefield-Key', 'Access-Control-Max-Age': '600'} : {};

// «Эхо» — озвучка голосом из видео (отдельная программа пользователя на этом компьютере, http://127.0.0.1:7865).
// Приложение ходит к нему через хаб с тем же ключом: /api/echo/api/... и /api/echo/files/... — так работает и на ПК, и с телефона по Wi-Fi
function proxyEcho(req, res, target, cors) {
  const headers = {};   // Origin/Referer/Cookie не передаём: для «Эхо» это запрос хаба, а не чужой страницы
  for (const h of ['content-type', 'content-length', 'range', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
  const up = http.request({...ECHO, method: req.method, path: target, headers, timeout: 10 * 60e3}, r => {
    const out = {...cors, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers[h]) out[h] = r.headers[h];
    res.writeHead(r.statusCode, out);
    r.pipe(res);
  });
  up.on('timeout', () => up.destroy(new Error('timeout')));
  up.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors});
    res.end(JSON.stringify({error: '«Эхо» не запущено', echo_down: true}));
  });
  req.pipe(up);
}

// Файлы приложения — новейшие с GitHub Pages: папка app на компьютере бывает старой, а страница должна быть всегда последней
// (пользователь 2026-09-29: «при „Открыть Freefield с компьютера“ — старая версия»). Скачанное кладём и в app — это запасная копия:
// нет интернета — отдаём её. FREEFIELD_APP_LOCAL=1 — только папка app (для проверки правок до публикации), FREEFIELD_PAGES — другой адрес сайта.
export const PAGES = process.env.FREEFIELD_PAGES || 'https://zuevilia808-collab.github.io/freefield/';
const LIVE = /^(index\.html|manifest\.json|sw\.js|(css|js)\/[\w.-]+\.(css|js)|(img|icons)\/[\w./-]+\.(png|webp|jpg|svg))$/;
const fresh = new Map();   // путь → {at, buf}
let offline = 0;   // GitHub не ответил — до этого времени берём папку app, не ждём сеть на каждом файле
async function latestApp(appDir, rel, log) {
  if (process.env.FREEFIELD_APP_LOCAL || !LIVE.test(rel)) return null;
  const c = fresh.get(rel);
  if (c && Date.now() - c.at < 60e3 || Date.now() < offline) return c?.buf || null;
  try {
    const r = await fetch(PAGES + rel + '?t=' + Date.now(), {cache: 'no-store', signal: AbortSignal.timeout(c ? 3000 : 6000)});
    if (r.status === 404) { fresh.set(rel, {at: Date.now(), buf: null}); return null; }   // нет на сайте — из папки app, если есть
    if (!r.ok) throw new Error('GitHub Pages: ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (rel === 'index.html' && !/<title>Freefield/.test(buf.toString('utf8', 0, 4096))) throw new Error('не та страница');
    fresh.set(rel, {at: Date.now(), buf});
    saveApp(appDir, rel, buf, log);
    return buf;
  } catch {
    offline = Date.now() + 30e3;
    return c?.buf || null;
  }
}
export function saveApp(appDir, rel, buf, log = () => {}) {
  try {
    const dst = path.join(appDir, rel);
    if (fs.existsSync(dst) && fs.readFileSync(dst).equals(buf)) return false;
    fs.mkdirSync(path.dirname(dst), {recursive: true});
    fs.writeFileSync(dst + '.new', buf);
    fs.renameSync(dst + '.new', dst);
    return true;
  } catch (e) { log('app:', rel, e.message); return false; }
}

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// key — строка или функция (ключ можно сменить на ходу); api: {hello(), submit(scenarios) → {id}, list() → batches, filePath(batchId, n, j) → путь или null}
export function startHub({port, host = '0.0.0.0', key, appDir, api, log = () => {}}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = url.pathname.startsWith('/api/') ? siteCors(req) : {};
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors});
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      // MCP-сервер Freefield по ссылке: http://<компьютер>:5180/mcp?k=<ключ> (ключ — тот же, что у приложения)
      if (url.pathname === '/mcp') {
        const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!same(url.searchParams.get('k') || req.headers['x-freefield-key'] || auth, typeof key === 'function' ? key() : key)) return send(403, {error: 'нет доступа — возьмите ссылку на MCP в приложении Freefield (🔌 MCP)'});
        // программы MCP заголовок Origin не шлют; запросы со страниц в браузере — только со своей страницы
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403, {error: 'запросы с чужих сайтов не принимаются'});
        if (!api.mcp) return send(503, {error: 'MCP по ссылке работает, когда Freefield запущен из Claude Desktop'});
        if (req.method !== 'POST') { res.writeHead(405, {Allow: 'POST'}); return res.end(); }
        return await api.mcp(req, res);
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'OPTIONS') { res.writeHead(cors['Access-Control-Allow-Origin'] ? 204 : 403, cors); return res.end(); }   // предзапрос браузера
        // приложение открыто на этом же компьютере (localhost / 127.0.0.1) — ключ отдаём ему сам, без QR-кода.
        // Только запросам с этого компьютера, по адресу localhost и со своей же страницы (не с чужих сайтов)
        if (url.pathname === '/api/local-key' && req.method === 'GET') {
          const loop = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');
          const host = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host || '');
          const own = req.headers.origin === SITE;   // сайт Freefield с GitHub в браузере этого же компьютера
          const origin = !req.headers.origin || req.headers.origin === `http://${req.headers.host}` || own;
          const site = !req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin' || own;
          if (!loop || !host || !origin || !site) return send(403, {error: 'ключ выдаётся только приложению на этом компьютере'});
          return send(200, {key: typeof key === 'function' ? key() : key});
        }
        if (!same(url.searchParams.get('k') || req.headers['x-freefield-key'] || '', typeof key === 'function' ? key() : key)) return send(403, {error: 'нет доступа — откройте Freefield по QR-коду с компьютера'});
        // «Эхо» не запущено — запустить (без окна; и с телефона); ответ сразу, готовность приложение проверяет само
        if (url.pathname === '/api/echo-start' && req.method === 'POST') {
          const up = await echoUp();
          if (up) return send(200, {ok: true, already: true, model: up.model});
          const file = echoLauncher();
          if (!file) return send(200, {ok: false, error: ECHO_NOT_FOUND});
          startEcho().then(r => log('«Эхо»:', r.ok ? 'запущено' : r.error));
          return send(200, {ok: true, starting: path.basename(file)});
        }
        // обновить программу из репозитория (GitHub, ветка main); новый код — после перезапуска программы
        if (url.pathname === '/api/update' && req.method === 'POST') {
          try {
            const {updateFromGithub} = await import('./update.js');
            return send(200, {ok: true, ...(await updateFromGithub({log}))});
          } catch (e) { return send(502, {error: 'не обновилось: ' + e.message}); }
        }
        const echo = url.pathname.match(/^\/api\/echo(\/(?:api|files)(?:\/[\w.-]+)+)$/);
        if (echo) {
          // путь уже нормализован (new URL убирает «..»); на всякий случай — без «.»/«..» в отрезках.
          // Чтение файлов по пути на диске — только для MCP на этом компьютере, не для телефона и не для сайта
          if (echo[1].split('/').some(x => x === '.' || x === '..')) return send(400, {error: 'плохой путь'});
          if (/^\/api\/(upload-path|voice-from-file)\b/i.test(echo[1])) return send(403, {error: 'недоступно через хаб'});
          const q = new URLSearchParams(url.search); q.delete('k');
          return proxyEcho(req, res, echo[1] + (q.toString() ? '?' + q : ''), cors);
        }
        if (url.pathname === '/api/hub' && req.method === 'GET') return send(200, await api.hello());
        if (url.pathname === '/api/batches' && req.method === 'GET') return send(200, await api.list());
        // номер профиля Chrome (1, 2, …) — у каждого свои аккаунты
        const prof = Math.max(1, Math.min(20, parseInt(url.searchParams.get('profile'), 10) || 1));
        if ((url.pathname === '/api/account' || url.pathname === '/api/login') && req.method === 'POST') {
          const site = url.searchParams.get('site');
          if (!['flow', 'arena', 'dola', 'vids'].includes(site)) return send(400, {error: 'неизвестный сервис'});
          const email = /^[^\s@/"'<>]{1,64}@[\w.-]{1,120}$/.test(url.searchParams.get('email') || '') ? url.searchParams.get('email') : null;   // какой аккаунт Google взять
          return send(200, await (url.pathname === '/api/account' ? api.switchAccount(site, prof) : api.openLogin(site, prof, email)));
        }
        if (url.pathname === '/api/status' && req.method === 'POST') return send(200, await api.status(url.searchParams.has('profile') ? prof : null));
        // «💳 Проверить баланс»: ?sites=flow,dola,vids,arena
        if (url.pathname === '/api/balance' && req.method === 'POST') {
          const sites = (url.searchParams.get('sites') || 'flow').split(',').filter(s => ['flow', 'dola', 'vids', 'arena'].includes(s));
          if (!api.balance) return send(503, {error: 'проверка баланса появится после перезапуска Claude Desktop'});
          return send(200, await api.balance(sites.length ? sites : ['flow']));
        }
        if (url.pathname === '/api/profile' && req.method === 'POST') return send(200, await api.newProfile());
        if (url.pathname === '/api/profile/open' && req.method === 'POST') return send(200, await api.openProfile(prof));
        if (url.pathname === '/api/profile/close' && req.method === 'POST') return send(200, await api.closeProfile(prof));
        if (url.pathname === '/api/profiles/all' && req.method === 'POST') return send(200, await api.openAll());
        if (url.pathname === '/api/profiles/close' && req.method === 'POST') return send(200, await api.closeAll());
        if (url.pathname === '/api/batch' && req.method === 'POST') {
          let body = '';
          for await (const chunk of req) { body += chunk; if (body.length > 40e6) return send(413, {error: 'слишком большое задание — уменьшите фото'}); }
          const {scenarios} = JSON.parse(body || '{}');
          // фото-референсы из приложения — компьютер сохранит их в outputs/refs
          const list = (Array.isArray(scenarios) ? scenarios : []).map(s => ({prompt: String(s.prompt || '').trim().slice(0, 2500),
            kind: s.kind === 'image' ? 'image' : 'video', service: ['auto', 'flow', 'arena', 'dola', 'vids'].includes(s.service) ? s.service : 'auto',
            aspect_ratio: ['16:9', '9:16', '1:1', '3:4', '4:3', '2:3', '21:9'].includes(s.aspect_ratio) ? s.aspect_ratio : undefined,
            seconds: [5, 8, 10].includes(+s.seconds) ? +s.seconds : undefined,
            count: [1, 2, 3, 4].includes(+s.count) ? +s.count : undefined,
            model: /^[a-z0-9.-]{2,30}$/.test(s.model || '') ? s.model : undefined,
            images: [...(Array.isArray(s.images) ? s.images : []), s.image].filter(photo).slice(0, 4),
            sheet: photo(s.sheet) ? s.sheet : undefined})).filter(s => s.prompt.length >= 3);   // развёртка героя — отдельно: только «ингредиент», не первый кадр
          if (!list.length || list.length > 10) return send(400, {error: 'нужно от 1 до 10 сценариев'});
          return send(200, await api.submit(list));
        }
        // «🧊 3D-модель» и «🔍 Увеличить» из галереи: картинка — data URL или имя файла, который сделал этот компьютер (pc_name)
        if ((url.pathname === '/api/3d' || url.pathname === '/api/upscale') && req.method === 'POST') {
          let body = '';
          for await (const chunk of req) { body += chunk; if (body.length > 90e6) return send(413, {error: 'слишком большие картинки — уменьшите их'}); }
          const j = JSON.parse(body || '{}');
          const pcPath = j.pc_name ? api.findOutput(String(j.pc_name)) : null;
          if (!pcPath && !photo(j.image)) return send(400, {error: 'нужна картинка (png, jpg, webp)'});
          const title = String(j.title || '').trim().slice(0, 300);
          if (url.pathname === '/api/upscale') return send(200, await api.upscale({image: j.image, pcPath, factor: +j.factor === 4 ? 4 : 2, title,
            aspect: /^\d+:\d+$/.test(j.aspect || '') ? j.aspect : undefined}));
          const views = Object.fromEntries(['back', 'left', 'right'].map(k => [k, j.views?.[k]]).filter(([, v]) => photo(v)));
          const pickOf = (v, list, d) => list.includes(v) ? v : d;
          return send(200, await api.make3d({image: j.image, pcPath, views, title,
            service: pickOf(j.service, ['auto', 'hunyuan', 'hf', 'tripo', 'meshy'], 'auto'), quality: pickOf(j.quality, ['standard', 'high', 'max'], 'high'),
            texture: j.texture !== false, pbr: j.pbr === true, format: pickOf(j.format, ['glb', 'obj', 'fbx'], 'glb')}));
        }
        // «🎙 Голос персонажа»: звук ролика → голос и фон отдельно (Demucs на этом компьютере); звук присылает приложение, не путь
        if (url.pathname === '/api/split' && req.method === 'POST' && api.splitStart) {
          let body = '';
          for await (const chunk of req) { body += chunk; if (body.length > 60e6) return send(413, {error: 'слишком длинный звук'}); }
          try { return send(200, await api.splitStart(JSON.parse(body || '{}').audio)); } catch (e) { return send(400, {error: e.message}); }
        }
        const sp = url.pathname.match(/^\/api\/split\/([0-9a-f]{16})(?:\/(voice|rest)\.wav)?$/);
        if (sp && req.method === 'GET' && api.splitGet) {
          if (!sp[2]) { const j = await api.splitGet(sp[1]); return j ? send(200, j) : send(404, {error: 'нет такого задания — программу перезапускали?'}); }
          const file = await api.splitFile(sp[1], sp[2]);
          if (!file || !fs.existsSync(file)) return send(404, {error: 'файл не найден'});
          res.writeHead(200, {'Content-Type': 'audio/wav', 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'no-store', ...cors});
          return fs.createReadStream(file).pipe(res);
        }
        if (url.pathname === '/api/outputs' && req.method === 'GET') return send(200, await api.outputs());
        if (url.pathname === '/api/sync' && req.method === 'POST') return send(200, await api.sync());
        const m = url.pathname.match(/^\/api\/file\/([\w-]+)\/(\d+)\/(\d+)$/);
        const o = url.pathname.match(/^\/api\/out\/(\d{4}-\d{2}-\d{2})\/([^/]+)$/);
        if ((m || o) && req.method === 'GET') {
          const file = m ? await api.filePath(m[1], +m[2], +m[3]) : await api.outPath(o[1], decodeURIComponent(o[2]));
          if (!file || !fs.existsSync(file)) return send(404, {error: 'файл не найден'});
          res.writeHead(200, {'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Content-Length': fs.statSync(file).size, 'Cache-Control': 'no-store', ...cors});
          return fs.createReadStream(file).pipe(res);
        }
        return send(404, {error: 'нет такого запроса'});
      }
      // само приложение
      const rel = decodeURIComponent(url.pathname) === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(appDir, rel);
      // скрытые файлы и папки (.git и т. п.) не отдаём никому — только файлы самого приложения
      const hidden = path.relative(path.resolve(appDir), file).split(path.sep).some(p => p.startsWith('.'));
      if (hidden || !file.startsWith(path.resolve(appDir) + path.sep)) return send(404, 'Not found', 'text/plain');
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const buf = req.method === 'GET' ? await latestApp(appDir, path.relative(path.resolve(appDir), file).split(path.sep).join('/'), log) : null;
      if (buf) { res.writeHead(200, {'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-cache'}); return res.end(buf); }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'Not found', 'text/plain');
      res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-cache'});
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      log('hub:', e.message);
      if (!res.headersSent) send(500, {error: e.message});
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server); });
  });
}
