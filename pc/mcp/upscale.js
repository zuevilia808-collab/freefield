// Увеличение картинки в 2 или 4 раза (инструмент upscale_image) — бесплатно:
//  1) картинка сделана во Flow через Freefield — Flow сам увеличивает её до 2K/4K (меню «Скачать»), как человек на сайте;
//  2) иначе — Space на Hugging Face с Real-ESRGAN (или другой из config.json: upscale_spaces) под аккаунтом пользователя.
import fs from 'node:fs';
import path from 'node:path';
import {fileInfo, imageSize} from './media.js';
import {profileIds, withProfile, currentProfile} from './state.js';
import {leaseProfile} from './bridge.js';
import {hfToken, upscaleSpaces, scrub} from './config.js';
import {hfSession} from './mesh3d.js';
import {HfError} from './gradio.js';
import * as P from './portals.js';

// Spaces с Real-ESRGAN по умолчанию (по порядку; первый, который ответит). Свой список — upscale_spaces в config.json
export const DEFAULT_UPSCALE_SPACES = ['Nick088/Real-ESRGAN_Pytorch', 'doevent/Face-Real-ESRGAN', 'finegrain/finegrain-image-enhancer'];

// Вход Space с картинкой и выход с картинкой; параметр масштаба — по подписи (scale, factor, resolution, «2x»…)
function pickUpscaleCall(sp, factor) {
  const comps = new Map((sp.cfg.components || []).map(c => [c.id, c]));
  const isImg = id => ['image', 'imageslider', 'file'].includes(comps.get(id)?.type);
  const deps = (sp.cfg.dependencies || []).map((d, i) => ({...d, fn: d.id ?? i}))
    .filter(d => d.backend_fn !== false && (d.inputs || []).some(id => comps.get(id)?.type === 'image') && (d.outputs || []).some(isImg));
  const dep = deps.find(d => /upscal|enhanc|inference|predict|process|run/i.test(d.api_name || '')) || deps[0];
  if (!dep) return null;
  const set = {};
  for (const id of dep.inputs) {
    const c = comps.get(id), label = String(c?.props?.label || '');
    if (c?.type === 'image' && !set.__img) { set.__img = id; continue; }
    if (!/scale|factor|resolution|size|upscal|times|\bx\b|увелич|масштаб/i.test(label) && !(c?.props?.choices || []).some(ch => /\b[248]\s*x\b|\bx\s*[248]\b/i.test(String(Array.isArray(ch) ? ch[1] : ch)))) continue;
    const choices = (c?.props?.choices || []).map(ch => Array.isArray(ch) ? ch[1] : ch);
    if (choices.length) {
      const hit = choices.find(v => new RegExp(`(^|\\D)${factor}\\s*x\\b|\\bx\\s*${factor}(\\D|$)|^${factor}$`, 'i').test(String(v)));
      if (hit != null) set[id] = hit;
    } else if (['slider', 'number'].includes(c?.type)) {
      const min = c.props?.minimum ?? 1, max = c.props?.maximum ?? factor;
      set[id] = Math.max(min, Math.min(max, factor));
    }
  }
  return {dep, set, imgId: set.__img};
}

