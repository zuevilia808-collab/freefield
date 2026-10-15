// Свой трек для монтажа — синтез на этом компьютере (без лицензий): фонк для эдитов.
// Стили: aura — медленный «аура-фонк» (84 BPM, половинный размер): вступление-атмосфера → нарастание → тишина на долю → дроп;
//        drift — быстрый «дрифт-фонк» (128 BPM) для velocity: коубелл-мелодия, перегруженный 808, хлопки на 2 и 4;
//        trailer — кино-трейлер (90 BPM): гулкие удары, низкий гул, нарастание, удар на дропе.
// Звук считается в JS (бочка, 808 с проскальзыванием, хлопок, хэты, коубелл, пэд, нарастание, «насос» от бочки, простое эхо),
// ffmpeg выравнивает громкость до −14 LUFS и сохраняет mp3. Дроп — там, где его найдёт analyze.findDrop (самый резкий рост энергии).
import fs from 'node:fs';
import path from 'node:path';
import {ff} from './analyze.js';

const SR = 44100;
const hz = m => 440 * 2 ** ((m - 69) / 12);
const STYLES = {
  aura: {bpm: 84, key: 38, half: true, bars: {intro: 4, build: 2, drop: 8, brk: 2, drop2: 4, outro: 1},
    prog: [0, 0, -4, -5], bell: [[0, 12], [3, 15], [6, 12], [8, 7], [11, 10], [14, 7]], bellGain: 0.16, padGain: 0.11},
  drift: {bpm: 128, key: 37, half: false, bars: {intro: 2, build: 2, drop: 16, brk: 0, drop2: 0, outro: 2},
    prog: [0, 0, -2, -5], bell: [[0, 12], [2, 12], [3, 15], [6, 12], [8, 10], [10, 12], [11, 15], [14, 17]], bellGain: 0.2, padGain: 0.05},
  trailer: {bpm: 90, key: 36, half: true, bars: {intro: 4, build: 2, drop: 6, brk: 1, drop2: 3, outro: 1},
    prog: [0, -4, -2, -5], bell: [], bellGain: 0, padGain: 0.14, boom: true},
};
export const MUSIC_STYLES = Object.keys(STYLES);

// детерминированный шум (одинаковый трек при тех же настройках)
let seed = 1;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };

