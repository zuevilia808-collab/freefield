// Экспорт проекта montage.json в другие редакторы (этап 7): FCPXML 1.9 (DaVinci Resolve, Final Cut, Premiere через импорт XML),
// OpenTimelineIO (.otio — Resolve, Kdenlive, Premiere с плагином) и SRT-субтитры (CapCut, YouTube, любой плеер).
// Клипы ссылаются на файлы на этом компьютере (абсолютные пути): проект открывается здесь же. Эффекты и графика Freefield не переносятся —
// только резка, порядок, длины, переходы (как наплыв), звук и субтитры.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalize, sourcePath, ASPECTS} from './project.js';
import {info} from './analyze.js';

const xml = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
const srtTime = t => { const ms = Math.max(0, Math.round(t * 1000)); const h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };

// клипы с раскрытыми временами (встык) и путями
async function resolved(P, ctx) {
  const clips = [];
  let cursor = 0;
  for (const c of P.tracks.video) {
    const file = sourcePath(c.src, ctx), fi = await info(file);
    const out = Math.min(c.out ?? fi.duration, fi.duration || c.out || 3), len = Math.max(0.1, (out - c.in) / c.speed);
    const at = c.at ?? cursor;
    clips.push({...c, file, fi, out, len, at});
    cursor = at + len;
  }
  const audio = [];
  for (const a of P.tracks.audio) {
    const file = sourcePath(a.src, ctx), fi = await info(file);
    const out = Math.min(a.out ?? fi.duration, fi.duration);
    audio.push({...a, file, fi, len: Math.max(0.1, out - a.in)});
  }
  return {clips, audio, end: Math.max(cursor, ...clips.map(c => c.at + c.len), 0)};
}

// субтитры: фразы по 2–6 слов (как читают в CapCut), разрыв на паузе или конце предложения
export function srt(P) {
  const words = P.tracks.captions.words, lines = [];
  let cur = [];
  const flush = () => { if (cur.length) lines.push(cur); cur = []; };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 0.5 || cur.length >= 6 || /[.!?…]$/.test(prev.text))) flush();
    cur.push(w);
  }
  flush();
  return lines.map((l, i) => `${i + 1}\n${srtTime(l[0].start)} --> ${srtTime(Math.max(l[l.length - 1].end, l[0].start + 0.4))}\n${l.map(w => w.text).join(' ')}\n`).join('\n');
}

