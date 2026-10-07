// Картинка → 3D-модель (инструмент image_to_3d) на бесплатных лимитах, под аккаунтами пользователя:
//  • hunyuan — официальный сайт Hunyuan 3D (международная версия 3d.hunyuanglobal.com): 20 бесплатных генераций в день;
//  • tripo — Tripo Studio: бесплатные кредиты каждый месяц (≈ 300);
//  • meshy — Meshy: 100 бесплатных кредитов в месяц, на бесплатном тарифе — до 10 скачиваний в месяц;
//  • hf — Spaces на Hugging Face: microsoft/TRELLIS.2 и tencent/Hunyuan3D-2.1 (мультивью — tencent/Hunyuan3D-2mv)
//    на дневной квоте ZeroGPU аккаунта пользователя (бесплатный аккаунт — 3,5 мин GPU в день, это 1–3 модели).
// Данные проверены по открытым источникам в октябре 2026 — сервисы меняют лимиты. Сайты Freefield проходит в окне Chrome
// Freefield как человек: если нужен вход или проверка «я не робот» — останавливается и просит пользователя.
// Платные кредиты не тратит без allow_paid: свой счётчик бесплатных генераций за день/месяц + остаток, который пишет сайт.
import fs from 'node:fs';
import path from 'node:path';
import {profilePages, newProfilePage, leaseProfile, humanCheck, downloadCapture} from './bridge.js';
import {readAcct, writeAcct, currentProfile} from './state.js';
import {ui, PortalError} from './portals.js';
import {openSpace, HfError, lastQuota, zeroGpuDaily, whoamiToken} from './gradio.js';
import {hfToken, hfTokenSource, blenderPath, scrub} from './config.js';
import {fileInfo, glbStats, glbToObj, findBlender, blenderConvert, imageSize, mimeOf} from './media.js';
import {inflateRawSync} from 'node:zlib';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('sv');
const month = () => today().slice(0, 7);

export const SERVICES_3D = {
  hunyuan: {name: 'Hunyuan 3D', kind: 'web', home: 'https://3d.hunyuanglobal.com/', match: 'hunyuanglobal.com',
    free: {n: 20, per: 'day', unit: 'генераций', perGen: 1}, multiview: true},
  tripo: {name: 'Tripo', kind: 'web', home: 'https://studio.tripo3d.ai/', match: 'tripo3d.ai',
    free: {n: 300, per: 'month', unit: 'кредитов', perGen: 30}, multiview: true},
  meshy: {name: 'Meshy', kind: 'web', home: 'https://www.meshy.ai/workspace/image-to-3d', match: 'meshy.ai',
    free: {n: 100, per: 'month', unit: 'кредитов', perGen: 20, downloads: 10}, multiview: true},
  hf: {name: 'Hugging Face Spaces', kind: 'hf', home: 'https://huggingface.co/', match: 'huggingface.co',
    spaces: {trellis: 'microsoft/TRELLIS.2', hunyuan: 'tencent/Hunyuan3D-2.1', hunyuanMv: 'tencent/Hunyuan3D-2mv'}},
};
const NAME = s => SERVICES_3D[s]?.name || s;

// ---- учёт бесплатного: свой счётчик (сайты считают по-своему) ----
const periodOf = svc => SERVICES_3D[svc].free?.per === 'day' ? today() : month();
function usage3d(svc) {
  const u = readAcct().usage3d?.[svc];
  return u?.period === periodOf(svc) ? u : {period: periodOf(svc), used: 0, downloads: 0};
}
function track3d(svc, add) {
  const u = usage3d(svc);
  for (const [k, v] of Object.entries(add)) u[k] = (u[k] || 0) + v;
  writeAcct({usage3d: {...readAcct().usage3d, [svc]: u}});
}
const noteSite = (svc, patch) => writeAcct({site3d: {...readAcct().site3d, [svc]: {...readAcct().site3d?.[svc], ...patch, at: Date.now()}}});
// Остаток бесплатного — что известно: со страницы сайта (если читали сегодня/в этом месяце) или по своему счётчику
export function freeLeft(svc) {
  const S = SERVICES_3D[svc];
  if (svc === 'hf') {
    const q = lastQuota(), pro = !!readAcct().site3d?.hf?.pro, daily = zeroGpuDaily(pro);
    const fresh = q && q.at > Date.now() - 24 * 3600e3 && !(q.resetAt && q.resetAt < Date.now());
    const sec = fresh && q.left != null ? q.left : null;
    return {service: 'hf', quota: `ZeroGPU ${pro ? 'PRO' : 'бесплатный аккаунт'}: ${Math.round(daily / 60 * 10) / 10} мин GPU в день`,
      seconds_left: sec, generations_left_estimate: sec != null ? Math.floor(sec / 60) : Math.floor(daily / 60),
      note: sec != null ? `по последнему ответу Space (${new Date(q.at).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'})})` : 'оценка: одна модель ≈ 60 с GPU'};
  }
  const u = usage3d(svc), site = readAcct().site3d?.[svc];
  const fromSite = site?.left != null && site.period === periodOf(svc) ? site.left : null;
  const byCounter = Math.max(0, S.free.n - u.used);
  const left = fromSite ?? byCounter;
  return {service: svc, unit: S.free.unit, per: S.free.per === 'day' ? 'день' : 'месяц', free_total: S.free.n, left,
    generations_left_estimate: Math.floor(left / (S.free.perGen || 1)), source: fromSite != null ? 'сайт' : 'счётчик Freefield',
    ...(S.free.downloads ? {downloads_left: Math.max(0, S.free.downloads - (u.downloads || 0))} : {})};
}