async function hfUpscale(file, factor, onStatus) {
  const buf = fs.readFileSync(file);
  const mime = {png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif'}[imageSize(buf)?.format] || 'image/png';
  const spaces = upscaleSpaces()?.length ? upscaleSpaces() : DEFAULT_UPSCALE_SPACES;
  let last = null;
  for (const space of spaces) {
    const release = hfToken(currentProfile()) ? () => {} : await leaseProfile();
    try {
      onStatus(`Hugging Face: открываю ${space}`);
      const sp = await hfSession(space, onStatus);
      const call = pickUpscaleCall(sp, factor);
      if (!call?.imgId) throw new HfError(`${space}: не нашёл, куда загрузить картинку`, 'ui');
      const img = await sp.upload(buf, path.basename(file), mime);
      const set = {...call.set, [call.imgId]: img};
      delete set.__img;
      const out = await sp.call(call.dep, set, {status: `${space} увеличивает картинку ×${factor}`});
      // ImageSlider отдаёт пару [до, после] — берём последнюю картинку
      const flat = out.flatMap(v => Array.isArray(v) ? v : [v]).filter(v => v && typeof v === 'object' && (v.path || v.url));
      const res = flat[flat.length - 1];
      if (!res) throw new HfError(`${space} не вернул картинку`, 'busy');
      return {buf: await sp.fetchFile(sp.fileUrl(res)), service: 'hf', engine: space, access: sp.mode === 'token' ? 'токен Hugging Face' : 'вход в Hugging Face в окне Chrome Freefield'};
    } catch (e) {
      last = e;
      if (['login', 'auth', 'captcha', 'quota'].includes(e.kind)) throw e;
      onStatus(`${space}: ${e.message} → следующий Space`);
    } finally { release(); }
  }
  throw last || new HfError('нет Spaces для апскейла', 'down');
}

export async function upscaleImage({file, factor = 2, service = 'auto', allowCredits = false, outDir, onStatus = () => {}}) {
  const src = fileInfo(file);
  if (!src.width) throw new Error('не удалось прочитать размер картинки (нужен PNG, JPEG или WebP)');
  const warnings = [];
  let got = null;
  // 1) Flow: картинка Flow, сделанная через Freefield (её id и проект Freefield помнит в профиле, где она сделана)
  if (service !== 'hf') {
    const owner = profileIds().map(p => [p, withProfile(p, () => P.flowFileOf(file))]).find(([, r]) => r);
    const longSide = Math.max(src.width, src.height) * factor;
    const res = longSide <= 2200 ? '2k' : longSide <= 4400 ? '4k' : null;
    if (owner && res) {
      try {
        const r = await withProfile(owner[0], () => P.flowUpscaleById({id: owner[1].id, project: owner[1].project, resolution: res, allowCredits, onStatus}));
        got = {buf: r.buf, service: 'flow', engine: `Google Flow · ${r.resolution} (увеличение Flow)`, access: 'вход в окне Chrome Freefield', profile: owner[0]};
      } catch (e) {
        if (service === 'flow' || e.kind === 'credits') throw e;
        warnings.push(`Flow не увеличил (${e.message}) — беру Space на Hugging Face`);
      }
    } else if (service === 'flow') throw new Error(owner ? `×${factor} от ${src.width}×${src.height} больше 4K — Flow так не умеет` : 'эту картинку делал не Flow через Freefield — Flow увеличивает только свои картинки (возьмите service="hf")');
  }
  // 2) Real-ESRGAN в Space на Hugging Face
  if (!got) got = await hfUpscale(src.path, factor, onStatus);
  const s = imageSize(got.buf);
  const ext = {png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif'}[s?.format] || 'png';
  fs.mkdirSync(outDir, {recursive: true});
  let out = path.join(outDir, `${path.basename(src.path).replace(/\.\w+$/, '')}-x${factor}.${ext}`);
  for (let i = 2; fs.existsSync(out); i++) out = out.replace(/(-\d+)?(\.\w+)$/, `-${i}$2`);
  fs.writeFileSync(out, got.buf);
  const info = fileInfo(out);
  const actual = info.width && src.width ? Math.round(info.width / src.width * 100) / 100 : null;
  if (actual && Math.abs(actual - factor) > 0.15) warnings.push(`получилось ×${actual} вместо ×${factor} (${got.service === 'flow' ? 'Flow увеличивает до своих размеров 2K/4K' : 'Space увеличивает в своё число раз'}) — Freefield картинку не обрезал и не сжимал`);
  if (got.service === 'hf' && s?.format === 'webp' && src.mime !== 'image/webp') warnings.push('Space отдал WebP (так он сохраняет картинки) — файл сохранён как есть');
  return {status: 'done', service: got.service, engine: got.engine, access: got.access, source: {path: src.path, width: src.width, height: src.height},
    path: info.path, width: info.width, height: info.height, mime: info.mime, bytes: info.bytes, factor_requested: factor, factor_actual: actual,
    file: info, warnings: warnings.map(scrub)};
}