export async function fcpxml(P, ctx) {
  const R = await resolved(P, ctx), fps = P.fps, [W, H] = ASPECTS[P.aspect];
  const tc = t => `${Math.round(t * fps)}/${fps}s`;   // время в кадрах
  const assets = new Map();
  const asset = (file, fi) => {
    if (!assets.has(file)) assets.set(file, {id: 'r' + (assets.size + 2), file, fi});
    return assets.get(file).id;
  };
  // элементы основной дорожки: {tr, open, inner, close, start} — к первому потом прикрепляется звук
  const spine = [];
  let t = 0;
  for (const [i, c] of R.clips.entries()) {
    if (c.at > t + 0.02) { spine.push({open: `<gap name="Пусто" offset="${tc(t)}" duration="${tc(c.at - t)}" start="0s">`, close: '</gap>', start: 0}); t = c.at; }
    const id = asset(c.file, c.fi), len = Math.min(c.len, i < R.clips.length - 1 ? Math.max(0.1, R.clips[i + 1].at - c.at) : c.len);
    spine.push({tr: c.transition.type !== 'cut' && i ? `<transition name="Наплыв" offset="${tc(Math.max(0, t - c.transition.duration / 2))}" duration="${tc(c.transition.duration)}"/>` : '',
      open: `<asset-clip ref="${id}" name="${xml(path.basename(c.file))}" offset="${tc(t)}" start="${tc(c.in)}" duration="${tc(len)}" format="r1">`,
      inner: (c.speed !== 1 ? `<timeMap><timept time="0s" value="0s" interp="linear"/><timept time="${tc(len)}" value="${tc(len * c.speed)}" interp="linear"/></timeMap>` : '') +
        (c.mute ? '<adjust-volume amount="-96dB"/>' : ''), close: '</asset-clip>', start: c.in});
    t += len;
  }
  // музыка и озвучка — связанные клипы первого элемента (как в Final Cut): их offset — во времени этого элемента (его start + момент на таймлайне)
  if (spine.length) spine[0].inner = (spine[0].inner || '') + R.audio.map(a => `<asset-clip ref="${asset(a.file, a.fi)}" lane="-${a.role === 'voice' ? 1 : 2}" name="${xml(path.basename(a.file))}" ` +
    `offset="${tc(spine[0].start + a.at)}" start="${tc(a.in)}" duration="${tc(Math.min(a.len, R.end - a.at))}" audioRole="${a.role === 'voice' ? 'dialogue' : 'music'}"/>`).join('');
  const res = [...assets.values()].map(a => `<asset id="${a.id}" name="${xml(path.basename(a.file))}" start="0s" duration="${tc(a.fi.duration || 3)}" hasVideo="${a.fi.video || a.fi.image ? 1 : 0}" hasAudio="${a.fi.audio ? 1 : 0}" format="r1"><media-rep kind="original-media" src="${xml(pathToFileURL(a.file).href)}"/></asset>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.9">\n<resources>\n<format id="r1" name="FFVideoFormat${H}p${fps}" frameDuration="1/${fps}s" width="${W}" height="${H}"/>\n${res.join('\n')}\n</resources>\n` +
    `<library><event name="Freefield"><project name="${xml(P.name)}"><sequence format="r1" duration="${tc(Math.max(t, R.end))}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k"><spine>\n${spine.map(s => (s.tr || '') + s.open + (s.inner || '') + s.close).join('\n')}\n</spine></sequence></project></event></library>\n</fcpxml>\n`;
}

export async function otio(P, ctx) {
  const R = await resolved(P, ctx), fps = P.fps;
  const rt = s => ({OTIO_SCHEMA: 'RationalTime.1', rate: fps, value: Math.round(s * fps)});
  const range = (a, d) => ({OTIO_SCHEMA: 'TimeRange.1', start_time: rt(a), duration: rt(d)});
  const ref = (file, fi) => ({OTIO_SCHEMA: 'ExternalReference.1', target_url: pathToFileURL(file).href, available_range: range(0, fi.duration || 3)});
  const vItems = [];
  let t = 0;
  for (const [i, c] of R.clips.entries()) {
    if (c.at > t + 0.02) { vItems.push({OTIO_SCHEMA: 'Gap.1', source_range: range(0, c.at - t)}); t = c.at; }
    const len = Math.min(c.len, i < R.clips.length - 1 ? Math.max(0.1, R.clips[i + 1].at - c.at) : c.len);
    if (i && c.transition.type !== 'cut') vItems.push({OTIO_SCHEMA: 'Transition.1', name: c.transition.type, transition_type: 'SMPTE_Dissolve',
      in_offset: rt(c.transition.duration / 2), out_offset: rt(c.transition.duration / 2)});
    vItems.push({OTIO_SCHEMA: 'Clip.2', name: path.basename(c.file), source_range: range(c.in, len * c.speed),
      media_references: {DEFAULT_MEDIA: ref(c.file, c.fi)}, active_media_reference_key: 'DEFAULT_MEDIA',
      effects: c.speed !== 1 ? [{OTIO_SCHEMA: 'LinearTimeWarp.1', effect_name: 'LinearTimeWarp', time_scalar: c.speed}] : []});
    t += len;
  }
  const aItems = [];
  let ta = 0;
  for (const a of [...R.audio].sort((x, y) => x.at - y.at)) {
    if (a.at > ta + 0.02) aItems.push({OTIO_SCHEMA: 'Gap.1', source_range: range(0, a.at - ta)});
    const d = Math.min(a.len, R.end - a.at);
    aItems.push({OTIO_SCHEMA: 'Clip.2', name: path.basename(a.file), source_range: range(a.in, d), media_references: {DEFAULT_MEDIA: ref(a.file, a.fi)}, active_media_reference_key: 'DEFAULT_MEDIA'});
    ta = a.at + d;
  }
  return JSON.stringify({OTIO_SCHEMA: 'Timeline.1', name: P.name, global_start_time: rt(0), tracks: {OTIO_SCHEMA: 'Stack.1', name: 'tracks', children: [
    {OTIO_SCHEMA: 'Track.1', name: 'Видео', kind: 'Video', children: vItems},
    ...(aItems.length ? [{OTIO_SCHEMA: 'Track.1', name: 'Музыка', kind: 'Audio', children: aItems}] : []),
  ]}}, null, 1);
}

// все форматы рядом с файлом проекта: base.fcpxml, base.otio, base.srt
export async function exportProject(project, {base, ctx, formats = ['fcpxml', 'otio', 'srt']}) {
  const P = normalize(project), out = {};
  if (formats.includes('fcpxml')) { fs.writeFileSync(base + '.fcpxml', await fcpxml(P, ctx)); out.fcpxml = base + '.fcpxml'; }
  if (formats.includes('otio')) { fs.writeFileSync(base + '.otio', await otio(P, ctx)); out.otio = base + '.otio'; }
  if (formats.includes('srt') && P.tracks.captions.words.length) { fs.writeFileSync(base + '.srt', '﻿' + srt(P)); out.srt = base + '.srt'; }
  return out;
}