// ---- вкладки в окне профиля Chrome Freefield ----
async function profileTab(url, match, front = true, fresh = false) {
  const pages = await profilePages();
  let page = pages.find(p => p.url().includes(match) && !/accounts\.google/.test(p.url()));
  if (!page) {
    page = pages.find(p => /^(about:blank|chrome:\/\/new-?tab)/.test(p.url())) || await newProfilePage();
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 90000});
    await sleep(2500);
  } else if (fresh || !page.url().startsWith(url.replace(/\/$/, ''))) {
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 90000}).catch(() => {});
    await sleep(2500);
  }
  if (front) { await page.bringToFront().catch(() => {}); await sleep(800); }
  return page;
}

// ============================== Hugging Face Spaces ==============================
// Окно Space в Chrome (вход пользователя) → фрейм *.hf.space, где выполняются запросы
export async function hfFrame(space, onStatus = () => {}) {
  const page = await ui(() => profileTab(`https://huggingface.co/spaces/${space}`, `huggingface.co/spaces/${space}`, false));
  const who = await page.evaluate(async () => {
    const r = await fetch('/api/whoami-v2', {credentials: 'include'}).catch(() => null);
    if (!r?.ok) return {ok: false, status: r?.status || 0};
    const j = await r.json().catch(() => ({}));
    return {ok: true, name: j.name || null, pro: !!(j.isPro || j.plan?.type === 'pro')};
  }).catch(() => ({ok: false, status: 0}));
  noteSite('hf', {login: who.ok, name: who.name || null, pro: !!who.pro});
  if (!who.ok) throw new HfError('Нужно войти в Hugging Face: окно Chrome Freefield открыто на huggingface.co — войдите в свой аккаунт (или впишите токен в config.json Freefield) и повторите', 'login');
  if ((await humanCheck(page)) === 'captcha') throw new HfError('Hugging Face просит пройти проверку «я не робот» — пройдите её в окне Chrome Freefield и повторите', 'captcha');
  for (let i = 0; i < 150; i++) {
    const f = page.frames().find(f => /\.hf\.space/.test(f.url()));
    if (f && await f.evaluate(() => !!document.querySelector('gradio-app, .gradio-container, #root')).catch(() => false)) return {page, frame: f, who};
    if (i % 5 === 0) onStatus(`жду, пока Space ${space} откроется`);
    if (i === 60) await page.reload({waitUntil: 'domcontentloaded'}).catch(() => {});
    await sleep(2000);
  }
  throw new HfError(`Space ${space} не открылся в окне Chrome Freefield за 5 минут`, 'down');
}
// Сессия Space: с токеном из config.json — напрямую, без токена — через окно Chrome со входом пользователя
export async function hfSession(space, onStatus = () => {}) {
  if (hfToken(currentProfile())) {
    const who = readAcct().site3d?.hf;
    if (!who?.name || Date.now() - (who.at || 0) > 6 * 3600e3) {
      const w = await whoamiToken(hfToken(currentProfile()));
      if (w.ok === false) throw new HfError(`токен Hugging Face из ${hfTokenSource(currentProfile())} не подошёл: ${w.error}`, 'auth');
      if (w.ok) noteSite('hf', {login: true, name: w.name, pro: w.pro, via: 'token'});
    }
    return openSpace({space, onStatus});
  }
  const {frame} = await hfFrame(space, onStatus);
  return openSpace({space, frame, onStatus});
}

const choiceValues = c => (c?.props?.choices || []).map(x => Array.isArray(x) ? x[1] : x);
const compByLabel = (sp, re) => (sp.cfg.components || []).find(c => re.test(String(c.props?.label || '')));
const clampTo = (sp, re, v) => { const c = compByLabel(sp, re); const max = c?.props?.maximum; return max != null ? Math.min(v, max) : v; };
const isFile = v => v && typeof v === 'object' && (v.path || v.url);

