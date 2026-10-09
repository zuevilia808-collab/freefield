// Моушн-графика монтажа: HTML-страница с покадровой анимацией (бесплатно, без Remotion).
// montage.js открывает её в Chrome без окна, для каждого кадра зовёт FRAME(t) и снимает прозрачный PNG → ffmpeg кладёт поверх видео.
// FRAME(t) — чистая функция времени: тот же t → тот же кадр; возвращает «ключ» кадра — одинаковые кадры не снимаются дважды.
// Стили: titles (титры), cards (карточки), launch (запуск продукта), none; субтитры по словам — во всех.
export const STYLES = {
  titles: 'Титры: кинетический заголовок в начале, финальная надпись/призыв в конце',
  cards: 'Карточки: заголовок + 2–4 карточки с тезисами по ходу ролика + призыв в конце',
  launch: 'Запуск продукта: «NEW», имя продукта, фишки на бит, кнопка-призыв пульсирует в ритм',
  none: 'Без графики — только субтитры',
};

export const gfxHtml = () => String.raw`<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@500;600;800&family=Unbounded:wght@600;800;900&display=block" rel="stylesheet">
<style>
:root{--lime:#d4ff3a;--ink:#0b0d08;--display:'Unbounded',system-ui,sans-serif;--font:'Onest',system-ui,sans-serif}
html,body{margin:0;background:transparent;overflow:hidden}
#stage{position:relative;overflow:hidden}
.abs{position:absolute;left:0;top:0;will-change:transform,opacity}
.cap{left:7%;right:7%;text-align:center;font-family:var(--display);font-weight:800;text-transform:uppercase;line-height:1.12;letter-spacing:-.01em}
.w{display:inline-block;margin:0 .14em;color:#fff;paint-order:stroke fill;-webkit-text-stroke:.09em #000;
   text-shadow:0 .06em .22em rgba(0,0,0,.55)}
.title{left:6%;right:6%;text-align:center;font-family:var(--display);font-weight:900;color:#fff;line-height:1.02;letter-spacing:-.025em;text-shadow:0 .05em .3em rgba(0,0,0,.45)}
.tw{display:inline-block;margin:0 .12em}
.sub{left:0;right:0;text-align:center;font-family:var(--font);font-weight:600;color:#fff}
.sub span{display:inline-block;background:rgba(12,14,10,.78);border-radius:.5em;padding:.25em .7em}
.bar{height:.16em;background:var(--lime);border-radius:99px;transform-origin:0 50%}
.card{left:6%;width:74%;display:flex;gap:.7em;align-items:center;padding:.8em 1em;border-radius:.9em;background:rgba(12,14,10,.78);
   border:2px solid rgba(212,255,58,.55);color:#fff;font-family:var(--font);font-weight:600;line-height:1.2;box-shadow:0 .4em 1.6em rgba(0,0,0,.45)}
.num{flex:none;font-family:var(--display);font-weight:900;color:var(--ink);background:var(--lime);border-radius:.45em;padding:.25em .45em;font-size:.9em}
.pill{font-family:var(--display);font-weight:800;color:var(--ink);background:var(--lime);border-radius:99px;padding:.32em .9em;letter-spacing:.04em}
.chip{font-family:var(--font);font-weight:800;color:#fff;background:rgba(12,14,10,.8);border:2px solid var(--lime);border-radius:99px;padding:.45em 1em;white-space:nowrap}
.cta{font-family:var(--display);font-weight:900;color:var(--ink);background:var(--lime);border-radius:99px;padding:.6em 1.3em;white-space:nowrap;box-shadow:0 0 0 .18em rgba(212,255,58,.25),0 .5em 2em rgba(0,0,0,.5)}
.small{font-family:var(--font);font-weight:600;color:#fff;opacity:.9;text-shadow:0 2px 12px rgba(0,0,0,.7)}
.shade{left:0;top:0;width:100%;height:100%;background:linear-gradient(180deg,rgba(0,0,0,.0) 25%,rgba(0,0,0,.62) 100%)}
.grid{left:-50%;width:200%;transform-origin:50% 0;
   background-image:linear-gradient(rgba(212,255,58,.85) 2px,transparent 2px),linear-gradient(90deg,rgba(212,255,58,.85) 2px,transparent 2px)}
.flash{left:0;top:0;width:100%;height:100%;background:#fff}
</style></head><body><div id="stage"></div>
<script>
const $ = (cls, html = '') => { const e = document.createElement('div'); e.className = 'abs ' + cls; e.innerHTML = html; S.appendChild(e); return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const P = (t, a, b) => clamp((t - a) / (b - a));
const eo = x => 1 - Math.pow(1 - x, 3), ei = x => x * x * x;
const back = x => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
let S, C, W, H, U, KEY = [];
// одна запись стиля = часть ключа кадра
function st(el, o) { for (const k in o) { const v = typeof o[k] === 'number' ? +o[k].toFixed(3) : o[k]; KEY.push(v); el.style[k] = v; } }
const show = (el, op, tf) => st(el, {opacity: op, transform: tf || 'none', visibility: op > 0.002 ? 'visible' : 'hidden'});
const lastBeat = t => { let b = -9; for (const x of C.beats) { if (x <= t + 1e-4) b = x; else break; } return b; };
const pulse = (t, k = 9) => Math.exp(-Math.max(0, t - lastBeat(t)) * k);
const beatAfter = t => C.beats.find(x => x >= t) ?? t;
const parts = [];

window.SETUP = cfg => {
  C = cfg; W = cfg.W; H = cfg.H; U = Math.min(W, H) / 100;   // U — 1% короткой стороны
  S = document.getElementById('stage');
  Object.assign(S.style, {width: W + 'px', height: H + 'px', fontSize: (U * 4) + 'px'});
  const T = cfg.duration, style = cfg.style;
  const intro = cfg.title ? (style === 'launch' ? 3.2 : 2.7) : 0;
  const outroAt = T - (style === 'none' ? 0 : 2.6);

  // ---- общий финал: затемнение снизу + призыв/заголовок ----
  if (style !== 'none' && (cfg.cta || cfg.title)) {
    const shade = $('shade');
    const big = $('title', (cfg.cta || cfg.title).split(/\s+/).map(w => '<span class="tw">' + esc(w) + '</span>').join(' '));
    const ws = [...big.querySelectorAll('.tw')];
    const bar = $('bar');
    let btn = null, small = null;
    if (style === 'launch') { big.remove(); btn = $('cta', esc(cfg.cta || 'Попробовать') + ' →'); small = $('small', esc(cfg.subtitle || 'ссылка в профиле')); }
    Object.assign(big.style, {top: (H * 0.40) + 'px', fontSize: (U * (style === 'titles' ? 9.5 : 8.5)) + 'px'});
    Object.assign(bar.style, {left: (W * 0.3) + 'px', top: (H * 0.40 + big.offsetHeight + U * 2.5) + 'px', width: (W * 0.4) + 'px', fontSize: U * 8 + 'px'});
    if (btn) { btn.style.fontSize = U * 7 + 'px'; small.style.fontSize = U * 4.2 + 'px'; }
    parts.push(t => {
      const a = P(t, outroAt, outroAt + 0.5);
      show(shade, eo(a));
      if (btn) {
        const r = {width: btn.offsetWidth}, r2 = {width: small.offsetWidth};
        const pin = back(P(t, outroAt + 0.1, outroAt + 0.55)), beat = t > outroAt + 0.6 ? pulse(t, 7) : 0;
        show(btn, pin > 0 ? clamp(pin * 1.5) : 0, 'translate(' + ((W - r.width) / 2) + 'px,' + (H * 0.44) + 'px) scale(' + (0.4 + 0.6 * pin + 0.07 * beat) + ')');
        show(small, eo(P(t, outroAt + 0.5, outroAt + 0.9)), 'translate(' + ((W - r2.width) / 2) + 'px,' + (H * 0.44 + btn.offsetHeight + U * 3 + 18 * (1 - eo(P(t, outroAt + 0.5, outroAt + 0.9)))) + 'px)');
        show(bar, 0);
        return;
      }
      ws.forEach((w, i) => { const q = eo(P(t, outroAt + 0.12 + i * 0.07, outroAt + 0.5 + i * 0.07));
        st(w, {opacity: q, transform: 'translateY(' + (1 - q) * 0.5 + 'em)', filter: 'blur(' + (1 - q) * 8 + 'px)'}); });
      show(big, a > 0 ? 1 : 0);
      show(bar, eo(P(t, outroAt + 0.45, outroAt + 0.9)) > 0 ? 1 : 0, 'scaleX(' + eo(P(t, outroAt + 0.45, outroAt + 0.9)) + ')');
    });
  }

  // ---- вступление ----
  if (intro && style !== 'none') {
    if (style === 'launch') {
      const grid = $('grid'), badge = $('pill', 'NEW'), flash = $('flash');
      const name = $('title', esc(cfg.title)), sub = cfg.subtitle ? $('sub', '<span>' + esc(cfg.subtitle) + '</span>') : null;
      const gs = U * 9;
      Object.assign(grid.style, {top: (H * 0.62) + 'px', height: (H * 0.7) + 'px', backgroundSize: gs + 'px ' + gs + 'px'});
      Object.assign(name.style, {top: (H * 0.36) + 'px', fontSize: (U * 12) + 'px'});
      badge.style.fontSize = U * 4.4 + 'px';
      if (sub) Object.assign(sub.style, {top: (H * 0.36 + U * 19) + 'px', fontSize: (U * 5) + 'px'});
      const b1 = beatAfter(0.25);
      parts.push(t => {
        const out = P(t, intro - 0.45, intro);
        const g = eo(P(t, 0, 0.9));
        show(grid, (1 - out) * 0.9 * g, 'perspective(' + (H * 0.5) + 'px) rotateX(64deg) translateY(' + (-(t * gs * 2.2) % gs) + 'px)');
        const bp = back(P(t, b1, b1 + 0.3)), r = {width: badge.offsetWidth};
        show(badge, P(t, b1, b1 + 0.08) * (1 - out), 'translate(' + ((W - r.width) / 2) + 'px,' + (H * 0.28) + 'px) scale(' + bp + ')');
        const n = eo(P(t, b1 + 0.1, b1 + 0.9));
        show(name, n * (1 - out), 'translateY(' + (-out * U * 10) + 'px)');
        st(name, {letterSpacing: (0.55 * (1 - n) - 0.025) + 'em', filter: 'blur(' + (1 - n) * 10 + 'px)'});
        if (sub) show(sub, eo(P(t, b1 + 0.6, b1 + 1.1)) * (1 - out), 'translateY(' + ((1 - eo(P(t, b1 + 0.6, b1 + 1.1))) * U * 4 - out * U * 10) + 'px)');
        show(flash, 0.85 * Math.exp(-Math.max(0, t - b1) * 14) * (t >= b1 ? 1 : 0));
      });
    } else {
      const ttl = $('title', esc(cfg.title).split(/\s+/).map(w => '<span class="tw">' + w + '</span>').join(' '));
      const ws = [...ttl.querySelectorAll('.tw')];
      const bar = $('bar'), sub = cfg.subtitle ? $('sub', '<span>' + esc(cfg.subtitle) + '</span>') : null;
      const top = style === 'cards' ? 0.2 : 0.34, fs = U * (style === 'cards' ? 9 : 11);
      Object.assign(ttl.style, {top: (H * top) + 'px', fontSize: fs + 'px'});
      Object.assign(bar.style, {left: (W * 0.32) + 'px', width: (W * 0.36) + 'px', fontSize: fs + 'px'});
      if (sub) Object.assign(sub.style, {fontSize: (U * 5) + 'px'});
      parts.push(t => {
        const out = P(t, intro - 0.4, intro);
        const h = ttl.offsetHeight;
        ws.forEach((w, i) => { const q = eo(P(t, 0.05 + i * 0.09, 0.5 + i * 0.09));
          st(w, {opacity: q, transform: 'translateY(' + (1 - q) * 0.6 + 'em) rotate(' + (1 - q) * 4 + 'deg)', filter: 'blur(' + (1 - q) * 10 + 'px)'}); });
        show(ttl, 1 - out, 'translateY(' + (-ei(out) * U * 14) + 'px)');
        const b = eo(P(t, 0.35, 0.8));
        st(bar, {top: (H * top + h + U * 2 - ei(out) * U * 14) + 'px'});
        show(bar, b > 0 ? 1 - out : 0, 'scaleX(' + b + ')');
        if (sub) { const q = eo(P(t, 0.55, 1)); st(sub, {top: (H * top + h + U * 6) + 'px'}); show(sub, q * (1 - out), 'translateY(' + ((1 - q) * U * 3 - ei(out) * U * 14) + 'px)'); }
      });
    }
  }

  // ---- середина: карточки / фишки на бит ----
  const mid = (cfg.items || []).filter(Boolean).slice(0, 5);
  if (mid.length && (style === 'cards' || style === 'launch')) {
    const a0 = intro + 0.3, a1 = outroAt - 0.3, slot = (a1 - a0) / mid.length;
    if (style === 'cards') {
      mid.forEach((txt, i) => {
        const el = $('card', '<span class="num">' + String(i + 1).padStart(2, '0') + '</span><span>' + esc(txt) + '</span>');
        Object.assign(el.style, {top: (H * 0.12) + 'px', fontSize: (U * 5.4) + 'px'});
        const s0 = beatAfter(a0 + i * slot), s1 = a0 + (i + 1) * slot - 0.1;
        parts.push(t => {
          const inn = back(P(t, s0, s0 + 0.42)), out = eo(P(t, s1 - 0.28, s1));
          show(el, t >= s0 && t < s1 ? clamp(P(t, s0, s0 + 0.12)) * (1 - out) : 0,
            'translateX(' + ((1 - inn) * -W * 0.9 + out * W * 0.25) + 'px) rotate(' + (1 - inn) * -3 + 'deg)');
        });
      });
    } else {
      const chips = mid.map(txt => { const el = $('chip', esc(txt)); el.style.fontSize = U * 5 + 'px'; return el; });
      const s0 = a0, beatsIn = C.beats.filter(b => b >= s0 && b < a1);
      const step = Math.max(1, Math.floor(beatsIn.length / (mid.length + 1)));
      const at = mid.map((_, i) => beatsIn[i * step] ?? s0 + i * 0.5);
      parts.push(t => {
        const out = P(t, a1 - 0.3, a1);
        let y = H * 0.13;
        chips.forEach((el, i) => {
          const q = back(P(t, at[i], at[i] + 0.35));
          const hit = Math.exp(-Math.max(0, t - at[i]) * 10) * (t >= at[i] ? 1 : 0);
          show(el, t >= at[i] ? (1 - out) : 0, 'translate(' + (U * 6) + 'px,' + y + 'px) scale(' + (q * (1 + 0.08 * hit)) + ')');
          st(el, {transformOrigin: '0 50%'});
          y += el.offsetHeight + U * 2.4;
        });
      });
    }
  }

  // ---- субтитры по словам ----
  const pages = [];
  if (cfg.captions && cfg.words?.length) {
    let cur = [];
    const flush = () => { if (cur.length) pages.push(cur); cur = []; };
    for (const w of cfg.words) {
      const prev = cur[cur.length - 1];
      const len = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
      if (prev && (w.start - prev.end > 0.45 || len > 18 || cur.length >= 3 || /[.!?…]$/.test(prev.text))) flush();
      cur.push(w);
    }
    flush();
    const box = $('cap');
    Object.assign(box.style, {top: (H * (H > W ? 0.66 : 0.72)) + 'px', fontSize: (U * (H > W ? 7.2 : 5.6)) + 'px'});
    parts.push(t => {
      // страница: от первого слова до начала следующей (не дольше 0,6 с после последнего слова)
      let pi = -1;
      for (let i = 0; i < pages.length; i++) {
        const a = pages[i][0].start - 0.06, b = Math.min(pages[i + 1] ? pages[i + 1][0].start - 0.06 : 1e9, pages[i][pages[i].length - 1].end + 0.6);
        if (t >= a && t < b) { pi = i; break; }
      }
      if (t > outroAt - 0.1 && style !== 'none') pi = -1;   // на финальной надписи субтитры не мешают
      if (pi < 0) { show(box, 0); return; }
      if (box.dataset.p !== String(pi)) { box.dataset.p = pi; box.innerHTML = pages[pi].map(w => '<span class="w">' + esc(w.text) + '</span>').join(' '); }
      KEY.push('p' + pi);
      show(box, 1);
      [...box.children].forEach((el, i) => {
        const w = pages[pi][i], q = P(t, w.start - 0.04, w.start + 0.14);
        const nx = pages[pi][i + 1], on = t >= w.start - 0.04 && t < (nx ? nx.start - 0.04 : w.end + 0.35);   // горит одно слово — то, что звучит
        st(el, {opacity: q > 0 ? 1 : 0.0, transform: 'translateY(' + (1 - eo(q)) * 0.35 + 'em) scale(' + (q > 0 ? (0.55 + 0.45 * back(q)) * (on ? 1.06 : 1) : 0.55) + ')',
          color: on ? 'var(--lime)' : '#fff'});
      });
    });
  }
};

window.FRAME = t => { KEY = []; for (const f of parts) f(t); return KEY.join('|'); };
window.EMPTY = () => !S || [...S.children].every(e => e.style.visibility === 'hidden');
</script></body></html>`;