export function synth(style = 'aura', {variant = 0} = {}) {
  const S = STYLES[style] || STYLES.aura;
  seed = 12345 + variant * 777;
  const beat = 60 / S.bpm, step = beat / 4, bar = beat * 4;
  const secs = Object.entries(S.bars).flatMap(([k, n]) => Array(n).fill(k));   // раздел каждого такта
  const total = secs.length * bar + 2;
  const n = Math.ceil(total * SR), L = new Float32Array(n), R = new Float32Array(n), send = new Float32Array(n);
  const add = (buf, t0, fn, dur, g = 1) => {
    const a = Math.floor(t0 * SR), b = Math.min(n, a + Math.floor(dur * SR));
    for (let i = Math.max(0, a); i < b; i++) buf[i] += g * fn((i - a) / SR);
  };
  const both = (t0, fn, dur, g = 1, pan = 0) => { add(L, t0, fn, dur, g * (1 - pan)); add(R, t0, fn, dur, g * (1 + pan)); };
  const kickTimes = [];
  const kick = (t, g = 1) => { kickTimes.push(t); both(t, x => Math.sin(2 * Math.PI * (45 * x + (110 / 30) * (1 - Math.exp(-30 * x)))) * Math.exp(-7 * x) * 0.95, 0.6, g); };
  const clap = (t, g = 1) => { both(t, x => (noise() * 0.8 + Math.sin(2 * Math.PI * 190 * x) * 0.3) * Math.exp(-18 * x), 0.35, 0.42 * g); add(send, t, x => noise() * Math.exp(-14 * x), 0.4, 0.25 * g); };
  let hp = 0;
  const hat = (t, g = 1) => both(t, x => { const v = noise(); const o = v - hp; hp = v; return o * Math.exp(-55 * x); }, 0.09, 0.09 * g, (noise() * 0.3));
  // коубелл (как у Roland 808): два прямоугольника 1 : 1,48, настроенные на ноту
  const bell = (t, m, g = 1) => {
    const f = hz(m), fn = x => (Math.sign(Math.sin(2 * Math.PI * f * x)) + 0.65 * Math.sign(Math.sin(2 * Math.PI * f * 1.48 * x))) * Math.exp(-11 * x);
    both(t, fn, 0.5, S.bellGain * g * 0.5, -0.15); add(send, t, fn, 0.5, S.bellGain * g * 0.35);
  };
  // 808: синус с перегрузом, нота скользит к следующей
  const sub = (t, m, m2, dur, g = 1) => {
    const f1 = hz(m), f2 = hz(m2 ?? m);
    let ph = 0;
    both(t, x => { const k = Math.min(1, Math.max(0, (x - dur * 0.7) / (dur * 0.3))); ph += 2 * Math.PI * (f1 + (f2 - f1) * k * k) / SR; return Math.tanh(2.6 * Math.sin(ph)) * Math.min(1, x * 80) * Math.exp(-0.7 * x); }, dur, 0.5 * g);
  };
  // пэд: мягкий аккорд из синусов с медленной атакой
  const pad = (t, m, dur, g = 1) => {
    const ns = [m + 24, m + 27, m + 31, m + 36];
    both(t, x => ns.reduce((s, q, i) => s + Math.sin(2 * Math.PI * hz(q) * x + i) * (i ? 0.6 : 1), 0) * Math.min(1, x / 0.8) * Math.min(1, (dur - x) / 0.6) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.3 * x)), dur, S.padGain * g);
  };
  // нарастание: шум + свист вверх; низкий «бум» на дропе (trailer — гулкий удар)
  const riser = (t, dur) => both(t, x => (noise() * 0.5 + Math.sin(2 * Math.PI * (200 + 1800 * (x / dur) ** 2) * x) * 0.3) * (x / dur) ** 2, dur, 0.28);
  const boom = t => both(t, x => (Math.sin(2 * Math.PI * (38 + 40 * Math.exp(-6 * x)) * x) * 1.0 + noise() * Math.exp(-20 * x) * 0.5) * Math.exp(-1.8 * x), 3, 0.7);

  let drop = null;
  secs.forEach((sec, b) => {
    const t0 = b * bar, root = S.key + S.prog[b % S.prog.length], nextRoot = S.key + S.prog[(b + 1) % S.prog.length];
    const full = sec === 'drop' || sec === 'drop2';
    const lastBuild = sec === 'build' && secs[b + 1] !== 'build';
    if (full && secs[b - 1] !== sec && drop === null) drop = t0;
    if (full && secs[b - 1] !== sec) { if (S.boom) boom(t0); kick(t0, 1.1); }
    if (sec !== 'outro') pad(t0, root, bar + 0.4, full ? 0.7 : 1);
    if (sec === 'build') { riser(t0, bar); for (let k = 0; k < 8; k++) hat(t0 + k * beat / 2, 0.6 + k * 0.05); }
    if (lastBuild) {   // тишина на последнюю долю перед дропом — «вдох»
      const a = Math.floor((t0 + bar - beat) * SR), e = Math.floor((t0 + bar) * SR);
      for (let i = a; i < e && i < n; i++) { L[i] *= 0.05; R[i] *= 0.05; send[i] *= 0.05; }
      return;
    }
    if (sec === 'intro' || sec === 'brk') {
      S.bell.forEach(([s, d], i) => i % 2 === 0 && bell(t0 + s * step, root + 24 + d, 0.6));
      if (S.boom && sec === 'intro' && b % 2 === 0) boom(t0);
      return;
    }
    if (!full) return;
    // барабаны
    if (S.half) { kick(t0); kick(t0 + 10 * step, 0.8); clap(t0 + 8 * step); if (S.boom) clap(t0 + 14 * step, 0.5); }
    else { for (const s of [0, 6, 10]) kick(t0 + s * step, s ? 0.85 : 1); clap(t0 + 4 * step); clap(t0 + 12 * step); }
    for (let s = 0; s < 16; s += 2) hat(t0 + s * step, s % 4 ? 0.6 : 1);
    // 808 по аккордам: две ноты на такт, последняя скользит к следующему корню
    sub(t0, root, root, bar / 2);
    sub(t0 + bar / 2, root, nextRoot, bar / 2);
    S.bell.forEach(([s, d]) => bell(t0 + s * step, root + 24 + d + (variant % 2 && s > 8 ? 2 : 0)));
  });
  // «насос»: всё, кроме бочки, уступает каждому удару бочки
  for (const kt of kickTimes) {
    const a = Math.floor(kt * SR), b = Math.min(n, a + Math.floor(0.25 * SR));
    for (let i = a + 1; i < b; i++) { const d = 1 - 0.45 * Math.exp(-((i - a) / SR) * 14); L[i] *= d; R[i] *= d; }
  }
  // эхо (три линии задержки) для хлопка и коубелла
  const taps = [[0.23, 0.35], [0.37, 0.25], [0.61, 0.18]];
  for (const [d, g] of taps) {
    const k = Math.floor(d * SR);
    for (let i = k; i < n; i++) { const v = send[i - k] * g; L[i] += v; R[i] += v * 0.9; send[i] += v * 0.4; }
  }
  // мягкое ограничение
  for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * 0.9); R[i] = Math.tanh(R[i] * 0.9); }
  return {L, R, bpm: S.bpm, drop, duration: total};
}

function wav(L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32000), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32000), 46 + i * 4); }
  return buf;
}

// трек в файл (mp3, −14 LUFS): outDir/music/freefield-<style>-<bpm>bpm[-v].mp3
export async function makeTrack(style, {outRoot, variant = 0} = {}) {
  const r = synth(style, {variant});
  const dir = path.join(outRoot, 'music');
  fs.mkdirSync(dir, {recursive: true});
  const tmp = path.join(dir, `.synth-${Date.now()}.wav`), out = path.join(dir, `freefield-${style}-${r.bpm}bpm${variant ? '-' + variant : ''}.mp3`);
  fs.writeFileSync(tmp, wav(r.L, r.R));
  try { await ff(['-i', tmp, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9,aresample=44100', '-c:a', 'libmp3lame', '-b:a', '192k', out], 'трек'); }
  finally { fs.rmSync(tmp, {force: true}); }
  // точный темп и дроп — рядом с треком (analyze.trackBeats берёт их вместо поиска на слух: у половинного ритма темп легко спутать)
  const meta = {bpm: r.bpm, offset: 0, drop: +r.drop.toFixed(3), style};
  fs.writeFileSync(out + '.json', JSON.stringify(meta));
  return {path: out, style, bpm: r.bpm, drop: +r.drop.toFixed(2), duration: +r.duration.toFixed(1)};
}