async function trellis2(sp, input, {quality}, onStatus) {
  const Q = {standard: {res: '1024', dec: 300000, tex: 2048}, high: {res: '1536', dec: 500000, tex: 2048}, max: {res: '1536', dec: 1000000, tex: 4096}}[quality];
  const resChoices = choiceValues(compByLabel(sp, /^resolution$/i)).map(String);
  const res = resChoices.length && !resChoices.includes(Q.res) ? resChoices.sort((a, b) => b - a)[0] : Q.res;
  const start = sp.find('start_session');
  if (start && !(start.inputs || []).length) await sp.call(start, {}, {timeoutMs: 60000}).catch(() => {});
  const img = await sp.upload(input.buf, input.name, input.mime);
  let ready = img;
  const pre = sp.find('preprocess_image');
  if (pre) { const [out] = await sp.call(pre, {'image prompt': img}, {status: 'TRELLIS.2 убирает фон'}); if (isFile(out)) ready = out; }
  const gen = sp.find('image_to_3d') || sp.byButton(/^generate$/i);
  await sp.call(gen, {'image prompt': ready, seed: Math.floor(Math.random() * 2147483647), resolution: res, 'randomize seed': false}, {status: `TRELLIS.2 строит модель (${res})`});
  const ext = sp.find('extract_glb') || sp.byButton(/extract glb/i);
  const out = await sp.call(ext, {'decimation target': clampTo(sp, /decimation/i, Q.dec), 'texture size': clampTo(sp, /texture size/i, Q.tex)}, {status: 'TRELLIS.2 собирает GLB с текстурами'});
  const glb = out.find(v => isFile(v) && /\.glb/i.test(v.path || v.url || v.orig_name || '')) || out.find(isFile);
  if (!glb) throw new HfError('TRELLIS.2 не вернул GLB', 'busy');
  return {buf: await sp.fetchFile(sp.fileUrl(glb)), ext: 'glb', model: `TRELLIS.2 (${res}, до ${clampTo(sp, /decimation/i, Q.dec)} граней, текстуры ${clampTo(sp, /texture size/i, Q.tex)})`, pbr: true, textured: true};
}

async function hunyuan21(sp, inputs, {quality, texture}, onStatus) {
  const Q = {standard: {steps: 30, oct: 256, chunks: 8000}, high: {steps: 50, oct: 384, chunks: 20000}, max: {steps: 50, oct: 512, chunks: 40000}}[quality];
  const set = {'inference steps': Q.steps, 'octree resolution': clampTo(sp, /octree/i, Q.oct), 'number of chunks': Q.chunks, 'remove background': true, 'randomize seed': true, 'guidance scale': 5};
  for (const [k, im] of Object.entries(inputs)) set[k === 'single' ? 'image' : k] = await sp.upload(im.buf, im.name, im.mime);
  const dep = texture ? (sp.find('generation_all') || sp.byButton(/textured/i)) : (sp.find('shape_generation') || sp.byButton(/gen shape/i));
  let useTex = texture && !!dep;
  const run = useTex ? dep : (sp.find('shape_generation') || sp.byButton(/gen shape/i));
  const out = await sp.call(run, set, {status: `Hunyuan3D строит ${useTex ? 'модель с текстурой' : 'форму'}`});
  const files = out.filter(isFile);
  const pick = useTex ? (files.find(f => /textured.*\.glb|\.glb/i.test(f.path || f.url || '') && files.indexOf(f) > 0) || files[1] || files[0]) : files[0];
  if (!pick) throw new HfError('Hunyuan3D не вернул модель', 'busy');
  const stats = out.find(v => v && typeof v === 'object' && 'number_of_faces' in v);
  const ext = (pick.path || pick.url || '').match(/\.(glb|obj|ply|stl)(\?|$)/i)?.[1]?.toLowerCase() || 'glb';
  return {buf: await sp.fetchFile(sp.fileUrl(pick)), ext, model: `${sp.space.split('/')[1]} (octree ${set['octree resolution']}, ${Q.steps} шагов${useTex ? ', PBR-текстура' : ', без текстуры'})`,
    pbr: useTex, textured: useTex, faces_before_reduce: stats?.number_of_faces ?? null};
}

async function hfRun({input, views, quality, texture, onStatus}) {
  const S = SERVICES_3D.hf.spaces, warnings = [];
  if (views) {
    const sp = await hfSession(S.hunyuanMv, onStatus);
    const r = await hunyuan21(sp, views, {quality, texture}, onStatus);
    if (texture && !r.textured) warnings.push('Hunyuan3D-2mv сделал форму без текстуры (в этом Space нет текстурирования)');
    return {...r, space: S.hunyuanMv, mode: sp.mode, warnings};
  }
  // с текстурой — сначала TRELLIS.2 (PBR), без текстуры — Hunyuan3D-2.1 (форма в полном разрешении)
  const order = texture ? ['trellis', 'hunyuan'] : ['hunyuan', 'trellis'];
  let last = null;
  for (const k of order) {
    try {
      const sp = await hfSession(S[k], onStatus);
      const r = k === 'trellis' ? await trellis2(sp, input, {quality}, onStatus) : await hunyuan21(sp, {single: input}, {quality, texture}, onStatus);
      if (!texture && r.textured) warnings.push('TRELLIS.2 всегда делает модель с текстурой');
      return {...r, space: S[k], mode: sp.mode, warnings};
    } catch (e) {
      last = e;
      if (e.kind === 'login' || e.kind === 'auth' || e.kind === 'captcha') throw e;
      onStatus(`${S[k]}: ${e.message} → пробую другой Space`);
    }
  }
  throw last;
}

