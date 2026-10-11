// Эффекты монтажа: переходы (ffmpeg xfade), «удары» зумом и наезд. Этап 3 плана добавит сюда скорость, тряску, вспышки, LUT…
// Переход в проекте: {"type": <ключ>, "duration": с}. Ключи приложения (cut / fade / black) тоже здесь.
export const TRANSITIONS = {
  cut: {xfade: null, d: 0, label: 'Склейка'},
  fade: {xfade: 'fade', d: 0.5, label: 'Плавно'},
  black: {xfade: 'fadeblack', d: 0.6, label: 'Через чёрное'},
  white: {xfade: 'fadewhite', d: 0.3, label: 'Через белое'},
  fadewhite: {xfade: 'fadewhite', d: 0.18, label: 'Вспышка'},
  flash: {xfade: 'fadewhite', d: 0.12, label: 'Короткая вспышка'},
  hblur: {xfade: 'hblur', d: 0.14, label: 'Смаз'},
  smoothleft: {xfade: 'smoothleft', d: 0.22, label: 'Сдвиг влево'},
  smoothright: {xfade: 'smoothright', d: 0.22, label: 'Сдвиг вправо'},
  smoothup: {xfade: 'smoothup', d: 0.22, label: 'Сдвиг вверх'},
  slideleft: {xfade: 'slideleft', d: 0.2, label: 'Шторка влево'},
  circleopen: {xfade: 'circleopen', d: 0.26, label: 'Круг'},
  dissolve: {xfade: 'dissolve', d: 0.3, label: 'Рассыпание'},
  pixelize: {xfade: 'pixelize', d: 0.3, label: 'Пиксели'},
  // xfade zoomin даёт тёмный пиксельный кадр — не используем; «удар» зумом делает fx.punch
};
// переходы ffmpeg xfade, которые можно назвать в проекте напрямую; неизвестное имя — «плавно» (имя уходит в команду ffmpeg)
export const XFADE = new Set(['fade', 'fadeblack', 'fadewhite', 'fadegrays', 'distance', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright',
  'slideup', 'slidedown', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown', 'circlecrop', 'rectcrop', 'circleopen', 'circleclose', 'vertopen', 'vertclose',
  'horzopen', 'horzclose', 'dissolve', 'pixelize', 'radial', 'hblur', 'wipetl', 'wipetr', 'wipebl', 'wipebr', 'squeezeh', 'squeezev', 'hlslice', 'hrslice',
  'vuslice', 'vdslice', 'hlwind', 'hrwind', 'vuwind', 'vdwind', 'coverleft', 'coverright', 'coverup', 'coverdown', 'revealleft', 'revealright', 'revealup', 'revealdown']);
export const transitionOf = t => {
  const def = TRANSITIONS[t?.type] || (XFADE.has(t?.type) ? {xfade: t.type, d: 0.25} : t?.type ? TRANSITIONS.fade : TRANSITIONS.cut);
  return {xfade: def.xfade, d: def.xfade ? Math.max(0.04, t.duration || def.d) : 0};
};
// набор для автомонтажа под бит: разные, но предсказуемые
export const BEAT_SET = ['hblur', 'fadewhite', 'smoothleft', 'cut', 'circleopen', 'smoothup', 'cut', 'slideleft'];

// затухающий импульс в моменты ts (секунды потока): сумма exp(-k·Δt) после каждого момента
const pulses = (v, ts, k, amp) => ts.map(t => `${amp}*exp(-${k}*(${v}-${t.toFixed(3)}))*gte(${v},${t.toFixed(3)})`);

// камера куска для zoompan (ot = секунды от начала потока куска; pre — где в потоке начало клипа на шкале):
// z — базовый зум (прыжок после паузы), наезд, «удары»; x/y — центр + тряска
export function cameraExpr(fx, {fps, pre, len}) {
  const ot = `(on/${fps})`;
  const z = [String(fx.zoom || 1)];
  if (fx.drift) z.push(`${fx.drift}*max(0,${ot}-${pre.toFixed(3)})/${Math.max(0.1, len).toFixed(3)}`);
  z.push(...pulses(ot, (fx.punch || []).map(p => pre + p), 11, fx.punch_amount));
  let x = 'iw/2-(iw/zoom/2)', y = 'ih/2-(ih/zoom/2)';
  if (fx.shake?.amount) {
    // тряска: на ударах (затухает) или всё время; запас под неё — небольшой зум
    const a = fx.shake.amount * 0.035;
    const env = fx.shake.on === 'always' ? '1' : `(${pulses(ot, (fx.punch || []).map(p => pre + p), 7, 1).join('+') || '0'})`;
    z.push(String(+(a * 2.2).toFixed(4)));
    x += `+iw*${a}*${env}*sin(${ot}*53)`;
    y += `+ih*${a}*${env}*sin(${ot}*41+1.3)`;
  }
  return {z: z.join('+'), x, y};
}
export const hasCamera = fx => !!(fx.drift || fx.punch?.length || (fx.zoom || 1) > 1 || fx.shake?.amount);

