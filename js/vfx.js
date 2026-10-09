'use strict';
/* ---- эффекты голоса (пользователь 2026-10-09: «голосу задать много параметров, чтобы изменить его и он не был похож»).
   Только то, что не сдвигает речь по времени — губы в ролике совпадают: высота (PSOLA по найденному тону — тембр на месте),
   «размер голоса» (сдвиг формант), низкие/высокие, хрипотца, пространство, телефон/радио/робот/мегафон.
   Тяжёлое (тон, PSOLA) считается в отдельном потоке (Web Worker) — монтаж не подтормаживает. Тот же PSOLA растягивает
   озвучку по длине исходной реплики без смены высоты ---- */
const VFX_DEF = {pitch: 0, formant: 0, low: 0, high: 0, rasp: 0, room: 0, kind: 'none'};
const VFX_KINDS = [['none', 'Нет'], ['phone', '📞 Телефон'], ['radio', '📻 Радио'], ['robot', '🤖 Робот'], ['mega', '📢 Мегафон']];
const VFX_PRESETS = [
  ['anon', '🕶 Неузнаваемый', {pitch: -2, formant: -12, low: 3, rasp: 15}],
  ['low', '⬇ Ниже', {pitch: -4, formant: -8}],
  ['high', '⬆ Выше', {pitch: 4, formant: 8}],
  ['old', '👴 Старше', {pitch: -2, formant: -6, rasp: 25, high: -3}],
  ['young', '🧒 Моложе', {pitch: 5, formant: 15, high: 2}],
  ['robot', '🤖 Робот', {kind: 'robot'}],
  ['phone', '📞 Телефон', {kind: 'phone'}],
];
const vfxNorm = fx => ({...VFX_DEF, ...(fx || {})});
const vfxIsDef = fx => { const f = vfxNorm(fx); return Object.keys(VFX_DEF).every(k => f[k] === VFX_DEF[k]); };
const vfxKey = fx => JSON.stringify(Object.keys(VFX_DEF).map(k => vfxNorm(fx)[k]));