// ============================== сайты: Hunyuan 3D, Tripo, Meshy ==============================
// Интерфейсы сайтов меняются, поэтому Freefield ищет элементы по смыслу (подписи на английском, китайском и русском),
// а результат забирает кнопкой сайта «Скачать/Экспорт» — тем, что сайт разрешает бесплатному аккаунту.
const RX = {
  login: /^(log ?in|sign ?in|sign ?up|войти|регистрация|登录|注册|登入)$/i,
  imageMode: /^(image to 3d|image-to-3d|image|图生3d|图片生成3d|图生模型|изображение в 3d)$/i,
  multiview: /multi-?view|multi-?image|多视图|多图|несколько (видов|ракурсов)|мультивью/i,
  generate: /^(generate|generate model|create|create model|start|生成|开始生成|立即生成|сгенерировать|создать)\b/i,
  download: /^(download|export|下载|导出|скачать|экспорт)\b/i,
  texture: /^(texture|textur(ed|ing)|纹理|贴图|текстур)/i,
  pbr: /\bPBR\b/i,
  error: /(error|failed|failure|失败|错误|ошибк|не удалось)/i,
  noMoney: /(insufficient|not enough|out of credits|no credits|余额不足|积分不足|次数不足|次数已用完|недостаточно|закончил|upgrade to|subscribe)/i,
  balance: /(\d[\d,.]*)\s*(credits?|积分|кредит\S*)/i,
  hunyuanLeft: /(?:剩余|remaining|left)[^\d]{0,16}(\d+)|(\d+)\s*(?:次|generations?|times?)\s*(?:left|remaining|剩余)/i,
  viewLabel: {front: /front|正面|спереди|перед/i, back: /back|背面|сзади|зад/i, left: /left|左|слева|лев/i, right: /right|右|справа|прав/i},
};
const visibleText = page => page.evaluate(() => document.body?.innerText || '').catch(() => '');
// кнопка (или ссылка, или вкладка) с подписью, подходящей под re — первая видимая
async function findButton(page, re, {enabled = false} = {}) {
  const loc = page.locator('button, [role="button"], a, [role="tab"], [role="menuitem"], [role="option"], label');
  const n = Math.min(await loc.count().catch(() => 0), 400);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    const text = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 60 || !re.test(text)) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    if (enabled && !(await el.isEnabled().catch(() => true))) continue;
    return {el, text};
  }
  return null;
}
// сколько видимых кнопок с такой подписью (кнопки «Скачать» у старых моделей в истории не должны сойти за новую)
async function countButtons(page, re) {
  return page.evaluate(src => {
    const re = new RegExp(src, 'i');
    return [...document.querySelectorAll('button, [role="button"], a')].filter(e => e.getClientRects().length && re.test((e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())).length;
  }, re.source).catch(() => 0);
}
async function setSwitch(page, re, on) {
  const loc = page.locator('[role="switch"], input[type="checkbox"], [role="checkbox"]');
  const n = Math.min(await loc.count().catch(() => 0), 60);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    const label = await el.evaluate(e => {
      const own = e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${e.id}"]`)?.innerText) || '';
      let p = e, t = own;
      for (let k = 0; k < 3 && !t && p; k++) { p = p.parentElement; t = (p?.innerText || '').trim().slice(0, 60); }
      return t;
    }).catch(() => '');
    if (!re.test(label)) continue;
    const checked = await el.evaluate(e => e.getAttribute('aria-checked') === 'true' || !!e.checked).catch(() => null);
    if (checked !== on) await el.click({force: true}).catch(() => {});
    return true;
  }
  return false;
}

async function webReady(page, svc) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(1200);
  const h = await humanCheck(page);
  const loginBtn = await findButton(page, RX.login);
  const loggedOut = h === 'login' || !!loginBtn;
  noteSite(svc, {login: !loggedOut});
  if (loggedOut) throw new PortalError(`Нужно войти в ${NAME(svc)}: окно Chrome Freefield открыто — войдите в свой аккаунт и повторите.`, 'login');
  if (h === 'captcha') throw new PortalError(`${NAME(svc)} просит пройти проверку «я не робот» — пройдите её в окне Chrome Freefield и повторите.`, 'captcha');
}
// остаток на сайте — что он сам пишет (кредиты / «осталось N»)
async function readLeft(page, svc) {
  const text = await visibleText(page);
  const m = svc === 'hunyuan' ? text.match(RX.hunyuanLeft) : text.match(RX.balance);
  const v = m ? +String(m[1] || m[2]).replace(/[,\s]/g, '') : null;
  if (v != null && Number.isFinite(v)) noteSite(svc, {left: v, period: periodOf(svc)});
  return v;
}