// кадрирование: центр окна по ключам [[t, x, y]] → выражения crop x и y (t потока = t ключа + shift)
export function reframeXY(keys, shift) {
  if (!keys?.length) return {x: '(iw-ow)/2', y: '(ih-oh)/2'};
  const k = keys.map(([t, x, y]) => [t + shift, x, y ?? 0.5]);
  const axis = (j, full, win) => {
    let e = k[k.length - 1][j].toFixed(3);
    for (let i = k.length - 2; i >= 0; i--) {
      const t0 = k[i][0], t1 = k[i + 1][0], v0 = k[i][j], v1 = k[i + 1][j];
      e = `if(lt(t,${t1.toFixed(3)}),${v0.toFixed(3)}+(${(v1 - v0).toFixed(3)})*(t-${t0.toFixed(3)})/${Math.max(0.01, t1 - t0).toFixed(3)},${e})`;
    }
    if (k[0][0] > 0) e = `if(lt(t,${k[0][0].toFixed(3)}),${k[0][j].toFixed(3)},${e})`;
    return `clip(${full}*(${e})-${win}/2,0,${full}-${win})`;
  };
  return {x: axis(1, 'iw', 'ow'), y: axis(2, 'ih', 'oh')};
}

/* ---------- этап 3: эффекты клипа (fx в montage.json) ---------- */
// "shake": {"amount": 0–1, "on": "beats" | "always"}  — тряска (на ударах или всё время)
// "flash": true                — белая вспышка на ударах
// "rgb": true                  — RGB-сдвиг (глитч) на ударах
// "blur": true                 — смаз движения
// "reverse": true              — задом наперёд
// "freeze": [секунды]          — стоп-кадр 0,5 с в эти моменты (от начала клипа на шкале)
// "ramp": [{"at": с, "speed": x}] — скорость по ключам (speed ramp): кусок режется на участки со своей скоростью
// "smooth": true               — плавное слоумо (досчёт кадров) при скорости < 1
const num = (v, d, lo, hi) => Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d;
export function fxNorm(fx = {}) {
  const o = {};
  if (fx.shake) o.shake = {amount: num(fx.shake.amount ?? fx.shake, 0.4, 0, 1), on: fx.shake.on === 'always' ? 'always' : 'beats'};
  for (const k of ['flash', 'rgb', 'blur', 'reverse', 'smooth']) if (fx[k]) o[k] = true;
  if (Array.isArray(fx.freeze)) o.freeze = fx.freeze.map(t => num(t, 0, 0, 600)).slice(0, 20);
  if (Array.isArray(fx.ramp)) o.ramp = fx.ramp.slice(0, 20).map(k => ({at: num(k.at, 0, 0, 600), speed: num(k.speed, 1, 0.2, 4)})).sort((a, b) => a.at - b.at);
  return o;
}
// фильтры после камеры: вспышка, глитч, смаз (t — секунды потока куска; удары — pre + punch)
export function clipFxFilters(fx, {pre, fps}) {
  const out = [], hits = (fx.punch || []).map(p => pre + p);
  if (fx.flash && hits.length) out.push(`eq=brightness='min(0.55,${pulses('t', hits, 14, 0.6).join('+')})':eval=frame`);
  if (fx.rgb && hits.length) out.push(`rgbashift=rh=-10:bh=10:enable='${hits.map(t => `between(t,${t.toFixed(3)},${(t + 0.12).toFixed(3)})`).join('+')}'`);
  if (fx.blur) out.push('tmix=frames=3:weights=1 2 1');
  if (fx.freeze?.length) for (const t of fx.freeze) out.push(`loop=loop=${Math.round(0.5 * fps)}:size=1:start=${Math.round((pre + t) * fps)}`, 'setpts=N/FRAME_RATE/TB');
  return out;
}

