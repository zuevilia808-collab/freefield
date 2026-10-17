// Эталонный промпт видео пользователя (раздел «Сценарии» приложения). Пользователь 2026-10-17: «ты читеришь и генеришь видео
// не по эталонному сценарию» — агент писал промпты по устаревшей памяти, эталона у MCP не было. Теперь приложение присылает
// свой эталон сюда (POST /api/etalon), инструмент video_etalon отдаёт его агенту, а batch_generate / flow_video / vids_video
// не запускают видео-промпт, в котором нет блоков эталона.
import fs from 'node:fs';
import path from 'node:path';
import {HERE} from './state.js';

// эталон v4 (как REF_PROMPT в js/write.js приложения) — пока приложение не прислало свой
export const DEFAULT_ETALON = `Scenes & Shot cuts:
(0:00–0:03) Scene 1 — HOOK: [What we see; the first frame matches the location photo]
(0:03–0:07) Scene 2 — MAIN: [What we see]
(0:07–0:10) Scene 3 — CTA: [What we see]
On-screen text:
(0:00–0:03) «[Hook, up to 7 words]» — upper third, bold
(0:03–0:07) [Clean frame, or one key fact/number in «»]
(0:07–0:10) «[Call to action]» — upper third
Spoken line:
(0:00–0:03) «[Line 1]»
(0:03–0:07) «[Line 2]»
(0:07–0:10) «[Line 3]»
Subtitles:
(0:00–0:03) «[Exact subtitle text 1]»
(0:03–0:07) «[Exact subtitle text 2]»
(0:07–0:10) «[Exact subtitle text 3]»
Action & Emotions:
(0:00–0:03) [Action + emotion; a concrete hand or prop action]
(0:03–0:07) [Action + emotion]
(0:07–0:10) [Action + emotion]
Pose & body language:
(0:00–0:10) [Posture, gestures, facial expression, eye contact with the camera]
Location:
(0:00–0:10) [Place, props, light, time of day — exactly as in the location photo]
Camera & framing:
(0:00–0:03) [Shot size, angle, lens, movement — vertical 9:16]
(0:03–0:07) [Shot size, angle, movement]
(0:07–0:10) [Shot size, angle, movement]
Sound design:
(0:00–0:03) [Ambient sound + accent effect]
(0:03–0:07) [Voice up front, music quiet underneath]
(0:07–0:10) [Final beat / music swell]
Timing & pacing:
(0:00–0:10) [Overall pace; cuts land on the beat and speech pauses]`;

export const ETALON_RULES = 'Как заполнять: те же подписи блоков, в том же порядке, каждая на своей строке; под ней — строки с таймкодами, как в эталоне ' +
  '(ролик другой длины — растяни таймкоды пропорционально). Ничего не добавляй вне блоков и не пропускай блоки. Надписи на экране, реплики и субтитры — ' +
  'по-русски в «», всё остальное — по-английски. Внешность героя не описывай (она — на фото-референсах), Location — только место, как на фото локации. ' +
  'Ролик длиннее 10 с — несколько частей по 10 с, каждая по эталону, потом склейка в монтаже (montage_render): в каждой части сцены 1–2–3 со сменой планов; ' +
  'призыв (CTA) и его надпись — только в последней части, сцена 3 остальных частей — клиффхэнгер («что будет дальше»), следующая часть начинается с другого ракурса. ' +
  'Надписи на экране Flow (Omni) рисует по-русски сам — в монтаже их не дублируй, добавляй только субтитры речи.';

const FILE = path.join(HERE, '.etalon.json');

export function etalon() {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (j.text?.trim()) return {text: j.text.trim(), from: 'app', at: j.at || null}; } catch { /* нет своего */ }
  return {text: DEFAULT_ETALON, from: 'default', at: null};
}

export function setEtalon(text) {
  const t = String(text || '').trim();
  if (t.length < 20 || t.length > 20000) throw new Error('эталон пустой или слишком длинный');
  if (labels(t).length < 3) throw new Error('в эталоне нет блоков «Подпись: …»');
  fs.writeFileSync(FILE, JSON.stringify({text: t, at: Date.now()}));
  return etalon();
}

const TC = /\(\d+:\d{2}\s*[–—-]\s*\d+:\d{2}\)/;
export const labels = t => [...String(t || '').matchAll(/^\s*([A-Za-zА-Яа-яЁё][^:\n(«]{1,40}):/gm)].map(m => m[1].trim());

// видео-промпт по эталону? → null, если да; иначе — что не так (по-русски, для агента)
export function checkPrompt(prompt, ref = etalon().text) {
  const want = labels(ref), have = labels(prompt);
  if (!want.length) return null;
  const missing = want.filter(l => !have.includes(l));
  const issues = [];
  if (missing.length) issues.push(`нет блоков: ${missing.join(', ')}`);
  const pos = want.map(l => have.indexOf(l)).filter(i => i >= 0);
  if (pos.some((p, i) => i && p < pos[i - 1])) issues.push('блоки не в том порядке, что в эталоне');
  const extra = have.filter(l => !want.includes(l));
  if (extra.length) issues.push(`лишние блоки, которых нет в эталоне: ${extra.join(', ')}`);
  if (TC.test(ref) && !TC.test(prompt)) issues.push('нет таймкодов «(0:00–0:03) …», как в эталоне');
  return issues.length ? issues.join('; ') : null;
}