async function webRun(svc, {input, views, quality, texture, pbr, format, allowPaid, outDir, onStatus}) {
  const S = SERVICES_3D[svc];
  const warnings = [], applied = {};
  // бесплатное кончилось по своему счётчику — без allow_paid не начинаем
  const u = usage3d(svc);
  if (!allowPaid && u.used + S.free.perGen > S.free.n)
    throw new PortalError(`${S.name}: бесплатный лимит на ${S.free.per === 'day' ? 'сегодня' : 'этот месяц'} израсходован (по счётчику Freefield ${u.used} из ${S.free.n} ${S.free.unit}). ` +
      `Дальше генерация тратит платные кредиты — только с allow_paid=true`, 'quota');
  if (S.free.downloads && !allowPaid && (u.downloads || 0) >= S.free.downloads)
    throw new PortalError(`${S.name}: бесплатные скачивания на этот месяц закончились (${S.free.downloads})`, 'quota');

  // каждый раз — заново со стартовой страницы сервиса (без остатков прошлой генерации)
  const page = await ui(async () => { const p = await profileTab(S.home, S.match, true, true); await webReady(p, svc); return p; });
  const leftBefore = await readLeft(page, svc);
  let genBtnText = '', genCost = null, dlBefore = 0;
  const modelUrls = [];
  const onResp = r => { const url = r.url(); if (/\.(glb|fbx|obj|zip)(\?|$)/i.test(url) || /model\/gltf/.test(r.headers()['content-type'] || '')) modelUrls.push({url, at: Date.now()}); };
  page.on('response', onResp);
  try {
    await ui(async () => {
      await page.bringToFront().catch(() => {});
      // режим «картинка → 3D» и мультивью, если сайт их показывает отдельными вкладками
      const mode = await findButton(page, RX.imageMode);
      if (mode) { await mode.el.click().catch(() => {}); await sleep(1200); }
      if (views) {
        const mv = await findButton(page, RX.multiview);
        if (mv) { await mv.el.click().catch(() => {}); await sleep(1200); applied.multiview = true; }
        else { warnings.push(`${S.name}: не нашёл режим мультивью — отправлен только вид спереди`); }
      }
      // загрузка: поле выбора файла (обычно скрыто за областью «перетащите сюда»)
      const files = page.locator('input[type="file"]');
      const n = await files.count().catch(() => 0);
      const list = views && applied.multiview ? Object.entries(views) : [['front', input]];
      if (!n) {
        const up = await findButton(page, /upload|загрузить|上传|选择图片|browse/i);
        if (!up) throw new PortalError(`${S.name}: не нашёл, куда загрузить картинку — сайт изменил интерфейс. Посмотрите в окно Chrome Freefield.`, 'ui');
        const fc = page.waitForEvent('filechooser', {timeout: 10000});
        await up.el.click();
        await (await fc).setFiles(list.map(([, v]) => v.path));
      } else if (list.length > 1 && n >= list.length) {
        // мультивью: каждое поле — у своей подписи (Front/Back/Left/Right), иначе по порядку
        const used = new Set();
        for (const [k, v] of list) {
          let idx = -1;
          for (let i = 0; i < n && idx < 0; i++) {
            if (used.has(i)) continue;
            const near = await files.nth(i).evaluate(e => { let p = e, t = ''; for (let k = 0; k < 4 && p; k++) { p = p.parentElement; t = p?.innerText || ''; if (t.trim()) break; } return t.slice(0, 80); }).catch(() => '');
            if (RX.viewLabel[k]?.test(near)) idx = i;
          }
          if (idx < 0) idx = [...Array(n).keys()].find(i => !used.has(i));
          used.add(idx);
          await files.nth(idx).setInputFiles(v.path);
          await sleep(1500);
        }
      } else {
        const multiple = await files.first().evaluate(e => e.multiple).catch(() => false);
        await files.first().setInputFiles(multiple ? list.map(([, v]) => v.path) : list[0][1].path);
      }
      onStatus(`${S.name}: картинка загружена`);
      await sleep(4000);
      // настройки, если сайт их показывает: текстура, PBR; остальное — по умолчанию сайта
      applied.texture = await setSwitch(page, RX.texture, texture) ? texture : 'по умолчанию сайта';
      applied.pbr = await setSwitch(page, RX.pbr, pbr) ? pbr : 'по умолчанию сайта';
      if (quality !== 'standard') {
        const q = await findButton(page, quality === 'max' ? /^(ultra|max|maximum|highest|最高|超高|высок\S*|макс\S*)$/i : /^(high|hd|高|высок\S*)$/i);
        if (q && !/pro|upgrade|lock|vip|会员/i.test(q.text)) { await q.el.click().catch(() => {}); applied.quality = q.text; } else applied.quality = 'по умолчанию сайта';
      }
      // цена на кнопке генерации («Generate 30», «生成 · 20 积分») и остаток
      const gen = await findButton(page, RX.generate, {enabled: true});
      if (!gen) return;   // кнопки нет — ниже попросим нажать самого пользователя
      genBtnText = gen.text;
      const cost = +(gen.text.match(/(\d+)/)?.[1] || 0) || null;
      if (cost != null && leftBefore != null && cost > leftBefore && !allowPaid)
        throw new PortalError(`${S.name}: генерация стоит ${cost} ${S.free.unit}, а осталось ${leftBefore} — без allow_paid=true не запускаю`, 'quota');
      if (cost != null && !allowPaid && u.used + cost > S.free.n)
        throw new PortalError(`${S.name}: генерация стоит ${cost} ${S.free.unit} — это больше бесплатного остатка (${S.free.n - u.used}). allow_paid=true — тратить платные`, 'quota');
      genCost = cost;
      dlBefore = await countButtons(page, RX.download);
      await gen.el.click();
      onStatus(`${S.name}: генерация запущена${cost ? ` (${cost} ${S.free.unit})` : ''}`);
    });
    if (!genBtnText) dlBefore = await countButtons(page, RX.download);
    if (!genBtnText) onStatus(`${S.name}: не нашёл кнопку генерации — нажмите её сами в окне Chrome Freefield, дальше Freefield продолжит`);

    // ждём: кнопка «Скачать/Экспорт» появилась, или модель пришла в просмотрщик, или ошибка сайта
    const startAt = Date.now();
    let dl = null;
    for (;;) {
      if (Date.now() - startAt > (genBtnText ? 15 : 8) * 60e3) throw new PortalError(`${S.name}: модель не готова за ${genBtnText ? 15 : 8} минут — посмотрите в окно Chrome Freefield`, 'busy');
      await sleep(4000);
      const h = await humanCheck(page);
      if (h === 'captcha') throw new PortalError(`${S.name} просит пройти проверку «я не робот» — пройдите её в окне Chrome Freefield и повторите.`, 'captcha');
      const toast = await page.evaluate(() => [...document.querySelectorAll('[role="alert"], [role="status"], [class*="toast"], [class*="message"], [class*="notice"]')]
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(t => t && t.length < 200).pop() || '').catch(() => '');
      if (RX.noMoney.test(toast)) throw new PortalError(`${S.name}: «${toast}» — бесплатное закончилось; платные кредиты Freefield без allow_paid=true не тратит`, 'quota');
      if (RX.error.test(toast) && !/\d\s?%/.test(toast)) throw new PortalError(`${S.name}: «${toast}»`, 'busy');
      const text = await visibleText(page);
      const pct = text.match(/(\d{1,3})\s?%/)?.[1];
      // готово: модель пришла в просмотрщик сайта или появилась новая кнопка «Скачать»
      const viewerGotModel = modelUrls.some(m => m.at > startAt);
      const nNow = await countButtons(page, RX.download);
      if (!pct && (viewerGotModel || nNow > dlBefore)) {
        dl = await ui(() => findButton(page, RX.download, {enabled: true}));
        if (dl) break;
      }
      onStatus(`${S.name}: генерация${pct ? ` ${pct}%` : ''} (${Math.round((Date.now() - startAt) / 1000)} с)`);
    }
    track3d(svc, {used: genCost ?? S.free.perGen});

    // скачивание: кнопка сайта → (если есть) выбор формата → файл перехватываем
    onStatus(`${S.name}: скачиваю ${format.toUpperCase()}`);
    const cap = await downloadCapture(page, path.join(outDir, '.download'));
    let file = null, gotFormat = null;
    try {
      await ui(async () => {
        await page.bringToFront().catch(() => {});
        await dl.el.click();
        await sleep(1500);
        if (cap.started()) return;
        // меню или окно выбора формата: нужный формат, если он не платный; иначе GLB (переведём сами)
        for (const f of [format, 'glb']) {
          const opt = await findButton(page, new RegExp(`^\\.?${f}\\b`, 'i'));
          if (!opt || /pro|vip|upgrade|lock|会员|подписк/i.test(opt.text)) continue;
          await opt.el.click().catch(() => {});
          gotFormat = f;
          await sleep(1200);
          break;
        }
        if (!cap.started()) {
          const ok = await findButton(page, /^(download|export|confirm|ok|确定|下载|导出|скачать|экспорт|подтвердить)\b/i, {enabled: true});
          if (ok) await ok.el.click().catch(() => {});
        }
      });
      file = await cap.wait(180000);
    } finally { await cap.stop(); }
    if (!file) throw new PortalError(`${S.name}: сайт не отдал файл модели — скачайте вручную в окне Chrome Freefield`, 'busy');
    track3d(svc, {downloads: 1});
    await readLeft(page, svc).catch(() => null);
    const ext = (path.extname(file.name || '').slice(1) || gotFormat || 'glb').toLowerCase();
    return {path: file.path, name: file.name, ext, model: S.name, applied, warnings, pbr: applied.pbr === true, textured: applied.texture !== false};
  } finally { page.off('response', onResp); }
}