/* ---------- этап 3: цвет и атмосфера всего ролика (look в montage.json) ---------- */
// "look": {"preset": "teal_orange" | "film" | "bw" | "neon" | "warm" | "cold" | "aura" | "none", "vignette": true, "grain": 0–1, "letterbox": true}
export const LOOKS = {
  teal_orange: {label: 'Бирюза и оранж', vf: 'colorbalance=rs=-0.06:gs=-0.02:bs=0.08:rh=0.08:gh=0.02:bh=-0.07,eq=contrast=1.08:saturation=1.15'},
  film: {label: 'Плёнка', vf: 'curves=preset=vintage,eq=contrast=1.05:saturation=0.92'},
  bw: {label: 'Ч/б контраст', vf: 'hue=s=0,eq=contrast=1.35:brightness=-0.02'},
  neon: {label: 'Неон', vf: 'eq=saturation=1.55:contrast=1.15,colorbalance=bs=0.1:rs=0.06:bh=0.06'},
  warm: {label: 'Тёплый', vf: 'colortemperature=temperature=4800:mix=0.6,eq=saturation=1.08'},
  cold: {label: 'Холодный', vf: 'colortemperature=temperature=8500:mix=0.6,eq=contrast=1.05'},
  aura: {label: 'Аура (свечение)', glow: true, vf: 'eq=contrast=1.06:saturation=1.1'},
};
export function lookNorm(l) {
  if (!l) return null;
  const o = typeof l === 'string' ? {preset: l} : l;
  return {preset: LOOKS[o.preset] ? o.preset : 'none', vignette: !!o.vignette, grain: num(o.grain, 0, 0, 1), letterbox: !!o.letterbox};
}
// цепочка для всего кадра: [in] → … → [out]; label — уникальная приставка меток
export function lookChain(look, inLbl, outLbl) {
  const L = LOOKS[look?.preset], parts = [];
  let cur = inLbl, n = 0;
  const step = f => { const o = `[lk${n++}]`; parts.push(`${cur}${f}${o}`); cur = o; };
  if (L?.glow) {
    parts.push(`${cur}split=2[lga][lgb]`, `[lgb]gblur=sigma=18,eq=brightness=0.04[lgc]`, `[lga][lgc]blend=all_mode=screen:all_opacity=0.38[lgd]`);
    cur = '[lgd]';
  }
  if (L?.vf) step(L.vf);
  if (look?.vignette) step('vignette=angle=PI/4.5');
  if (look?.grain) step(`noise=alls=${Math.round(4 + look.grain * 14)}:allf=t`);
  if (look?.letterbox) step(`drawbox=x=0:y=0:w=iw:h=ih*0.09:color=black:t=fill,drawbox=x=0:y=ih*0.91:w=iw:h=ih*0.09:color=black:t=fill`);
  parts.push(`${cur}null${outLbl}`);
  return parts;
}

/* ---------- этап 3: звуковые удары (sfx в montage.json) ---------- */
// "sfx": {"transitions": true, "hits": true, "riser": true} — свист на переходах, удар на сильных долях, нарастание перед дропом.
// Звуки синтезирует сам ffmpeg (свои, без лицензий).
export const SFX = {
  whoosh: {d: 0.45, src: "aevalsrc='0.5*(random(0)*2-1)*sin(PI*t/0.45)^2':s=48000:d=0.45", af: 'bandpass=f=1800:width_type=o:w=2,afade=t=in:d=0.15,volume=1.6'},
  hit: {d: 0.35, src: "aevalsrc='0.9*sin(2*PI*(45+90*exp(-28*t))*t)*exp(-9*t)+0.3*(random(0)*2-1)*exp(-60*t)':s=48000:d=0.35", af: 'volume=1.1'},
  riser: {d: 2.0, src: "aevalsrc='0.35*(random(0)*2-1)*(t/2)^2':s=48000:d=2", af: 'highpass=f=600,afade=t=in:d=1.5'},
};
export function sfxNorm(s) {
  if (!s) return null;
  return {transitions: !!s.transitions, hits: !!s.hits, riser: !!s.riser, volume: num(s.volume, 0.6, 0, 2)};
}