// DSP — одна функция: её текст уходит в поток, а без потоков (старый браузер) она же работает здесь
function vfxDsp() {
  // период основного тона (в отсчётах) каждые hop отсчётов; 0 — без тона (согласные, тишина). YIN на ~11 кГц
  function periods(x, sr, hop) {
    const dec = Math.max(1, Math.floor(sr / 11025)), r = sr / dec, n = Math.floor(x.length / dec), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < dec; j++) s += x[i * dec + j]; y[i] = s / dec; }
    const W = Math.round(r * 0.03), tmin = Math.floor(r / 500), tmax = Math.ceil(r / 65);
    const frames = Math.ceil(x.length / hop), out = new Float32Array(frames), d = new Float32Array(tmax + 2);
    let top = 0;
    for (let i = 0; i < n; i++) top = Math.max(top, Math.abs(y[i]));
    for (let f = 0; f < frames; f++) {
      const s0 = Math.floor(f * hop / dec) - (W >> 1);
      if (s0 < 0 || s0 + W + tmax + 1 >= n) continue;
      let e = 0;
      for (let j = 0; j < W; j++) e += y[s0 + j] * y[s0 + j];
      if (Math.sqrt(e / W) < top * 0.03) continue;
      let run = 0, best = 0;
      d[0] = 1;
      for (let t = 1; t <= tmax + 1; t++) {
        let s = 0;
        for (let j = 0; j < W; j++) { const v = y[s0 + j] - y[s0 + j + t]; s += v * v; }
        run += s; d[t] = run ? s * t / run : 1;
      }
      for (let t = tmin; t <= tmax; t++) if (d[t] < 0.15) { while (t < tmax && d[t + 1] < d[t]) t++; best = t; break; }
      if (!best) continue;
      const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c;   // дробная часть — по параболе
      out[f] = (best + (den > 0 ? 0.5 * (a - c) / den : 0)) * dec;
    }
    for (let f = 1; f + 1 < frames; f++) if (!out[f] && out[f - 1] && out[f + 1]) out[f] = (out[f - 1] + out[f + 1]) / 2;   // дырки в тоне
    return out;
  }
  // PSOLA: k — во сколько раз выше тон, stretch — во сколько раз длиннее; тембр (форманты) остаётся
  function psola(x, sr, k, stretch) {
    const hop = Math.round(sr * 0.005), per = periods(x, sr, hop), UV = Math.round(sr * 0.008);
    const P = t => per[Math.min(per.length - 1, Math.max(0, Math.round(t / hop)))];
    const marks = [], mp = [];
    for (let t = 0; t < x.length;) { const p = P(t); marks.push(t); mp.push(p); t += Math.max(16, Math.round(p) || UV); }
    const N = Math.max(1, Math.round(x.length * stretch)), out = new Float32Array(N), ws = new Float32Array(N);
    let i = 0;
    for (let s = 0; s < N;) {
      const ta = s / stretch;
      while (i + 1 < marks.length && Math.abs(marks[i + 1] - ta) <= Math.abs(marks[i] - ta)) i++;
      const p = mp[i], L = Math.max(16, Math.round(p) || UV), c = marks[i], sc = Math.round(s);
      for (let j = -L; j < L; j++) {
        const a = c + j, b = sc + j;
        if (a < 0 || a >= x.length || b < 0 || b >= N) continue;
        const w = 0.5 + 0.5 * Math.cos(Math.PI * j / L);
        out[b] += x[a] * w; ws[b] += w;
      }
      s += p ? p / k : L;
    }
    for (let n = 0; n < N; n++) if (ws[n] > 1) out[n] /= ws[n];
    return out;
  }
  // передискретизация: читаем в f раз быстрее — короче в f раз, тон и форманты выше в f раз
  function resample(x, f) {
    const N = Math.max(1, Math.floor(x.length / f)), y = new Float32Array(N);
    for (let n = 0; n < N; n++) { const t = n * f, i = Math.floor(t), u = t - i; y[n] = (x[i] || 0) * (1 - u) + (x[i + 1] || 0) * u; }
    return y;
  }
  const rmsOf = x => { let s = 0; for (let i = 0; i < x.length; i += 2) s += x[i] * x[i]; return Math.sqrt(s / Math.ceil(x.length / 2)) || 0; };
  function run(m) {
    const {op, x, sr} = m;
    let y;
    if (op === 'shift') {   // тон × k, форманты × f, длина та же
      y = m.f !== 1 ? psola(resample(x, m.f), sr, m.k / m.f, x.length / Math.max(1, Math.floor(x.length / m.f))) : psola(x, sr, m.k, 1);
      if (y.length !== x.length) { const z = new Float32Array(x.length); z.set(y.subarray(0, x.length)); y = z; }
    } else y = psola(x, sr, 1, m.ratio);   // stretch: длина × ratio, тон тот же
    const g = rmsOf(x) / (rmsOf(y) || 1);
    if (g && isFinite(g)) for (let i = 0; i < y.length; i++) y[i] *= g;
    return y;
  }
  return {run, periods};
}
const vfxLocal = vfxDsp();
let vfxW = null, vfxSeq = 0;
const vfxWait = new Map();
function vfxWorker() {
  if (vfxW === null) {
    try {
      vfxW = new Worker(URL.createObjectURL(new Blob([`const D = (${vfxDsp})(); onmessage = e => { try { const y = D.run(e.data); postMessage({id: e.data.id, y}, [y.buffer]); } catch (er) { postMessage({id: e.data.id, err: String(er.message || er)}); } };`], {type: 'text/javascript'})));
      vfxW.onmessage = e => { const w = vfxWait.get(e.data.id); vfxWait.delete(e.data.id); if (w) e.data.err ? w[1](new Error(e.data.err)) : w[0](e.data.y); };
      vfxW.onerror = () => { vfxWait.forEach(w => w[1](new Error('обработка звука не запустилась'))); vfxWait.clear(); vfxW = false; };
    } catch { vfxW = false; }
  }
  return vfxW;
}
function vfxRun(m) {
  const w = vfxWorker();
  if (!w) return Promise.resolve(vfxLocal.run(m));
  return new Promise((res, rej) => { const id = ++vfxSeq; vfxWait.set(id, [res, rej]); w.postMessage({...m, id}, [m.x.buffer]); });
}
const vfxMono = buf => {
  const n = buf.length, x = new Float32Array(n), ch = buf.numberOfChannels;
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / ch; }
  return x;
};
const vfxBuf = (x, sr) => { const b = new AudioBuffer({numberOfChannels: 1, length: Math.max(1, x.length), sampleRate: sr}); b.copyToChannel(x, 0); return b; };
// озвучка → длина × ratio без смены высоты
async function vfxStretch(buf, ratio) {
  return vfxBuf(await vfxRun({op: 'stretch', x: vfxMono(buf), sr: buf.sampleRate, ratio}), buf.sampleRate);
}
// голос → голос с эффектами (моно, та же длина)
async function vfxRender(buf, fx) {
  const f = vfxNorm(fx), sr = buf.sampleRate;
  if (vfxIsDef(f)) return buf;
  let x = vfxMono(buf);
  const rms = a => { let s = 0; for (let i = 0; i < a.length; i += 2) s += a[i] * a[i]; return Math.sqrt(s / Math.ceil(a.length / 2)) || 0; };
  const level = rms(x);
  if (f.pitch || f.formant) x = await vfxRun({op: 'shift', x, sr, k: 2 ** (f.pitch / 12), f: 1 + f.formant / 100});
  const len = x.length, ctx = new OfflineAudioContext(1, len, sr), src = ctx.createBufferSource();
  src.buffer = vfxBuf(x, sr);
  const chain = [];
  const bq = (type, freq, gain = 0, Q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.gain.value = gain; b.Q.value = Q; chain.push(b); return b; };
  if (f.low) bq('lowshelf', 220, f.low);
  if (f.high) bq('highshelf', 3500, f.high);
  let drive = f.rasp ? 1 + f.rasp / 12 : 0;
  if (f.kind === 'phone') { bq('highpass', 450); bq('lowpass', 3200); drive = Math.max(drive, 2); }
  if (f.kind === 'radio') { bq('highpass', 300); bq('lowpass', 4500); bq('peaking', 1500, 6, 1); drive = Math.max(drive, 2.5); }
  if (f.kind === 'mega') { bq('highpass', 550); bq('bandpass', 1700, 0, 0.9); drive = Math.max(drive, 5); }
  if (drive) {
    const sh = ctx.createWaveShaper(), c = new Float32Array(1025), t = Math.tanh(drive);
    for (let i = 0; i < c.length; i++) { const v = i / 512 - 1; c[i] = Math.tanh(drive * v) / t; }
    sh.curve = c; sh.oversample = '2x'; chain.push(sh);
  }
  let node = src;
  for (const n of chain) { node.connect(n); node = n; }
  if (f.kind === 'robot') {   // кольцевая модуляция — «металлический» голос
    const g = ctx.createGain(), o = ctx.createOscillator();
    g.gain.value = 0; o.frequency.value = 60; o.connect(g.gain); o.start(0);
    node.connect(g); node = g;
  }
  const out = ctx.createGain();
  if (f.room) {   // пространство: отклик комнаты — шум с затуханием
    const wet = f.room / 100, cv = ctx.createConvolver(), L = Math.round(sr * (0.5 + wet * 1.3)), ir = ctx.createBuffer(2, L, sr);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < L; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * (0.12 + wet * 0.4))); }
    cv.buffer = ir;
    const dry = ctx.createGain(), wg = ctx.createGain();
    dry.gain.value = 1 - wet * 0.45; wg.gain.value = wet * 0.6;
    node.connect(dry).connect(out); node.connect(cv).connect(wg).connect(out);
  } else node.connect(out);
  out.connect(ctx.destination);
  src.start(0);
  const res = await ctx.startRendering(), d = res.getChannelData(0), g = level / (rms(d) || 1);
  if (g && isFinite(g)) for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * g));   // громкость — как была
  return res;
}