// ============================== общий запуск ==============================
// zip → папка (без внешних библиотек: deflate/stored)
function unzipTo(buf, dir) {
  const out = [];
  let eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('повреждённый zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const safe = name.split(/[\\/]/).filter(s => s && s !== '..').join(path.sep);
    const lnl = buf.readUInt16LE(local + 26), lxl = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lnl + lxl, local + 30 + lnl + lxl + csize);
    const f = path.join(dir, safe);
    fs.mkdirSync(path.dirname(f), {recursive: true});
    fs.writeFileSync(f, method === 8 ? inflateRawSync(data) : data);
    out.push(f);
  }
  return out;
}
const MODEL_EXT = ['glb', 'gltf', 'fbx', 'obj', 'ply', 'stl'];
const listFiles = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(d => d.name.startsWith('.') ? [] : d.isDirectory() ? listFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]);

// Привести результат к нужному формату и описать файлы для агента
async function finishModel(outDir, got, format, warnings) {
  fs.mkdirSync(outDir, {recursive: true});
  let main;
  if (got.buf) { main = path.join(outDir, `model.${got.ext}`); fs.writeFileSync(main, got.buf); }
  else if (got.ext === 'zip') { unzipTo(fs.readFileSync(got.path), outDir); fs.rmSync(got.path, {force: true}); }
  else { main = path.join(outDir, `model.${got.ext}`); fs.renameSync(got.path, main); }
  fs.rmSync(path.join(outDir, '.download'), {recursive: true, force: true});
  const all = () => listFiles(outDir);
  const byExt = e => all().find(f => path.extname(f).slice(1).toLowerCase() === e);
  main ||= MODEL_EXT.map(byExt).find(Boolean);
  if (!main) throw new Error('в скачанном архиве нет файла модели');
  const glb = byExt('glb');
  let error = null;
  if (path.extname(main).slice(1).toLowerCase() !== format && !byExt(format)) {
    const blender = findBlender(blenderPath());
    try {
      if (format === 'obj' && glb && !(glbStats(fs.readFileSync(glb)).compressed.length)) { glbToObj(glb, outDir, 'model'); }
      else if (blender && (glb || main)) { await blenderConvert(blender, glb || main, path.join(outDir, `model.${format}`), format); }
      else error = `${format.toUpperCase()}: сервис отдал ${path.extname(main).slice(1).toUpperCase()}, а для перевода нужен Blender (бесплатный, blender.org) — ` +
        'установите его (Freefield найдёт сам) или впишите путь в config.json ("blender": "…\\\\blender.exe"). Модель сохранена в исходном формате.';
    } catch (e) { error = `перевод в ${format.toUpperCase()} не удался: ${e.message}. Модель сохранена в исходном формате.`; }
  }
  const model = byExt(format) || main;
  let stats = null;
  try { if (glb) stats = glbStats(fs.readFileSync(glb)); } catch (e) { warnings.push('не удалось прочитать GLB: ' + e.message); }
  if (!stats && /\.obj$/i.test(model)) {
    let tri = 0, v = 0;
    for (const l of fs.readFileSync(model, 'utf8').split('\n')) { if (l.startsWith('f ')) tri += l.trim().split(/\s+/).length - 3; else if (l.startsWith('v ')) v++; }
    stats = {triangles: tri, vertices: v, textures: [], pbr: null, textured: null, compressed: []};
  }
  const files = all().map(f => {
    const ext = path.extname(f).slice(1).toLowerCase();
    const role = f === model ? 'model' : MODEL_EXT.includes(ext) ? 'model_alt' : /^(png|jpe?g|webp|tga|bmp)$/.test(ext) ? 'texture' : ext === 'mtl' ? 'material' : 'other';
    return fileInfo(f, {role, format: ext});
  });
  return {model_path: path.resolve(model), format: path.extname(model).slice(1).toLowerCase(), files, stats, error};
}

// Главная функция: картинка (или виды) → модель в outDir. Возвращает данные для ответа инструмента.
export async function imageTo3d({image, views, service = 'auto', quality = 'high', texture = true, pbr = false, format = 'glb', allowPaid = false, outDir, onStatus = () => {}}) {
  const readImg = p => { const buf = fs.readFileSync(p); const s = imageSize(buf); return {path: path.resolve(p), buf, name: path.basename(p), mime: mimeOf(p), width: s?.width, height: s?.height}; };
  const input = image ? readImg(image) : views?.front ? readImg(views.front) : null;
  const vimg = views ? Object.fromEntries(Object.entries(views).filter(([, v]) => v).map(([k, v]) => [k, readImg(v)])) : null;
  const order = service !== 'auto' ? [service] : views ? ['hunyuan', 'tripo', 'meshy', 'hf'] : ['hunyuan', 'hf', 'tripo', 'meshy'];
  const skipped = [];
  for (const svc of order) {
    const warnings = [];
    // окно Chrome нужно сайтам и Spaces без токена; с токеном из config.json Space вызывается напрямую
    const release = svc === 'hf' && hfToken(currentProfile()) ? () => {} : await leaseProfile();
    try {
      onStatus(`${NAME(svc)}: начинаю`);
      const got = svc === 'hf' ? await hfRun({input, views: vimg, quality, texture, onStatus})
        : await webRun(svc, {input, views: vimg, quality, texture, pbr, format, allowPaid, outDir, onStatus});
      warnings.push(...(got.warnings || []));
      if (svc === 'hf') track3d('hf', {used: 1});
      const fin = await finishModel(outDir, got, format, warnings);
      return {status: 'done', service: svc, service_label: NAME(svc), engine: got.model, space: got.space || null, access: svc !== 'hf' ? 'вход в окне Chrome Freefield' : got.mode === 'token' ? `токен Hugging Face: ${hfTokenSource(currentProfile())}` : 'вход в Hugging Face в окне Chrome Freefield',
        profile: currentProfile(), model_path: fin.model_path, format: fin.format, files: fin.files,
        polygons: fin.stats ? {triangles: fin.stats.triangles, vertices: fin.stats.vertices} : null,
        textures: fin.stats?.textures?.length ?? fin.files.filter(f => f.role === 'texture').length, textured: fin.stats?.textured ?? got.textured ?? null,
        pbr: fin.stats?.pbr ?? got.pbr ?? null, compressed: fin.stats?.compressed || [], applied: got.applied || null,
        free_left: freeLeft(svc), skipped, warnings, ...(fin.error ? {error: fin.error, error_kind: 'format'} : {})};
    } catch (e) {
      const err = {service: svc, reason: scrub(e.message), kind: e.kind || 'other'};
      if (service !== 'auto') throw Object.assign(new Error(err.reason), {kind: err.kind, skipped});
      skipped.push(err);
      onStatus(`${NAME(svc)}: ${err.reason} → следующий сервис`);
    } finally { release(); }
  }
  const login = skipped.filter(s => s.kind === 'login' || s.kind === 'captcha');
  throw Object.assign(new Error('Ни один сервис не сделал модель: ' + skipped.map(s => `${NAME(s.service)} — ${s.reason}`).join('; ') +
    (login.length ? `. Войдите (или пройдите проверку) в окне Chrome Freefield: ${login.map(s => NAME(s.service)).join(', ')}` : '')), {kind: login.length ? 'login' : 'other', skipped});
}

// Для portal_status: вход и остаток по 3D-сервисам (open — открыть сайты, чтобы проверить вход)
export async function status3d(open = false) {
  const out = {};
  const p = currentProfile();
  for (const svc of Object.keys(SERVICES_3D)) {
    const S = SERVICES_3D[svc];
    const left = freeLeft(svc);
    try {
      if (svc === 'hf') {
        const tok = hfToken(p);
        if (tok) {
          const w = await whoamiToken(tok);
          if (w.ok) noteSite('hf', {login: true, name: w.name, pro: w.pro, via: 'token'});
          out.hf = w.ok ? `вход по токену (${hfTokenSource(p)}): ${w.name}${w.pro ? ' · PRO' : ''}` : w.ok === null ? `токен есть (${hfTokenSource(p)}), проверить не удалось: ${w.error}` : `токен (${hfTokenSource(p)}) не подошёл: ${w.error}`;
        } else {
          const has = (await profilePages()).some(x => x.url().includes('huggingface.co'));
          if (!has && !open) out.hf = 'вкладка не открыта (откроется при первой генерации); токена в config.json нет — будет вход в окне Chrome';
          else {
            const page = await ui(() => profileTab('https://huggingface.co/', 'huggingface.co', open));
            const who = await page.evaluate(async () => { const r = await fetch('/api/whoami-v2', {credentials: 'include'}).catch(() => null); if (!r?.ok) return {ok: false}; const j = await r.json().catch(() => ({})); return {ok: true, name: j.name, pro: !!(j.isPro || j.plan?.type === 'pro')}; }).catch(() => ({ok: false}));
            noteSite('hf', {login: who.ok, name: who.name || null, pro: !!who.pro});
            out.hf = who.ok ? `вход выполнен: ${who.name}${who.pro ? ' · PRO' : ''}` : 'Нужно войти в Hugging Face в окне Chrome Freefield';
          }
        }
        out.hf += ` · ${left.quota}${left.seconds_left != null ? `, осталось ≈ ${left.seconds_left} с` : ''} (≈ ${left.generations_left_estimate} моделей)`;
        continue;
      }
      const has = (await profilePages()).some(x => x.url().includes(S.match));
      if (!has && !open) { out[svc] = `вкладка не открыта (откроется при первой генерации) · бесплатно осталось ≈ ${left.left} ${left.unit} за ${left.per} (${left.source})`; continue; }
      const page = await ui(async () => { const pg = await profileTab(S.home, S.match, true); await webReady(pg, svc); return pg; });
      const site = await readLeft(page, svc);
      const l2 = freeLeft(svc);
      out[svc] = `вход выполнен · бесплатно осталось ${site != null ? site : '≈ ' + l2.left} ${l2.unit} за ${l2.per} (${site != null ? 'сайт' : l2.source})`;
    } catch (e) { out[svc] = e.message; }
  }
  return out;
}
