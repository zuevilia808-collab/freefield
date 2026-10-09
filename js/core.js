'use strict';
/* =============================== иконки =============================== */
// Свой набор SVG-иконок (#i-… в начале страницы). ic('name') — иконка в разметке. Эмодзи в текстах интерфейса
// (кнопки, подсказки, уведомления) сами меняются на иконки того же смысла — так весь интерфейс в одном стиле.
// Пользовательские тексты (промпты, ответы ИИ, код) не трогаем.
const ic = (name, cls = '') => `<svg class="ic ic-${name}${name === 'dot' ? ' ic-dot' : ''}${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const ICON_OF = {
  '🖼': 'image', '🎬': 'clapper', '🎥': 'video', '⏳': 'hourglass', '📋': 'copy', '✨': ['sparkles', 'c-lime'], '🔄': 'refresh', '↻': 'refresh', '↺': 'undo',
  '📎': 'clip', '💳': 'card', '🌐': 'globe', '🔑': 'key', '🎁': 'gift', '✍': 'pen', '✏': 'pen', '✎': 'pen', '⚡': ['bolt', 'c-lime'], '🎨': 'palette',
  '↗': 'external', '🟢': ['dot', 'c-ok'], '🔴': ['dot', 'c-danger'], '🟡': ['dot', 'c-warn'], '⚠': ['alert', 'c-warn'], '👁': 'eye', '📲': 'phone', '📱': 'phone',
  '👤': 'user', '🧑‍💻': 'users', '📍': ['pin', 'c-lime'], '🧍': 'sheet', '🔌': 'plug', '💻': 'laptop', '🎲': 'dice', '⛔': ['ban', 'c-danger'], '📊': 'chart',
  '✅': ['check-circle', 'c-ok'], '❌': ['x-circle', 'c-danger'], '⏱': 'timer', '🎉': ['party', 'c-lime'], '📂': 'folder', '📁': 'folder', '📥': 'inbox',
  '🗑': 'trash', '🔗': 'link', '↪': 'reroute', '🪟': 'window', '✳': 'asterisk', '⚙': 'settings', '🤗': 'smile', '💎': 'gem', '♾': 'infinity', '🐢': 'clock',
  '🗓': 'calendar', '📷': 'camera', '🔊': 'volume', '🎙': 'mic', '🎤': 'mic', '🎭': 'users', '⭐': ['star', 'c-lime'], '▶': 'play', '⏸': 'pause', '💡': ['bulb', 'c-warn'], '🚀': 'rocket', '↔': 'arrows-h',
  '🤖': 'bot', '💬': 'chat', '📐': 'ruler', '⬆': 'share', '📦': 'package', '✕': 'x', '＋': 'plus', '✓': 'check', '⤓': 'download', '✦': 'sparkle', '▦': 'grid', '🎞': 'film', '✂': 'scissors',
};
const ICON_SRC = '(' + Object.keys(ICON_OF).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\uFE0F?';
const ICON_RE = new RegExp(ICON_SRC, 'gu'), ICON_TEST = new RegExp(ICON_SRC, 'u');
const ICON_SKIP = 'textarea,input,select,option,script,style,code,pre,svg,.card-prompt,.pend-prompt,.lb-info p,.wr-blocks,.wr-raw,.ext-prompt,.wr-prompts p,[data-noicon]';
function iconNode(key) {
  const [n, c] = [].concat(ICON_OF[key]), s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  s.setAttribute('class', `ic ic-${n}${n === 'dot' ? ' ic-dot' : ''}${c ? ' ' + c : ''}`); s.setAttribute('aria-hidden', 'true');
  u.setAttribute('href', '#i-' + n); s.append(u); return s;
}
function iconize(root) {
  if (root?.nodeType === 3) root = root.parentNode;
  if (!root || root.nodeType !== 1 || root.closest(ICON_SKIP)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), hits = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) if (ICON_TEST.test(n.data) && !n.parentElement.closest(ICON_SKIP)) hits.push(n);
  for (const n of hits) {
    const f = document.createDocumentFragment(); let last = 0;
    for (const m of n.data.matchAll(ICON_RE)) { if (m.index > last) f.append(n.data.slice(last, m.index)); f.append(iconNode(m[1])); last = m.index + m[0].length; }
    if (last < n.data.length) f.append(n.data.slice(last));
    n.replaceWith(f);
  }
}
// «Таблетки» (.seg): под выбранной кнопкой — бегунок, он плавно переезжает к новой
const segThumbs = {
  raf: 0,
  schedule() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.update(); }); },
  update() {
    for (const seg of document.querySelectorAll('.seg')) {
      const on = seg.querySelector(':scope > button.on');
      let th = seg.querySelector(':scope > .seg-thumb');
      if (!on || !seg.offsetParent || !on.offsetWidth) { if (th) th.style.opacity = 0; continue; }
      const fresh = !th;
      if (fresh) { th = document.createElement('i'); th.className = 'seg-thumb'; th.style.transition = 'none'; seg.prepend(th); seg.classList.add('has-thumb'); }
      const tr = `translate(${on.offsetLeft}px,${on.offsetTop}px)`;
      if (th.style.transform !== tr || th.style.width !== on.offsetWidth + 'px') {
        if (th.style.opacity === '0') th.style.transition = 'none';   // был скрыт — встаёт на место без анимации
        th.style.width = on.offsetWidth + 'px'; th.style.height = on.offsetHeight + 'px'; th.style.transform = tr;
      }
      th.style.opacity = 1;
      if (th.style.transition === 'none') requestAnimationFrame(() => requestAnimationFrame(() => { th.style.transition = ''; }));
    }
  },
};
new MutationObserver(ms => {
  let seg = false;
  for (const m of ms) {
    if (m.type === 'characterData') iconize(m.target);
    else if (m.type === 'childList') { for (const n of m.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) iconize(n); seg = true; }
    else seg = true;
  }
  if (seg) segThumbs.schedule();
}).observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-cm', 'data-view', 'data-mode', 'data-asvc', 'data-vsource']});
iconize(document.body);
addEventListener('resize', () => segThumbs.schedule());
document.fonts?.ready.then(() => segThumbs.schedule());
/* =============================== config =============================== */


// ---------------------------------------------------------------------------
// Бесплатные кредиты на сайтах сервисов (данные на сентябрь 2026 — сервисы их меняют).
// Публичного API у них нет, поэтому генерация идёт на их сайте под вашим аккаунтом:
// Freefield готовит промпт, открывает сайт и принимает готовый файл в галерею.
// credits — сколько даёт сервис; equiv — на сколько генераций этого хватает.
const SERVICES = [
  // ---- каждый день ----
  {id: 'dola', name: 'Dola', by: 'ByteDance', url: 'https://www.dola.com/', ico: 'Do', color: 'linear-gradient(135deg,#00c2ff,#7a5cff)',
   period: 'day', credits: '≈ 50 кредитов в день (точное число Dola не публикует)', short: '≈ 50 кр./день',
   note: 'Недоступна в США, Канаде и Австралии.',
   image: {models: 'Seedream 5.0', equiv: 'Seedream 5.0 не тратит кредиты, обычно 4 варианта за раз'},
   video: {models: 'Seedance 2.5', equiv: '≈ 3–4 видео в день (по отзывам пользователей)', dur: [5, 10]}},
  {id: 'flow', name: 'Google Flow', by: 'Google', url: 'https://flow.google.com/', ico: 'FL', color: 'linear-gradient(135deg,#1a73e8,#34a853 60%,#fbbc05)',
   period: 'day', credits: '50 кредитов в день', short: '50 кр./день', ids: {image: 'ext:flow-image', video: 'ext:flow-video'},
   image: {models: 'Nano Banana', equiv: 'Nano Banana 2, 2.1 и 2 Lite не тратят кредиты; Nano Banana Pro может тратить'},
   video: {models: 'Veo 3.1', engine: 'Veo 3.1 Lite или Fast (дешевле по кредитам)', dur: [4, 6, 8],
     equiv: '5 видео Veo 3.1 Lite (10 кр.) или 2 — Fast (20 кр.); на Quality (100 кр.) не хватает'}},
  {id: 'arena', name: 'Arena', by: 'Arena (бывш. LMArena)', url: 'https://arena.ai/video', ico: 'Ar', color: 'linear-gradient(135deg,#3a3a3a,#c9a227)',
   period: 'day', credits: 'бесплатно, без кредитов — дневной лимит Arena не публикует', short: 'бесплатно',
   note: 'Arena может публиковать промпты для исследований.',
   video: {models: 'битва топ-моделей', engine: 'режим «Battle» (Veo, Kling, Seedance, Hailuo…)', dur: [5],
     equiv: '1 запрос = 2 видео от двух случайных анонимных моделей; имена моделей — после голосования'}},
  {id: 'vids', name: 'Google Vids', by: 'Google', url: 'https://docs.google.com/videos/', ico: 'GV', color: 'linear-gradient(135deg,#7b61ff,#4285f4)',
   period: 'month', credits: 'бесплатно — около 10 ИИ-видео в месяц на аккаунт Google (лимит Google)', short: '≈ 10 видео/мес.',
   ids: {video: 'ext:google-vids'}, count: {n: 10, per: 'month'},
   video: {models: 'Omni', engine: 'Omni · 720p · 10 с · со звуком', dur: [10],
     equiv: 'ИИ-видео в Google Vids: Omni, 720p, 10 секунд, со звуком, вертикально или горизонтально — примерно минута на видео'}},
  {id: 'gemini', name: 'Gemini', by: 'Google', url: 'https://gemini.google.com/', ico: 'Ge', color: 'linear-gradient(135deg,#4285f4,#9b72cb,#d96570)',
   period: 'day', credits: 'без кредитов — дневной лимит', short: '≈ 20 картинок/день',
   image: {models: 'Nano Banana 2.1', equiv: '≈ 20 картинок в день (Nano Banana Pro — 2 в день)'}},
  {id: 'aistudio', name: 'Google AI Studio', by: 'Google', url: 'https://aistudio.google.com/', ico: 'AI', color: 'linear-gradient(135deg,#1a73e8,#0b57d0)',
   period: 'day', credits: 'без кредитов — динамический дневной лимит', short: 'сотни/день',
   image: {models: 'Nano Banana', engine: 'модель Nano Banana (…flash-image) в чате', equiv: 'обычно сотни картинок в день (зависит от сложности запросов)'}},
  {id: 'kling', name: 'Kling AI', by: 'Kuaishou', url: 'https://kling.ai/', ico: 'Kl', color: 'linear-gradient(135deg,#00e0a4,#0a7cff)',
   period: 'day', credits: '66 кредитов в день (сгорают через 24 ч)', short: '66 кр./день',
   video: {models: 'Kling 3.0', dur: [5, 10], equiv: '≈ 2–4 видео 720p по 5 с (15–30 кр. каждое), с водяным знаком'}},
  {id: 'dreamina', name: 'Dreamina', by: 'CapCut · ByteDance', url: 'https://dreamina.capcut.com/', ico: 'Dr', color: 'linear-gradient(135deg,#6d5dfc,#00d1ff)',
   period: 'day', credits: '≈ 120 кредитов в день (зависит от региона)', short: '≈ 120 кр./день',
   image: {models: 'Seedream 5.0 Lite', equiv: 'цену картинки Dreamina не публикует — зависит от модели'},
   video: {models: 'Seedance 2.0 / 2.5', dur: [5, 10], equiv: '≈ 1–3 видео в день; новым аккаунтам — 4 пробных Seedance 2.5 на 3 дня'}},
  {id: 'pixverse', name: 'PixVerse', by: 'PixVerse', url: 'https://app.pixverse.ai/', ico: 'PV', color: 'linear-gradient(135deg,#ff4d8d,#7a3cff)',
   period: 'day', credits: '60 кредитов в день + 90 при регистрации', short: '60 кр./день',
   video: {models: 'PixVerse', dur: [5], equiv: '≈ 2 видео в день (≈ 25 кр. за ролик), с водяным знаком'}},
  {id: 'qwen', name: 'Qwen Chat', by: 'Alibaba', url: 'https://chat.qwen.ai/', ico: 'Qw', color: 'linear-gradient(135deg,#615ced,#2a1f9d)',
   period: 'day', credits: 'без кредитов и жёсткого лимита', short: 'без лимита',
   image: {models: 'Qwen-Image', equiv: 'без жёсткого лимита (после 6–7 подряд замедляется)'},
   video: {models: 'Wan 2.7', dur: [5], equiv: 'без жёсткого лимита и без водяного знака (после 6–7 подряд замедляется)'}},
  {id: 'meta', name: 'Meta AI', by: 'Meta', url: 'https://www.meta.ai/', ico: 'Me', color: 'linear-gradient(135deg,#0081fb,#a33bff)',
   period: 'day', credits: 'без кредитов, платного тарифа нет', short: 'бесплатно', note: 'Доступность зависит от страны.',
   image: {models: 'Imagine', equiv: 'бесплатно, лимит Meta не публикует'},
   video: {models: 'Vibes', dur: [5], equiv: 'бесплатно, лимит Meta не публикует'}},
  {id: 'bing', name: 'Bing Creator', by: 'Microsoft', url: 'https://www.bing.com/images/create', ico: 'Bi', color: 'linear-gradient(135deg,#00a4ef,#7fba00)',
   period: 'day', credits: '15 быстрых генераций в день + без лимита в обычной скорости', short: '15 быстро/день + ∞',
   image: {models: 'DALL·E 3 / GPT-4o', equiv: '15 картинок быстро, дальше сколько угодно медленно (45 с – 4 мин)'},
   video: {models: 'Sora', dur: [5], equiv: '10 быстрых видео разово, дальше без лимита в обычной скорости (5 с, 9:16)'}},
  {id: 'chatgpt', name: 'ChatGPT', by: 'OpenAI', url: 'https://chatgpt.com/', ico: 'GP', color: 'linear-gradient(135deg,#10a37f,#0b6e56)',
   period: 'day', credits: 'без кредитов — лимит на 24 часа', short: '2–3 картинки/день',
   image: {models: 'GPT Image', equiv: '2–3 картинки за 24 часа'}},
  {id: 'leonardo', name: 'Leonardo AI', by: 'Canva', url: 'https://app.leonardo.ai/', ico: 'Le', color: 'linear-gradient(135deg,#ff7a45,#c8358f)',
   period: 'day', credits: '150 токенов в день', short: '150 ток./день',
   image: {models: 'Lucid Origin и др.', equiv: '≈ 10–15 картинок на своих моделях (премиум-модели — меньше)'}},
  {id: 'krea', name: 'Krea', by: 'Krea', url: 'https://www.krea.ai/', ico: 'Kr', color: 'linear-gradient(135deg,#222,#666)',
   period: 'day', credits: '100 единиц в день', short: '100 ед./день',
   image: {models: 'Krea 2, Nano Banana 2…', equiv: '≈ 1 картинка Nano Banana 2; на своей модели Krea 2 — больше'}},
  {id: 'recraft', name: 'Recraft', by: 'Recraft', url: 'https://www.recraft.ai/', ico: 'Rc', color: 'linear-gradient(135deg,#ff6b35,#f7c548)',
   period: 'day', credits: '30 кредитов в день', short: '30 кр./день',
   image: {models: 'Recraft (дизайн, вектор)', equiv: '30 растровых картинок (1 кр.) или 15 векторных (2 кр.)'}},
  {id: 'tensor', name: 'Tensor.Art', by: 'Tensor.Art', url: 'https://tensor.art/', ico: 'TA', color: 'linear-gradient(135deg,#3a7bd5,#00d2ff)',
   period: 'day', credits: '≈ 100 кредитов в день (по разным данным 50–100)', short: '≈ 100 кр./день',
   image: {models: 'тысячи моделей SD / FLUX', equiv: 'десятки картинок (цена зависит от модели)'}},
  {id: 'seaart', name: 'SeaArt', by: 'SeaArt', url: 'https://www.seaart.ai/', ico: 'SA', color: 'linear-gradient(135deg,#1fa2ff,#12d8fa,#a6ffcb)',
   period: 'day', credits: '150 «энергии» в день', short: '150 эн./день',
   image: {models: 'модели SD / FLUX', equiv: 'десятки картинок (цена зависит от модели)'}},
  // ---- каждую неделю / месяц ----
  {id: 'ideogram', name: 'Ideogram', by: 'Ideogram', url: 'https://ideogram.ai/', ico: 'Id', color: 'linear-gradient(135deg,#111,#555)',
   period: 'week', credits: '10 кредитов в неделю', short: '10 кр./нед.',
   image: {models: 'Ideogram (текст на картинках)', equiv: '≈ 10 генераций в неделю в медленной очереди'}},
  {id: 'vidu', name: 'Vidu', by: 'Shengshu', url: 'https://www.vidu.com/', ico: 'Vi', color: 'linear-gradient(135deg,#00c6ff,#0072ff)',
   period: 'month', credits: '80 кредитов в месяц + без лимита в непиковые часы', short: '80 кр./мес. + ночью ∞',
   video: {models: 'Vidu Q3', dur: [4, 8], equiv: '≈ 20 коротких клипов в месяц + бесплатно в непиковые часы'}},
  {id: 'pika', name: 'Pika', by: 'Pika', url: 'https://pika.art/', ico: 'Pi', color: 'linear-gradient(135deg,#f953c6,#b91d73)',
   period: 'month', credits: '80 кредитов в месяц', short: '80 кр./мес.',
   video: {models: 'Pika 2.5', dur: [5, 10], equiv: '1 видео 10 с 1080p (80 кр.) или несколько в 480p'}},
  {id: 'firefly', name: 'Adobe Firefly', by: 'Adobe', url: 'https://firefly.adobe.com/', ico: 'Ff', color: 'linear-gradient(135deg,#fa0f00,#ff7a00)',
   period: 'month', credits: '25 кредитов в месяц', short: '25 кр./мес.',
   image: {models: 'Firefly Image', equiv: '≈ 25 картинок (1 кр. за стандартную)'}},
  // ---- разово (пробный период) ----
  {id: 'openart', name: 'OpenArt', by: 'OpenArt', url: 'https://openart.ai/', ico: 'OA', color: 'linear-gradient(135deg,#8e2de2,#4a00e0)',
   period: 'once', credits: '40 кредитов на 7 дней (+50 за вступление в их Discord)', short: '40 кр. разово',
   video: {models: 'Kling 3.0 Omni, Seedance…', dur: [5, 10], equiv: '≈ 2 видео Kling 3.0 Omni (с бонусом Discord — больше)'}},
  {id: 'hailuo', name: 'Hailuo AI', by: 'MiniMax', url: 'https://hailuoai.video/', ico: 'Ha', color: 'linear-gradient(135deg,#ff512f,#dd2476)',
   period: 'once', credits: '≈ 200 кредитов разово, сгорают через 3 дня', short: '≈ 200 кр. разово',
   video: {models: 'Hailuo', dur: [6], equiv: '≈ 8 видео 768p по 6 с (25 кр. каждое), с водяным знаком'}},
  {id: 'runway', name: 'Runway', by: 'Runway', url: 'https://app.runwayml.com/', ico: 'Rw', color: 'linear-gradient(135deg,#0f0f0f,#4a4a4a)',
   period: 'once', credits: '125 кредитов разово', short: '125 кр. разово',
   video: {models: 'Gen-4 Turbo', dur: [5, 10], equiv: '≈ 25 секунд видео (5 кр./с) — 2–5 роликов'}},
];

const PERIODS = {day: '🔄 каждый день', week: '🔄 каждую неделю', month: '🗓 каждый месяц', once: '🎁 разово (пробный период)'};
const EXT_MODELS = SERVICES.flatMap(s => ['image', 'video'].filter(k => s[k]).map(k => ({
  id: s.ids?.[k] || `ext:${s.id}-${k}`, kind: k, tier: 'free', provider: 'ext', external: true, service: s.id,
  ico: s.ico, color: s.color, title: `${s.name} · ${s[k].models}`, publisher: `${s.by} · на их сайте`,
  site: s.name, url: s.url, engine: s[k].engine || s[k].models, period: s.period,
  credits: s.credits, equiv: s[k].equiv, short: s.short, note: s.note, count: s.count,
  desc: `${s.credits}. ${s[k].equiv}.${s.note ? ' ' + s.note : ''}`,
  tags: [PERIODS[s.period], ...(k === 'video' && s.video.dur ? [`⏱ ${s.video.dur.join('/')} с`] : [])],
  inputs: ['text'], outputs: [k], caps: [], health: 'healthy', eta: 'вручную на сайте',
  ...(k === 'video' ? {durations: s.video.dur || [5], defDur: (s.video.dur || [5])[0]} : {}),
})));

const STYLES = [
  {id:'none',      name:'Без стиля',   emoji:'○',  bg:'linear-gradient(135deg,#2a2a31,#17171b)', suffix:''},
  {id:'cinematic', name:'Кино',        emoji:'🎬', bg:'linear-gradient(135deg,#123247,#c7773a)', suffix:'cinematic film still, anamorphic lens, dramatic lighting, shallow depth of field, color graded, 35mm film grain'},
  {id:'photo',     name:'Фото',        emoji:'📷', bg:'linear-gradient(135deg,#2f4034,#a8bf9f)', suffix:'ultra realistic photograph, 85mm lens, natural light, highly detailed, sharp focus, 8k'},
  {id:'anime',     name:'Аниме',       emoji:'🌸', bg:'linear-gradient(135deg,#ff8fb1,#6f62ff)', suffix:'anime style, studio ghibli inspired, vibrant colors, detailed background, cel shading'},
  {id:'3d',        name:'3D-мульт',    emoji:'🧸', bg:'linear-gradient(135deg,#43b8ee,#a146b8)', suffix:'3d render, pixar style, soft global illumination, cute, octane render, subsurface scattering'},
  {id:'cyber',     name:'Киберпанк',   emoji:'🌆', bg:'linear-gradient(135deg,#ff00a8,#00d9ff)', suffix:'cyberpunk, neon lights, rain-soaked streets, blade runner aesthetic, magenta and cyan glow'},
  {id:'fantasy',   name:'Фэнтези',     emoji:'🐉', bg:'linear-gradient(135deg,#2a1c5a,#d8a24a)', suffix:'epic fantasy concept art, ethereal lighting, highly detailed, matte painting'},
  {id:'oil',       name:'Живопись',    emoji:'🎨', bg:'linear-gradient(135deg,#7c4d22,#e8c27d)', suffix:'oil painting, visible brush strokes, impressionism, rich texture, canvas'},
  {id:'fashion',   name:'Fashion',     emoji:'👠', bg:'linear-gradient(135deg,#0d0d0d,#d9d9d9)', suffix:'high fashion editorial photoshoot, vogue magazine, studio lighting, bold styling'},
  {id:'retro',     name:'VHS 90-х',    emoji:'📼', bg:'linear-gradient(135deg,#ff6b6b,#ffd93d)', suffix:'1990s VHS camcorder aesthetic, retro, film noise, washed colors, nostalgic'},
  {id:'noir',      name:'Нуар',        emoji:'🕵️', bg:'linear-gradient(135deg,#000,#8a8a8a)',     suffix:'black and white film noir, high contrast, dramatic shadows, moody'},
  {id:'comic',     name:'Комикс',      emoji:'💥', bg:'linear-gradient(135deg,#ffd600,#e60023)', suffix:'comic book art, bold ink lines, halftone dots, dynamic composition, vibrant'},
];

/* =============================== движение камеры =============================== */
// Пресеты движения камеры (2026-09-27: расширено до 50, у каждого — живое 3D-превью).
// id прежних пресетов сохранены (static, live, dolly_in, dolly_out, crash, orbit, pan, crane, hand, fpv, bullet, slowmo).
// Поля: g — группа, top — в «Популярных», name / desc — по-русски, prompt — что дописать к промпту видео (по-английски),
// mode — как крутится превью: loop (проезд и склейка), ping (туда-обратно), cont (непрерывно); dur — секунды;
// f(t, T) — «съёмка»: t — фаза 0…1, T — секунды → положение камеры, герой и эффекты сцены (см. CamPreview).
const MOTION_GROUPS = [
  ['top', 'Популярные', 'star'], ['base', 'Основа', 'camera'], ['zoom', 'Наезд и зум', 'zoom'], ['pan', 'Панорамы', 'arrows-h'],
  ['move', 'Движение', 'move'], ['orbit', 'Облёт', 'orbit'], ['air', 'Кран и дрон', 'drone'], ['fx', 'Эффекты', 'sparkles'],
];
const MV = (() => {
  const D = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const E = {
    sine: t => (1 - Math.cos(Math.PI * t)) / 2,
    cubic: t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
    quint: t => t < .5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2,
    outExpo: t => t >= 1 ? 1 : 1 - 2 ** (-10 * t),
  };
  // плавный «шум» для ручной камеры и тряски
  const nz = (T, s) => .5 * Math.sin(T * 1.7 + s) + .3 * Math.sin(T * 2.9 + s * 1.3) + .2 * Math.sin(T * 5.3 + s * 2.1);
  // точка на окружности вокруг героя: угол в градусах, радиус, высота
  const orbit = (deg, R = 7.5, y = 1.55) => [Math.sin(deg * D) * R, y, -Math.cos(deg * D) * R];
  return {D, clamp, lerp, E, nz, orbit};
})();
const MOTIONS = (() => {
  const {clamp, lerp, E, nz, orbit} = MV;
  const ROBO = [[[0, 1.55, -8], [0, 1.15, 0]], [[2.6, .7, -4.2], [0, 1.3, 0]], [[-2.8, 3.4, -5], [0, 1, 0]], [[0, 1.62, -2.6], [0, 1.55, 0]]];
  const mix = (a, b, u) => a.map((v, i) => lerp(v, b[i], u));
  return [
    // ---- основа ----
    {id: 'static', g: 'base', name: 'Без движения', desc: 'Камера стоит на штативе — двигается только сцена', mode: 'cont',
      prompt: 'static locked-off camera on a tripod, no camera movement, only natural motion in the scene', f: () => ({})},
    {id: 'live', g: 'base', name: 'Живое фото', desc: 'Кадр оживает: дыхание, волосы и одежда чуть двигаются', mode: 'cont',
      prompt: 'subtle living photo motion, gentle breathing, hair and clothes softly moving, static camera',
      f: (t, T) => ({zoom: 1.02 + .012 * Math.sin(T * .8), subj: {breath: Math.sin(T * 2.4)}})},
    {id: 'hand', g: 'base', top: 1, name: 'С рук', desc: 'Живая ручная камера: лёгкое покачивание, как в документальном кино', mode: 'cont',
      prompt: 'handheld camera, natural subtle shake and micro-movements, documentary realism',
      f: (t, T) => ({pos: [.08 * nz(T, 1), 1.55 + .05 * nz(T, 2), -7.5 + .06 * nz(T, 3)], yaw: .9 * nz(T * 1.3, 4), pitch: .6 * nz(T * 1.1, 5), roll: 1.2 * nz(T * .9, 6)})},
    {id: 'steadicam', g: 'base', name: 'Стедикам', desc: 'Плавный проход вперёд, как на стабилизаторе', mode: 'ping', dur: 4.6,
      prompt: 'smooth steadicam glide toward the subject, floating stabilized camera movement',
      f: t => { const u = E.sine(t); return {pos: [.3 * Math.sin(u * 3.1), 1.6 + .02 * Math.sin(u * 9), lerp(-9.5, -5, u)], roll: .8 * Math.sin(u * 3.1)}; }},
    {id: 'low_angle', g: 'base', name: 'Героический ракурс', desc: 'Камера у земли смотрит снизу — герой кажется сильнее', mode: 'ping', dur: 4,
      prompt: 'low-angle hero shot, camera near the ground looking up at the subject, slow push in',
      f: t => ({pos: [.35, .32, lerp(-5.8, -4.4, E.sine(t))], look: [0, 1.7, 0], roll: -2})},
    {id: 'dutch', g: 'base', name: 'Голландский угол', desc: 'Горизонт заваливается — тревога и напряжение', mode: 'ping', dur: 3.8,
      prompt: 'dutch angle, the camera slowly rolls to a tilted horizon, uneasy tension',
      f: t => { const u = E.sine(t); return {pos: [0, 1.55, lerp(-7.5, -6.4, u)], roll: lerp(0, 18, u)}; }},
    // ---- наезд и зум ----
    {id: 'dolly_in', g: 'zoom', top: 1, name: 'Наезд', desc: 'Камера плавно подъезжает к герою', mode: 'loop', dur: 3.4,
      prompt: 'slow cinematic dolly-in, the camera smoothly pushes toward the subject', f: t => ({pos: [0, 1.55, lerp(-10.5, -3.4, E.sine(t))]})},
    {id: 'dolly_out', g: 'zoom', name: 'Отъезд', desc: 'Камера отъезжает и открывает место действия', mode: 'loop', dur: 3.4,
      prompt: 'slow dolly-out, the camera pulls back revealing the environment', f: t => ({pos: [0, 1.55, lerp(-3.4, -10.5, E.sine(t))]})},
    {id: 'zoom_in', g: 'zoom', name: 'Зум-наезд', desc: 'Приближение объективом — камера стоит на месте, фон не смещается', mode: 'loop', dur: 3.4,
      prompt: 'smooth optical zoom in on the subject, the camera position stays fixed', f: t => ({zoom: lerp(1, 2.3, E.sine(t)), look: [0, 1.25, 0]})},
    {id: 'zoom_out', g: 'zoom', name: 'Зум-отъезд', desc: 'Объектив отдаляет — кадр раскрывается', mode: 'loop', dur: 3.4,
      prompt: 'smooth optical zoom out from the subject, the camera position stays fixed', f: t => ({zoom: lerp(2.3, 1, E.sine(t)), look: [0, 1.25, 0]})},
    {id: 'crash', g: 'zoom', top: 1, name: 'Crash Zoom', desc: 'Резкий удар-зум в героя', mode: 'loop', dur: 2.4,
      prompt: 'sudden fast crash zoom into the subject, dramatic snap',
      f: t => { const q = clamp((t - .38) / .15, 0, 1); return {zoom: lerp(1, 3, E.outExpo(q)), look: [0, 1.3, 0], env: {zoomBlur: Math.sin(Math.PI * q)}}; }},
    {id: 'crash_out', g: 'zoom', name: 'Crash-отъезд', desc: 'Резкий зум назад — шок и масштаб', mode: 'loop', dur: 2.4,
      prompt: 'sudden fast crash zoom out from the subject, dramatic reveal',
      f: t => { const q = clamp((t - .38) / .15, 0, 1); return {zoom: lerp(3, 1, E.outExpo(q)), look: [0, 1.3, 0], env: {zoomBlur: Math.sin(Math.PI * q)}}; }},
    {id: 'eyes_in', g: 'zoom', name: 'В глаза', desc: 'Наезд до крупного плана лица', mode: 'loop', dur: 3.6,
      prompt: 'dramatic push-in from a medium shot to an extreme close-up of the eyes',
      f: t => { const u = E.cubic(t); return {pos: [0, lerp(1.55, 1.64, u), lerp(-7.5, -1.2, u)], look: [0, lerp(1.2, 1.63, u), 0]}; }},
    {id: 'vertigo', g: 'zoom', top: 1, name: 'Вертиго', desc: 'Dolly zoom: герой того же размера, а фон «уплывает»', mode: 'ping', dur: 3.4,
      prompt: 'dolly zoom vertigo effect, the subject stays the same size while the background stretches away',
      f: t => { const d = lerp(3.8, 12, E.sine(t)); return {pos: [0, 1.5, -d], look: [0, 1.2, 0], zoom: d / 3.8}; }},
    {id: 'super_dolly', g: 'zoom', name: 'Супер-наезд', desc: 'Стремительный наезд издалека', mode: 'loop', dur: 2.8,
      prompt: 'fast super dolly-in from a wide shot rushing toward the subject',
      f: t => { const u = E.outExpo(t); return {pos: [0, lerp(2.4, 1.5, u), lerp(-17, -3.3, u)], env: {mblurZ: 1 - u}}; }},
    // ---- панорамы ----
    {id: 'pan', g: 'pan', top: 1, name: 'Панорама', desc: 'Камера поворачивается на месте слева направо', mode: 'ping', dur: 4.4,
      prompt: 'smooth horizontal pan across the scene, the camera rotating on a fixed tripod', f: t => ({yaw: lerp(-34, 34, E.sine(t))})},
    {id: 'whip', g: 'pan', name: 'Whip Pan', desc: 'Молниеносный поворот с размытием', mode: 'loop', dur: 3,
      prompt: 'fast whip pan with strong motion blur',
      f: t => { const q = clamp((t - .42) / .13, 0, 1); return {yaw: lerp(0, 78, E.cubic(q)), env: {mblur: Math.sin(Math.PI * q)}}; }},
    {id: 'tilt_up', g: 'pan', name: 'Наклон вверх', desc: 'Взгляд скользит от земли вверх — к герою и небу', mode: 'loop', dur: 3.6,
      prompt: 'slow tilt up from the ground to the subject and the sky', f: t => ({pitch: lerp(-32, 16, E.sine(t))})},
    {id: 'tilt_down', g: 'pan', name: 'Наклон вниз', desc: 'Взгляд опускается с неба на героя', mode: 'loop', dur: 3.6,
      prompt: 'slow tilt down from the sky to the subject', f: t => ({pitch: lerp(16, -32, E.sine(t))})},
    {id: 'roll', g: 'pan', name: 'Бочка', desc: 'Камера делает полный оборот вокруг своей оси', mode: 'loop', dur: 3.2,
      prompt: 'camera barrel roll, rotating 360 degrees around its axis while moving forward',
      f: t => { const u = E.cubic(t); return {pos: [0, 1.55, lerp(-9.5, -5, u)], roll: 360 * u}; }},
    // ---- движение ----
    {id: 'truck_right', g: 'move', name: 'Тревелинг вправо', desc: 'Камера едет вбок — глубокий параллакс', mode: 'loop', dur: 3.6,
      prompt: 'lateral truck right, the camera slides sideways with strong parallax',
      f: t => { const x = lerp(-4.2, 4.2, E.sine(t)); return {pos: [x, 1.55, -7.5], look: [x, 1.15, 0]}; }},
    {id: 'truck_left', g: 'move', name: 'Тревелинг влево', desc: 'Камера едет вбок в другую сторону', mode: 'loop', dur: 3.6,
      prompt: 'lateral truck left, the camera slides sideways with strong parallax',
      f: t => { const x = lerp(4.2, -4.2, E.sine(t)); return {pos: [x, 1.55, -7.5], look: [x, 1.15, 0]}; }},
    {id: 'tracking', g: 'move', top: 1, name: 'Слежение сбоку', desc: 'Камера едет рядом с идущим героем', mode: 'loop', dur: 5,
      prompt: 'side tracking shot, the camera moves alongside the walking subject',
      f: (t, T) => { const x = lerp(-5, 5, t); return {pos: [x, 1.5, -6.2], look: [x, 1.15, 0], subj: {x, walk: T, turn: 90}}; }},
    {id: 'follow', g: 'move', name: 'За героем', desc: 'Камера идёт следом за героем', mode: 'loop', dur: 5,
      prompt: 'follow shot from behind, the camera follows the subject walking forward',
      f: (t, T) => { const z = lerp(-1, 8, t); return {pos: [.35, 1.75, z - 4.4], look: [0, 1.25, z + 4], subj: {z, walk: T}}; }},
    {id: 'lead', g: 'move', name: 'Навстречу', desc: 'Герой идёт на камеру, она отступает перед ним', mode: 'loop', dur: 5,
      prompt: 'leading shot, the subject walks toward the camera as it moves backward',
      f: (t, T) => { const z = lerp(7, -2, t); return {pos: [0, 1.6, z - 4.2], look: [0, 1.2, z], subj: {z, walk: T}}; }},
    {id: 'ped_up', g: 'move', name: 'Подъём', desc: 'Камера поднимается вертикально, не наклоняясь', mode: 'loop', dur: 3.6,
      prompt: 'camera pedestal up, rising vertically while staying level',
      f: t => { const y = lerp(.55, 3.6, E.sine(t)); return {pos: [0, y, -7.5], look: [0, y - .4, 0]}; }},
    {id: 'ped_down', g: 'move', name: 'Спуск', desc: 'Камера опускается вертикально', mode: 'loop', dur: 3.6,
      prompt: 'camera pedestal down, lowering vertically while staying level',
      f: t => { const y = lerp(3.6, .55, E.sine(t)); return {pos: [0, y, -7.5], look: [0, y - .4, 0]}; }},
    {id: 'reveal', g: 'move', name: 'Раскрытие', desc: 'Камера выходит из-за укрытия и открывает героя', mode: 'loop', dur: 4,
      prompt: 'reveal shot, the camera slides out from behind a foreground object to reveal the subject',
      f: t => { const x = lerp(-1.6, 2.4, E.sine(t)); return {pos: [x, 1.45, -7.2], look: [x * .45, 1.15, 0], env: {pillar: 1}}; }},
    {id: 'car', g: 'move', name: 'Из машины', desc: 'Съёмка с едущего авто: фон мчится, герой в кадре', mode: 'cont',
      prompt: 'car-mounted camera, the background rushes past with motion blur while the subject stays steady',
      f: (t, T) => { const x = (T * 12) % 30; return {pos: [x + .2, 1.35, -5.2], look: [x, 1.1, 0], roll: .5 * Math.sin(T * 23), subj: {x, turn: 90}, env: {car: 1, travel: 1, mblur: .55, noLanterns: 1}}; }},
    // ---- облёт ----
    {id: 'orbit', g: 'orbit', top: 1, name: 'Облёт', desc: 'Камера облетает героя по дуге', mode: 'ping', dur: 5,
      prompt: 'camera smoothly orbits around the subject, strong parallax', f: t => ({pos: orbit(lerp(-55, 55, E.sine(t)))})},
    {id: 'orbit360', g: 'orbit', name: 'Облёт 360°', desc: 'Полный круг вокруг героя', mode: 'cont',
      prompt: 'full 360-degree orbit around the subject', f: (t, T) => ({pos: orbit(T * 40)})},
    {id: 'arc_left', g: 'orbit', name: 'Дуга влево', desc: 'Полукруг вокруг героя влево', mode: 'loop', dur: 3.6,
      prompt: 'arc shot moving to the left around the subject', f: t => ({pos: orbit(lerp(0, -70, E.sine(t)))})},
    {id: 'arc_right', g: 'orbit', name: 'Дуга вправо', desc: 'Полукруг вокруг героя вправо', mode: 'loop', dur: 3.6,
      prompt: 'arc shot moving to the right around the subject', f: t => ({pos: orbit(lerp(0, 70, E.sine(t)))})},
    {id: 'bullet', g: 'orbit', top: 1, name: 'Bullet Time', desc: 'Время замерло — камера облетает застывший момент', mode: 'loop', dur: 3.4,
      prompt: 'bullet time effect, time frozen mid-action, the camera arcs around the subject',
      f: t => ({pos: orbit(lerp(-75, 75, E.sine(t)), 5.6, 1.35), look: [0, 1.5, 0], subj: {y: .5}, env: {freeze: 1, desat: .5}})},
    {id: 'turntable', g: 'orbit', name: 'Карусель', desc: 'Герой медленно вращается, камера стоит', mode: 'cont',
      prompt: 'lazy susan turntable shot, the subject slowly rotates in place while the camera stays still', f: (t, T) => ({pos: [0, 1.5, -6.4], subj: {turn: T * 72}})},
    {id: 'spiral', g: 'orbit', name: 'Спираль', desc: 'Облёт с подъёмом по спирали', mode: 'loop', dur: 4.6,
      prompt: 'spiral crane orbit, circling the subject while rising',
      f: t => { const u = E.sine(t); return {pos: orbit(u * 300, lerp(7.5, 5.2, u), lerp(1.3, 5.2, u)), look: [0, 1, 0]}; }},
    {id: 'snorri', g: 'orbit', name: 'Snorricam', desc: 'Камера закреплена на герое — мир качается вокруг', mode: 'cont',
      prompt: 'snorricam body-mounted camera, the subject stays fixed in frame while the world sways around',
      f: (t, T) => ({pos: orbit(26 * Math.sin(T * 1.1), 4.2, 1.6), look: [0, 1.45, 0], roll: 6 * Math.sin(T * 1.1 + .6)})},
    // ---- кран и дрон ----
    {id: 'crane', g: 'air', top: 1, name: 'Кран вверх', desc: 'Камера поднимается и смотрит на героя сверху', mode: 'loop', dur: 4,
      prompt: 'camera cranes up and rises high above the scene',
      f: t => { const u = E.sine(t); return {pos: [0, lerp(1.3, 7.2, u), lerp(-7.5, -10.5, u)], look: [0, lerp(1.2, .7, u), 0]}; }},
    {id: 'crane_down', g: 'air', name: 'Кран вниз', desc: 'Камера опускается сверху до уровня глаз', mode: 'loop', dur: 4,
      prompt: 'camera cranes down from high above to eye level',
      f: t => { const u = E.sine(t); return {pos: [0, lerp(7.2, 1.3, u), lerp(-10.5, -7.5, u)], look: [0, lerp(.7, 1.2, u), 0]}; }},
    {id: 'overhead', g: 'air', name: 'Взгляд сверху', desc: 'Подъём до вида строго сверху', mode: 'loop', dur: 4.6,
      prompt: "camera rises to a top-down overhead bird's-eye view",
      f: t => { const u = E.sine(t); return {pos: [0, lerp(1.6, 13, u), lerp(-7.5, -.35, u)], look: [0, lerp(1.15, 0, u), 0]}; }},
    {id: 'drone_orbit', g: 'air', name: 'Дрон-облёт', desc: 'Дрон кружит высоко над героем', mode: 'cont',
      prompt: 'aerial drone orbit high above the subject', f: (t, T) => ({pos: orbit(T * 26, 15, 8.5), look: [0, .8, 0]})},
    {id: 'drone_out', g: 'air', top: 1, name: 'Дрон отлёт', desc: 'Дрон улетает назад и вверх, открывая пейзаж', mode: 'loop', dur: 4.6,
      prompt: 'aerial drone pullback, flying up and away to reveal the landscape',
      f: t => { const u = E.cubic(t); return {pos: [0, lerp(1.7, 11, u), lerp(-3.4, -25, u)], look: [0, lerp(1.3, .6, u), 0]}; }},
    {id: 'fpv', g: 'air', top: 1, name: 'FPV-дрон', desc: 'Стремительный пролёт с кренами', mode: 'loop', dur: 3.4,
      prompt: 'fast FPV drone flight swooping through the scene with banking turns',
      f: t => { const z = lerp(-28, 9, t), x = 1.5 * Math.sin(t * 3.8 + .3), y = 2.3 - 1.2 * Math.sin(t * Math.PI); return {pos: [x, y, z], look: [x * .4, y - .6, z + 9], roll: -17 * Math.cos(t * 3.8 + .3), zoom: .86, env: {mblurZ: .5}}; }},
    {id: 'through', g: 'air', name: 'Сквозь арку', desc: 'Пролёт камеры сквозь проём к герою', mode: 'loop', dur: 3.6,
      prompt: 'the camera flies through an archway toward the subject', f: t => ({pos: [0, 1.5, lerp(-11, -2.3, E.sine(t))], look: [0, 1.2, 0], env: {arch: 1}})},
    {id: 'hyperlapse', g: 'air', name: 'Гиперлапс', desc: 'Рывками вперёд, время ускорено', mode: 'loop', dur: 4,
      prompt: 'hyperlapse, the camera moves forward in fast time-lapse steps',
      f: t => { const k = t * 6, i = Math.floor(k), u = (i + E.quint(Math.min(1, (k - i) * 2.2))) / 6; return {pos: [.15 * Math.sin(i * 2.1), 1.6, lerp(-20, -3, u)], env: {speed: 6, time: .15 + .35 * t, clouds: 6}}; }},
    // ---- эффекты ----
    {id: 'slowmo', g: 'fx', top: 1, name: 'Slow-Mo', desc: 'Время замедлено — всё плывёт', mode: 'cont',
      prompt: 'dramatic slow motion, graceful fluid movement', f: (t, T) => ({zoom: 1.04 + .03 * Math.sin(T * .35), env: {speed: .12, rain: 1}})},
    {id: 'timelapse', g: 'fx', name: 'Таймлапс', desc: 'Небо и свет меняются за секунды', mode: 'loop', dur: 5,
      prompt: 'time-lapse, the sky and light change rapidly, static camera', f: t => ({pos: [0, 1.4, -8.5], look: [0, 1.6, 0], env: {time: t, clouds: 9, speed: 3}})},
    {id: 'focus', g: 'fx', name: 'Перевод фокуса', desc: 'Фокус переходит с переднего плана на героя', mode: 'ping', dur: 3.4,
      prompt: 'rack focus from the foreground to the subject, shallow depth of field', f: t => ({pos: [.75, .9, -7.2], look: [-.2, 1.05, 0], env: {focus: E.sine(t), fgrass: 1}})},
    {id: 'shake', g: 'fx', name: 'Тряска', desc: 'Сильная тряска, как от удара или взрыва', mode: 'cont',
      prompt: 'intense camera shake, earthquake impact rumble',
      f: (t, T) => { const a = .35 + .65 * Math.max(0, Math.sin(T * 1.6)) ** 6; return {pos: [.16 * a * nz(T * 6, 1), 1.55 + .12 * a * nz(T * 7, 2), -7.5], roll: 3.2 * a * nz(T * 5, 3), yaw: 1.5 * a * nz(T * 6.5, 4), pitch: 1.2 * a * nz(T * 7.5, 5)}; }},
    {id: 'robo', g: 'fx', name: 'Робо-рука', desc: 'Резкие точные движения со стопами', mode: 'loop', dur: 4.4,
      prompt: 'robotic arm camera, fast precise moves with sudden stops',
      f: t => { const k = t * 4, i = Math.floor(k) % 4, u = E.quint(clamp((k - Math.floor(k)) / .42, 0, 1)), a = ROBO[i], b = ROBO[(i + 1) % 4]; return {pos: mix(a[0], b[0], u), look: mix(a[1], b[1], u)}; }},
    {id: 'freeze', g: 'fx', name: 'Стоп-кадр', desc: 'Движение и резкая заморозка кадра со вспышкой', mode: 'loop', dur: 3.6,
      prompt: 'freeze frame, the action suddenly freezes with a flash',
      f: t => { const fr = t >= .58; return {pos: [0, 1.55, lerp(-9.5, -5.2, E.sine(Math.min(t, .58) / .58))], zoom: fr ? 1.05 : 1, env: {freeze: fr ? 1 : 0, desat: fr ? .7 : 0, flash: fr ? Math.max(0, 1 - (t - .58) * 9) : 0}}; }},
  ];
})();
const motionsOf = g => MOTIONS.filter(m => g === 'top' ? m.top : m.g === g);

// Живое превью пресета: маленькая 3D-сцена на canvas — небо, горы, лаймовая сетка-«поле», фонари, герой в луче света.
// Камера движется по пресету по-настоящему (перспектива, параллакс), рисуются только карточки на экране.
const CamPreview = (() => {
  const {D, clamp, lerp} = MV;
  const F = 3.1;   // фокусное расстояние (в половинах кадра): угол обзора ≈ 36°
  const hasFilter = typeof document.createElement('canvas').getContext('2d').filter === 'string';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // --- сцена (детерминированная) ---
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ring = (n, R, h0, h1, ph) => Array.from({length: n}, (_, i) => {
    const a = i / n * Math.PI * 2;
    const k = .5 + .26 * Math.sin(3 * a + ph) + .16 * Math.sin(7 * a + ph * 1.7) + .1 * Math.sin(13 * a + ph * 2.3) + .06 * Math.sin(29 * a + ph);
    return [Math.sin(a) * R, h0 + (h1 - h0) * clamp(k, 0, 1), Math.cos(a) * R];
  });
  const FAR = ring(110, 115, 5, 17, .7), NEAR = ring(130, 44, 1.6, 6.5, 2.1);
  const STARS = Array.from({length: 46}, () => [rnd() * Math.PI * 2, (6 + rnd() * 66) * D, .5 + rnd() * .9, rnd() * 6]);
  const DUST = Array.from({length: 80}, () => [rnd() * 18 - 9, rnd() * 5, rnd() * 26 - 12, rnd() * 6]);
  const RAIN = Array.from({length: 40}, () => [rnd() * 14 - 7, rnd() * 6, rnd() * 18 - 9]);
  const CLOUDS = Array.from({length: 5}, (_, i) => [i / 5 * Math.PI * 2 + rnd(), (9 + rnd() * 12) * D, 12 + rnd() * 14]);
  const PROPS = [['rock', -2.6, -3.2, .9], ['grass', 2.1, -4.6, .75], ['grass', -1.6, -8.8, .6], ['rock', 3.4, -10, 1.1],
    ['grass', 1.4, 3.8, .6], ['rock', -3.8, 5, 1.4], ['grass', -.9, -14, .6], ['rock', 2.6, 9, 1.2], ['grass', -3.2, -19, .7], ['rock', 4.2, -24, 1.3]];
  // --- спрайты: герой с лаймовым контровым светом, камни, трава, свечение ---
  const cnv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const rim = (g, path, w, h, dl, dr, body) => {   // контур справа — лайм, слева — тёплый, внутри — тело
    g.save(); g.clip(path); g.fillStyle = 'rgba(212,255,58,.95)'; g.fillRect(0, 0, w, h);
    g.translate(-dr, 0); g.clip(path); g.translate(dr, 0); g.fillStyle = 'rgba(255,150,100,.85)'; g.fillRect(0, 0, w, h);
    g.translate(dl, 0); g.clip(path); g.translate(-dl, 0); g.fillStyle = body; g.fillRect(0, 0, w, h); g.restore();
  };
  let SPR = null;
  function sprites() {
    if (SPR) return SPR;
    const S = 133, X = m => 60 + m * S, Y = m => 254 - m * S;
    // герой — один плавный силуэт (шапка, плечи, куртка, руки, ноги, ботинки): правая половина + её зеркало
    const half = [[0, 1.805], [.07, 1.795], [.115, 1.755], [.128, 1.71], [.136, 1.68], [.128, 1.648], [.112, 1.6], [.098, 1.555], [.07, 1.518], [.062, 1.495],
      [.14, 1.47], [.215, 1.445], [.262, 1.405], [.282, 1.33], [.292, 1.18], [.3, 1.02], [.302, .9], [.288, .83], [.262, .815], [.24, .84], [.236, .92],
      [.222, .97], [.205, .905], [.18, .86], [.172, .62], [.16, .44], [.152, .2], [.148, .09], [.205, .055], [.212, .006], [.05, .006], [.048, .09], [.055, .3], [.045, .55], [.02, .8], [0, .82]];
    const pts = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [X(x), Y(y)]);
    const hero = cnv(120, 260), g = hero.getContext('2d'), p = new Path2D();
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length; i++) {   // сглаживание Катмулла–Рома
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length], d = pts[(i + 2) % pts.length];
      p.bezierCurveTo(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, c[0], c[1]);
    }
    p.closePath();
    const body = g.createLinearGradient(0, 0, 0, 260);
    body.addColorStop(0, '#221e30'); body.addColorStop(.3, '#17141f'); body.addColorStop(.62, '#100e17'); body.addColorStop(1, '#08070c');
    rim(g, p, 120, 260, 2, 3, body);
    g.save(); g.clip(p); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.07)';   // отворот шапки и низ куртки
    g.beginPath(); g.moveTo(X(-.14), Y(1.668)); g.lineTo(X(.14), Y(1.668)); g.moveTo(X(-.21), Y(.915)); g.lineTo(X(.21), Y(.915)); g.stroke(); g.restore();
    const blob = (w, h, pts, d) => { const c = cnv(w, h), q = c.getContext('2d'), path = new Path2D();
      pts.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y)); path.closePath();
      const gr = q.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1a1528'); gr.addColorStop(1, '#07060c');
      rim(q, path, w, h, d * .7, d, gr); return c; };
    const rock = blob(140, 90, [[6, 90], [16, 54], [38, 30], [68, 13], [98, 20], [122, 42], [134, 68], [138, 90]], 3);
    const pillar = blob(110, 240, [[6, 240], [10, 150], [22, 70], [44, 20], [70, 8], [92, 40], [100, 120], [106, 240]], 4);
    const grass = cnv(110, 90), q = grass.getContext('2d');
    for (let i = 0; i < 13; i++) {
      const x0 = 12 + i * 7 + (i % 3) * 2, lean = (i - 6) * 3.2, top = 10 + (i * 37 % 30);
      q.beginPath(); q.moveTo(x0 - 4, 90); q.quadraticCurveTo(x0 + lean * .4, 50, x0 + lean, top); q.quadraticCurveTo(x0 + lean * .3, 55, x0 + 4, 90); q.closePath();
      q.fillStyle = '#0c0a14'; q.fill(); q.strokeStyle = i % 2 ? 'rgba(212,255,58,.55)' : 'rgba(255,150,100,.45)'; q.lineWidth = 1; q.stroke();
    }
    const glow = cnv(64, 64), gg = glow.getContext('2d'), rg = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,236,190,1)'); rg.addColorStop(.18, 'rgba(255,196,120,.8)'); rg.addColorStop(.5, 'rgba(255,140,80,.22)'); rg.addColorStop(1, 'rgba(255,120,70,0)');
    gg.fillStyle = rg; gg.fillRect(0, 0, 64, 64);
    const noise = cnv(96, 96), ng = noise.getContext('2d'), id = ng.createImageData(96, 96);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 34; }
    ng.putImageData(id, 0, 0);
    return SPR = {hero, rock, pillar, grass, glow, noise};
  }
  const vign = new Map();
  function vignette(W) {
    if (vign.has(W)) return vign.get(W);
    const c = cnv(W, W), g = c.getContext('2d'), r = g.createRadialGradient(W / 2, W / 2, W * .3, W / 2, W / 2, W * .74);
    r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(0,0,0,.62)');
    g.fillStyle = r; g.fillRect(0, 0, W, W); vign.set(W, c); return c;
  }
  // --- палитра неба: сумерки → ночь (таймлапс) ---
  const DUSK = [[7, 11, 30], [38, 26, 78], [122, 47, 107], [255, 138, 92]], NIGHT = [[2, 3, 10], [9, 13, 38], [26, 22, 62], [58, 34, 82]];
  const mixC = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  // --- камера ---
  function camera(p, t, T) {
    const o = p.f(t, T) || {};
    const pos = o.pos || [0, 1.55, -7.5], look = o.look || [0, 1.15, 0];
    const dx = look[0] - pos[0], dy = look[1] - pos[1], dz = look[2] - pos[2], dl = Math.hypot(dx, dy, dz) || 1;
    const yaw = Math.atan2(dx, dz) + (o.yaw || 0) * D, pitch = clamp(Math.asin(dy / dl) + (o.pitch || 0) * D, -89.4 * D, 89.4 * D);
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    return {C: pos, yaw, pitch, Fw: [sy * cp, sp, cy * cp], R: [cy, 0, -sy], U: [-sp * sy, cp, -sp * cy], roll: o.roll || 0, zoom: o.zoom || 1,
      subj: Object.assign({x: 0, y: 0, z: 0, turn: 0, walk: null, breath: 0}, o.subj), env: o.env || {}};
  }
  // --- кадр одной карточки ---
  function draw(card, T) {
    const {ctx: g, W, p} = card, h = W / 2, S = sprites();
    const cyc = p.mode === 'ping' ? p.dur * 2 : p.mode === 'loop' ? p.dur + .5 : 1;
    const tt = T + card.off, ph = (tt % cyc) / cyc;
    let t = 0, fade = 0;
    if (p.mode === 'ping') t = ph < .5 ? ph * 2 : (1 - ph) * 2;
    else if (p.mode === 'loop') { const s = ph * cyc; t = clamp((s - .15) / p.dur, 0, 1); fade = s < .15 ? 1 - s / .15 : s > p.dur + .3 ? (s - p.dur - .3) / .2 : 0; }
    const c = camera(p, t, tt), e = c.env, [Cx, Cy, Cz] = c.C, [Rx, , Rz] = c.R, [Ux, Uy, Uz] = c.U, [Fx, Fy, Fz] = c.Fw;
    const fh = F * h;
    // мир → камера → экран
    const toCam = (x, y, z) => { const a = x - Cx, b = y - Cy, d = z - Cz; return [a * Rx + d * Rz, a * Ux + b * Uy + d * Uz, a * Fx + b * Fy + d * Fz]; };
    const scr = q => [h + fh * q[0] / q[2], h - fh * q[1] / q[2]];
    const dirScr = (az, el) => { const x = Math.sin(az) * Math.cos(el), y = Math.sin(el), z = Math.cos(az) * Math.cos(el);
      const q = [x * Rx + z * Rz, x * Ux + y * Uy + z * Uz, x * Fx + y * Fy + z * Fz]; return q[2] > .05 ? scr(q) : null; };
    const clipSeg = (a, b, near = .25) => { if (a[2] < near && b[2] < near) return null;
      if (a[2] < near) { const k = (near - a[2]) / (b[2] - a[2]); a = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, near]; }
      if (b[2] < near) { const k = (near - b[2]) / (a[2] - b[2]); b = [b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k, near]; }
      return [scr(a), scr(b)]; };
    const time = e.time ?? .12, night = clamp(time, 0, 1), pT = e.freeze ? (card.fz ??= tt) : (card.fz = null, tt), speed = e.speed ?? 1;
    const yh = h + fh * Math.tan(clamp(c.pitch, -1.5, 1.5));   // линия горизонта
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; if (hasFilter) g.filter = 'none';
    const lens = () => { g.translate(h, h); g.rotate(-c.roll * D); g.scale(c.zoom, c.zoom); g.translate(-h, -h); };
    g.save(); lens();
    const L = -W * 1.2, B = W * 3.4;
    // перевод фокуса: даль мягкая всегда, сильнее — пока в фокусе передний план
    const bgBlur = e.focus != null && hasFilter ? ((1 - e.focus) * .9 + e.focus * .3) * W * .016 : 0;
    if (bgBlur > .3) g.filter = `blur(${bgBlur.toFixed(1)}px)`;
    // небо
    const pal = DUSK.map((d, i) => mixC(d, NIGHT[i], night));
    const top = h - fh * Math.tan(clamp(62 * D - c.pitch, -1.45, 1.45));
    const sky = g.createLinearGradient(0, Math.min(top, yh - 1), 0, yh);
    sky.addColorStop(0, rgb(pal[0])); sky.addColorStop(.45, rgb(pal[1])); sky.addColorStop(.8, rgb(pal[2])); sky.addColorStop(1, rgb(pal[3]));
    g.fillStyle = sky; g.fillRect(L, L, B, B);
    // звёзды
    const sa = .25 + .75 * night;
    g.fillStyle = '#fff';
    if (bgBlur <= .3) for (const [az, el, s, tw] of STARS) { const q = dirScr(az, el); if (!q) continue;
      g.globalAlpha = sa * (.55 + .45 * Math.sin(tt * 2 + tw)); g.fillRect(q[0], q[1], s * W / 180, s * W / 180); }
    g.globalAlpha = 1;
    // солнце
    const sunEl = lerp(9, -8, night) * D, sun = dirScr(-22 * D, sunEl);
    if (sun) { const r = W * .5; g.globalAlpha = .85 * (1 - night * .7); g.drawImage(S.glow, sun[0] - r, sun[1] - r, r * 2, r * 2);
      g.globalAlpha = 1 - night * .8; const sr = W * .075, sg = g.createLinearGradient(0, sun[1] - sr, 0, sun[1] + sr);
      sg.addColorStop(0, '#fff1c7'); sg.addColorStop(1, '#ff7a55'); g.fillStyle = sg; g.beginPath(); g.arc(sun[0], sun[1], sr, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    // облака
    const cs = e.clouds ?? .4;
    if (bgBlur <= .3) for (const [az0, el, len] of CLOUDS) { const az = az0 + tt * cs * .02, a = dirScr(az, el), b = dirScr(az + len * D, el + 1.2 * D);
      if (!a || !b) continue; g.strokeStyle = rgb(mixC([150, 70, 120], [30, 30, 60], night), .35); g.lineWidth = W * .022; g.lineCap = 'round';
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    // земля
    const gq = [[-200, -200], [200, -200], [200, 200], [-200, 200]].map(([x, z]) => toCam(Cx + x, 0, Cz + z));
    const poly = []; for (let i = 0; i < 4; i++) { const a = gq[i], b = gq[(i + 1) % 4], n = .2;
      if (a[2] >= n) poly.push(scr(a)); if ((a[2] >= n) !== (b[2] >= n)) { const k = (n - a[2]) / (b[2] - a[2]); poly.push(scr([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, n])); } }
    if (poly.length > 2) { const gr = g.createLinearGradient(0, yh, 0, yh + W * 1.4); gr.addColorStop(0, rgb(mixC([64, 28, 70], [18, 12, 34], night)));
      gr.addColorStop(.12, '#130c22'); gr.addColorStop(1, '#040308'); g.fillStyle = gr; g.beginPath(); poly.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.fill(); }
    // лаймовая сетка — «поле»
    const step = 2, gx0 = Math.floor((Cx - 30) / step) * step, gz0 = Math.floor((Cz - 30) / step) * step, far = 30;
    g.beginPath();
    for (let x = gx0; x <= Cx + 30; x += step) { const s = clipSeg(toCam(x, 0, Cz - far), toCam(x, 0, Cz + far)); if (s) { g.moveTo(s[0][0], s[0][1]); g.lineTo(s[1][0], s[1][1]); } }
    for (let z = gz0; z <= Cz + far; z += step) { const s = clipSeg(toCam(Cx - 30, 0, z), toCam(Cx + 30, 0, z)); if (s) { g.moveTo(s[0][0], s[0][1]); g.lineTo(s[1][0], s[1][1]); } }
    const gl = g.createLinearGradient(0, yh, 0, yh + W * .9); gl.addColorStop(0, 'rgba(212,255,58,0)'); gl.addColorStop(.25, 'rgba(212,255,58,.16)'); gl.addColorStop(1, 'rgba(212,255,58,.5)');
    g.strokeStyle = gl; g.lineWidth = Math.max(1, W / 190); g.stroke();
    // горы: дальние — «на бесконечности», ближние — вокруг героя (в поездках — тоже вместе с камерой)
    const ridge = (pts, cx0, cz0, top0, bot0) => {
      const vis = pts.map(([x, y, z]) => { const q = toCam(cx0 + x, y, cz0 + z); if (!(q[2] > 1 && Math.abs(q[0]) < q[2] * 3)) return null; const b = toCam(cx0 + x, 0, cz0 + z), sq = scr(q); return [sq, b[2] > .2 ? scr(b) : [sq[0], sq[1] + W * 2]]; });
      const n = vis.length; let s = vis.findIndex(v => !v); if (s < 0) s = 0;
      const gr = g.createLinearGradient(0, yh - W * .35, 0, yh + W * .05); gr.addColorStop(0, top0); gr.addColorStop(1, bot0); g.fillStyle = gr;
      for (let k = 0; k < n; k++) { const i = (s + k) % n; if (!vis[i]) continue;
        const run = []; while (k < n && vis[(s + k) % n]) { run.push(vis[(s + k) % n]); k++; }
        g.beginPath(); run.forEach(([q], j) => j ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); for (let j = run.length - 1; j >= 0; j--) g.lineTo(run[j][1][0], run[j][1][1] + 2); g.fill();
        g.strokeStyle = 'rgba(255,160,130,.22)'; g.lineWidth = Math.max(1, W / 220); g.beginPath(); run.forEach(([q], j) => j ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.stroke(); }
    };
    ridge(FAR, Cx, Cz, rgb(mixC([66, 42, 118], [20, 18, 44], night)), rgb(mixC([34, 22, 70], [12, 10, 28], night)));
    const hz = g.createLinearGradient(0, yh - W * .12, 0, yh + W * .04); hz.addColorStop(0, 'rgba(255,120,110,0)'); hz.addColorStop(.7, rgb(mixC([255, 120, 110], [80, 60, 120], night), .22)); hz.addColorStop(1, 'rgba(255,120,110,0)');
    g.fillStyle = hz; g.fillRect(L, yh - W * .12, B, W * .16);
    ridge(NEAR, e.travel ? Cx : 0, e.travel ? Cz : 0, rgb(mixC([34, 22, 66], [12, 10, 26], night)), '#0c0818');
    // предметы по глубине: фонари, камни, трава, арка, герой
    const items = [], ppm = z => fh / z;
    if (!e.noLanterns) { const k0 = Math.round(Cx / 24) * 24;
      for (let k = k0 - 24; k <= k0 + 24; k += 24) for (const x of [k - 2.8, k + 2.8]) for (let z = -60; z <= 60; z += 6) {
        const q = toCam(x, 2.6, z); if (q[2] < .5 || q[2] > 60 || Math.abs(q[0]) > q[2] * 1.6) continue; items.push([q[2], 'lamp', x, z, q]); } }
    if (e.car) for (let x = Math.floor((Cx - 20) / 3) * 3; x < Cx + 30; x += 3) for (const [z, s] of [[-2.7, 1.3], [3.6, 1]]) { const q = toCam(x, .6, z); if (q[2] > .3) items.push([q[2], 'post', x, z, q, s]); }
    for (const [k, x, z, s] of PROPS) { const q = toCam(x, 0, z); if (q[2] > .4 && q[2] < 50 && Math.abs(q[0]) < q[2] * 1.8) items.push([q[2], k, x, z, q, s]); }
    if (e.pillar) { const q = toCam(-.35, 0, -4.4); if (q[2] > .3) items.push([q[2], 'pillar', -.35, -4.4, q, 2.5]); }
    if (e.fgrass) { const q = toCam(1.5, 1.15, -6.3); if (q[2] > .2) items.push([q[2], 'flamp', 1.5, -6.3, q]); }
    if (e.arch) { const q = toCam(0, 1.4, -3.2); if (q[2] > .2) items.push([q[2], 'arch']); }
    const sj = c.subj, walk = sj.walk != null, bob = walk ? Math.abs(Math.sin(sj.walk * 5.2)) * .05 : 0;
    const hq = toCam(sj.x, sj.y + .9, sj.z); if (hq[2] > .3) items.push([hq[2], 'hero']);
    items.sort((a, b) => b[0] - a[0]);
    const lampOn = e.time == null ? 1 : clamp((night - .35) / .25, .15, 1);
    for (const it of items) {
      const [z, k] = it;
      if (k === 'lamp') { const [, , x, wz, q] = it, bq = toCam(x, 0, wz); const s = clipSeg(bq, q, .3); if (!s) continue;
        g.strokeStyle = '#0a0812'; g.lineWidth = Math.max(1, ppm(z) * .07); g.beginPath(); g.moveTo(s[0][0], s[0][1]); g.lineTo(s[1][0], s[1][1]); g.stroke();
        const r = ppm(z) * .75, p2 = scr(q); g.globalAlpha = lampOn; g.drawImage(S.glow, p2[0] - r, p2[1] - r, r * 2, r * 2); g.globalAlpha = 1; }
      else if (k === 'post') { const [, , , , q, s] = it, sc = scr(q), sz = ppm(z) * s; g.fillStyle = '#07060b'; g.fillRect(sc[0] - sz * .03, sc[1] - sz * .6, sz * .06, sz * 1.2);
        g.fillStyle = 'rgba(212,255,58,.85)'; g.fillRect(sc[0] - sz * .03, sc[1] - sz * .6, sz * .06, sz * .1); }
      else if (k === 'flamp') {   // огонёк на переднем плане: не в фокусе — большое мягкое боке
        const [, , , , q] = it, sc = scr(q), m = ppm(z);
        if (hasFilter) g.filter = `blur(${(e.focus * W * .03).toFixed(1)}px)`;
        g.strokeStyle = '#0a0812'; g.lineWidth = m * .05; g.beginPath(); g.moveTo(sc[0], sc[1]); g.lineTo(sc[0], sc[1] + m * 1.4); g.stroke();
        const r = m * (.35 + e.focus * .25); g.drawImage(S.glow, sc[0] - r, sc[1] - r, r * 2, r * 2);
        if (hasFilter) g.filter = bgBlur > .3 ? `blur(${bgBlur.toFixed(1)}px)` : 'none'; }
      else if (k === 'rock' || k === 'grass' || k === 'pillar') {
        const [, , , , q, s] = it, sc = scr(q), m = ppm(z) * s, img = k === 'rock' ? S.rock : k === 'pillar' ? S.pillar : S.grass;
        const w = m * (k === 'pillar' ? .95 : 1.25), hh = w * img.height / img.width;
        g.drawImage(img, sc[0] - w / 2, sc[1] - hh, w, hh); }
      else if (k === 'arch') { const pts = [[-1.35, 0], [-1.35, 2.9], [1.35, 2.9], [1.35, 0]].map(([x, y]) => toCam(x, y, -3.2));
        g.lineJoin = 'round'; g.lineCap = 'round';
        for (const [w, col] of [[.3, '#07060b'], [.1, 'rgba(212,255,58,.35)'], [.035, '#e8ff9a']]) { g.strokeStyle = col; g.lineWidth = ppm(z) * w; g.beginPath();
          for (let i = 0; i < 3; i++) { const s = clipSeg(pts[i], pts[i + 1], .2); if (s) { g.moveTo(s[0][0], s[0][1]); g.lineTo(s[1][0], s[1][1]); } } g.stroke(); } }
      else if (k === 'hero') {
        if (hasFilter && e.focus != null) g.filter = `blur(${((1 - e.focus) * W * .012).toFixed(1)}px)`;
        drawHero(true);
        if (hasFilter && e.focus != null) g.filter = bgBlur > .3 ? `blur(${bgBlur.toFixed(1)}px)` : 'none';
      }
    }
    function drawHero(shadow) {
      const feet = toCam(sj.x, sj.y + bob, sj.z), head = toCam(sj.x, sj.y + bob + 1.8, sj.z);
      const dist = Math.hypot(sj.x - Cx, sj.y + 1 - Cy, sj.z - Cz), elev = Math.asin(clamp((Cy - sj.y - 1) / dist, -1, 1));
      // тень на земле
      const sh = []; for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, q = toCam(sj.x + Math.cos(a) * .5, 0, sj.z + Math.sin(a) * .38); if (q[2] > .2) sh.push(scr(q)); }
      if (shadow && sh.length > 10) { g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); sh.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.fill(); }
      if (elev > 58 * D) {   // сверху видно плечи и шапку: контровой свет — полумесяцем с одной стороны
        const q = toCam(sj.x, sj.y + 1.45, sj.z), hq2 = toCam(sj.x, sj.y + 1.7, sj.z); if (q[2] < .2 || hq2[2] < .2) return;
        const sc = scr(q), hs = scr(hq2), m = ppm(q[2]), rot = -c.yaw - Math.PI / 2 + sj.turn * D;
        g.fillStyle = '#16131f'; g.beginPath(); g.ellipse(sc[0], sc[1], m * .29, m * .14, rot + Math.PI / 2, 0, Math.PI * 2); g.fill();
        g.lineWidth = Math.max(1, m * .025); g.strokeStyle = 'rgba(212,255,58,.85)'; g.beginPath(); g.ellipse(sc[0], sc[1], m * .29, m * .14, rot + Math.PI / 2, -1.2, 1.2); g.stroke();
        g.fillStyle = '#221e30'; g.beginPath(); g.arc(hs[0], hs[1], m * .125, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,150,100,.85)'; g.beginPath(); g.arc(hs[0], hs[1], m * .125, 2, 4.3); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(hs[0], hs[1], m * .06, 0, Math.PI * 2); g.fill();
      } else if (feet[2] > .2 && head[2] > .2) {
        const a = scr(feet), b = scr(head), len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[0] - a[0], a[1] - b[1]);
        const hh = len / (240 / 260), w = hh * 120 / 260, turn = Math.cos(sj.turn * D), sx = Math.sign(turn || 1) * Math.max(.5, Math.abs(turn));
        g.save(); g.translate(a[0], a[1]); g.rotate(ang); g.scale(sx, 1 + .012 * sj.breath);
        g.drawImage(S.hero, -w / 2, -hh * 254 / 260, w, hh); g.restore();
      }
    }
    if (hasFilter) g.filter = 'none';
    // пылинки и дождь (в slow-mo)
    g.fillStyle = 'rgba(255,214,170,.9)';
    for (const [x0, y0, z0, s] of DUST) {
      const y = (((y0 + pT * .18 * speed + s) % 5) + 5) % 5, x = Cx + ((((x0 + Math.sin(pT * .4 * speed + s) * .6 - Cx + 9) % 18) + 18) % 18) - 9;
      const z = Cz + ((((z0 - Cz + 13) % 26) + 26) % 26) - 13, q = toCam(x, y, z); if (q[2] < .4 || q[2] > 30) continue;
      const sc = scr(q), r = clamp(fh * .025 / q[2], .5, 3.2) * (W / 200); g.globalAlpha = clamp(1.4 - q[2] / 22, .15, .9); g.fillRect(sc[0] - r / 2, sc[1] - r / 2, r, r); }
    g.globalAlpha = 1;
    if (e.rain) { g.strokeStyle = 'rgba(200,220,255,.55)'; g.lineWidth = Math.max(1, W / 260); g.beginPath();
      for (const [x0, y0, z0] of RAIN) { const y = (((y0 - pT * 2.2 * speed) % 6) + 6) % 6, s = clipSeg(toCam(Cx + x0, y, Cz + 8 + z0), toCam(Cx + x0, y + .45, Cz + 8 + z0), .5);
        if (s) { g.moveTo(s[0][0], s[0][1]); g.lineTo(s[1][0], s[1][1]); } } g.stroke(); }
    g.restore();
    // эффекты объектива: смаз, зум-смаз, обесцвечивание, вспышка, склейка
    const cv = g.canvas;
    const mb = (e.mblur || 0) * W * .06;
    if (mb > .5) { g.globalAlpha = .38; g.drawImage(cv, mb, 0); g.drawImage(cv, -mb, 0); g.globalAlpha = .22; g.drawImage(cv, mb * 2, 0); g.globalAlpha = 1;
      if (e.car) { g.save(); lens(); drawHero(false); g.restore(); } }   // съёмка с авто: мир смазан, герой едет вместе с камерой — чёткий
    const zb = Math.max(e.zoomBlur || 0, (e.mblurZ || 0) * .35);
    if (zb > .03) for (let i = 1; i <= 3; i++) { const s = 1 + zb * .045 * i; g.globalAlpha = .3; g.drawImage(cv, h - h * s, h - h * s, W * s, W * s); }
    g.globalAlpha = 1;
    if (e.desat) { g.globalCompositeOperation = 'saturation'; g.fillStyle = `rgba(128,128,128,${e.desat})`; g.fillRect(0, 0, W, W); g.globalCompositeOperation = 'source-over'; }
    if (e.flash) { g.fillStyle = `rgba(255,255,255,${e.flash * .85})`; g.fillRect(0, 0, W, W); }
    g.drawImage(vignette(W), 0, 0);
    card.grain ??= g.createPattern(S.noise, 'repeat');
    g.save(); g.globalAlpha = .5; g.translate((tt * 97 % 96) | 0, (tt * 61 % 96) | 0); g.fillStyle = card.grain; g.fillRect(-96, -96, W + 96, W + 96); g.restore();
    // видоискатель: уголки рамки, у выбранного — REC
    const m = W * .07, l = W * .09; g.strokeStyle = 'rgba(212,255,58,.5)'; g.lineWidth = Math.max(1, W / 170); g.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, W - m, 1, -1], [W - m, W - m, -1, -1]]) { g.moveTo(x, y + sy * l); g.lineTo(x, y); g.lineTo(x + sx * l, y); }
    g.stroke();
    if (card.el.classList.contains('on') && Math.sin(tt * 5) > -.3) { g.fillStyle = '#ff4d5a'; g.beginPath(); g.arc(m + W * .04, m + W * .085, W * .02, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `700 ${Math.round(W * .055)}px Onest,system-ui,sans-serif`; g.fillText('REC', m + W * .075, m + W * .105); }
    if (fade > 0) { g.fillStyle = `rgba(5,5,8,${clamp(fade, 0, 1)})`; g.fillRect(0, 0, W, W); }
  }
  // --- карточки на экране: рисуем только видимые, по кадрам браузера ---
  const cards = new Map(), vis = new Set();
  let raf = 0, io = null, ro = null;
  const tick = now => { raf = 0; if (!vis.size || document.hidden) return; const T = now / 1000; for (const c of vis) draw(c, T); raf = requestAnimationFrame(tick); };
  const start = () => { if (!raf && vis.size && !document.hidden && !reduce) raf = requestAnimationFrame(tick); };
  document.addEventListener('visibilitychange', start);
  const size = c => { const dpr = Math.min(2, devicePixelRatio || 1), W = Math.max(40, Math.round(c.el.clientWidth * dpr));
    if (W !== c.W) { c.W = c.canvas.width = c.canvas.height = W; c.grain = null; draw(c, performance.now() / 1000); } };
  function mount(grid) {
    io?.disconnect(); ro?.disconnect(); cards.clear(); vis.clear();
    io = new IntersectionObserver(es => { for (const x of es) { const c = cards.get(x.target); if (!c) continue; if (x.isIntersecting) vis.add(c); else vis.delete(c); } start(); }, {rootMargin: '80px 0px'});
    ro = new ResizeObserver(() => cards.forEach(size));
    [...grid.querySelectorAll('.motion-card')].forEach((el, i) => {
      const canvas = el.querySelector('canvas'), p = MOTIONS.find(m => m.id === el.dataset.id);
      if (!canvas || !p) return;
      const c = {el, canvas, ctx: canvas.getContext('2d'), p, off: i * .37 + (reduce ? p.dur || 2 : 0), W: 0, fz: null, grain: null};
      cards.set(el, c); size(c); io.observe(el);
    });
    ro.observe(grid);
  }
  return {mount, redraw: () => cards.forEach(c => c.W && draw(c, performance.now() / 1000))};
})();


const IDEAS = [
  'Рыжая лиса в заснеженном лесу на рассвете',
  'Киберпанк-самурай под неоновым дождём в Токио',
  'Уютная кофейня внутри гигантской тыквы, осенний вечер',
  'Астронавт верхом на лошади по поверхности Марса',
  'Портрет старого рыбака, суровое лицо, морской ветер',
  'Парящий остров с водопадами над облаками',
  'Кот в костюме викторианского детектива читает газету',
  'Футуристический спорткар в пустыне на закате',
  'Девушка в красном платье посреди лавандового поля',
  'Древний дракон спит на горе золота в пещере',
  'Маленький робот поливает цветок на крыше небоскрёба',
  'Подводный город с китами и светящимися медузами',
];

const SYS = {
  image: `You are a world-class prompt engineer for text-to-image models.
Rewrite the user's idea (any language) into ONE vivid English prompt of 40-80 words.
Cover: main subject and action, environment, composition and camera/lens, lighting, mood, color palette, quality details.
Keep every concrete detail the user gave. Do not add text/lettering unless asked.
Output ONLY the prompt: no preamble, no quotes, no lists, no markdown.`,
  video: `You are a prompt engineer for an image-to-video AI model.
From the user's idea (any language), write ONE English prompt of 20-45 words describing MOTION:
what moves and how (subject action, face/body, hair, cloth, particles, water, light), pacing, and camera behaviour.
Keep the user's details. Output ONLY the prompt: no preamble, no quotes, no markdown.`,
  t2v: `You are a prompt engineer for a text-to-video AI model (like Veo or Seedance).
Rewrite the user's idea (any language) into ONE cinematic English prompt of 40-70 words:
subject and appearance, setting, the action unfolding over time, camera movement, lighting, mood, style.
Keep the user's details. Output ONLY the prompt: no preamble, no quotes, no markdown.`,
};

const WAN_NEG = '色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走';

/* =============================== utils =============================== */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const byId = (arr, id) => arr.find(x => x.id === id) || arr[0];
const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fmtUSD = v => v == null ? '—' : '$' + (v < 0.1 ? +v.toPrecision(2) : v.toFixed(2));
const isMobile = () => matchMedia('(max-width: 900px)').matches;
// длинная инструкция — свёрнута в «?» и раскрывается по нажатию (на экране — только главное)
const helpHTML = (title, body, cls = '') => `<details class="help ${cls}"><summary><i>?</i>${title}</summary><div class="help-body">${body}</div></details>`;
const encPrompt = p => encodeURIComponent(p.replace(/[\/\\]/g, ' ').slice(0, 1800));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
// свои стили пользователя: название + описание (suffix — по-английски, что дописать к промпту); хранятся в этом браузере
const STYLE_BG = ['linear-gradient(135deg,#3a1c71,#d76d77)', 'linear-gradient(135deg,#0f3443,#34e89e)', 'linear-gradient(135deg,#42275a,#b06ab3)',
  'linear-gradient(135deg,#1e3c72,#2a5298)', 'linear-gradient(135deg,#c94b4b,#4b134f)', 'linear-gradient(135deg,#8e2de2,#4a00e0)'];
let customStyles = ls.get('freefield.styles.custom', []);
const allStyles = () => [...STYLES, ...customStyles];
const styleOf = id => byId(allStyles(), id);

// подтверждение внутри страницы вместо confirm(): системное окно браузера блокирует управление из ИИ (Claude in Chrome)
// (пользователь 2026-10-09: «Freefield должен быть максимально удобен для нейросети, но с понятным интерфейсом»)
function askYes(msg, yes = 'Да') {
  return new Promise(res => {
    const d = document.createElement('div');
    d.className = 'ask-yes'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', msg);
    d.innerHTML = `<div class="ask-box"><p>${esc(msg)}</p><div class="ask-row"><button class="btn danger" data-ask="1">${esc(yes)}</button><button class="btn" data-ask="0">Отмена</button></div></div>`;
    const done = v => { d.remove(); document.removeEventListener('keydown', key, true); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    d.addEventListener('click', e => { const b = e.target.closest('[data-ask]'); if (b) done(b.dataset.ask === '1'); else if (e.target === d) done(false); });
    document.addEventListener('keydown', key, true);
    document.body.append(d);
    d.querySelector('[data-ask="1"]').focus();
  });
}
function toast(msg, opts = {}) {
  const t = document.createElement('div'), ms = opts.ms || 4200;
  t.className = 'toast ' + (opts.type || '');
  // значок по смыслу и полоска оставшегося времени
  t.innerHTML = `<span class="t-ico">${ic(opts.type === 'ok' ? 'check-circle' : opts.type === 'err' ? 'alert' : 'info')}</span><span>${esc(msg)}</span><i class="t-bar" style="animation-duration:${ms}ms"></i>`;
  if (opts.action) {
    const b = document.createElement('button');
    b.textContent = opts.action;
    b.onclick = () => { opts.onAction(); t.remove(); };
    t.append(b);
  }
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  return t;
}

async function dims(blob) {
  try { const b = await createImageBitmap(blob); const d = [b.width, b.height]; b.close?.(); return d; }
  catch { return null; }
}

async function downscale(blob, max = 1024) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.type === 'image/jpeg') return blob;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  } catch { return blob; }
}

function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function icoStyle(m) {
  if (m.provider === 'ext') return `background:${m.color};color:#fff`;
  if (m.provider === 'flow') return 'background:linear-gradient(135deg,#1a73e8,#34a853 60%,#fbbc05);color:#fff';
  if (m.provider === 'vids') return 'background:conic-gradient(from 200deg,#4285f4,#34a853,#fbbc05,#ea4335,#4285f4);color:#fff';
  if (m.tier === 'free') return 'background:linear-gradient(135deg,#d4ff3a,#7bc41a);color:#0a0a0c;text-shadow:none';
  const h = hue(m.publisher || m.title);
  return `background:linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h + 50) % 360} 65% 38%))`;
}
function initials(m) {
  if (m.ico) return m.ico;
  const w = (m.publisher || m.title).replace(/[^A-Za-zА-Яа-я0-9 ]/g, ' ').trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}


/* =============================== storage =============================== */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('freefield', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('items', {keyPath: 'id'});
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(mode, fn) {
    if (!this.db) return Promise.resolve(null);
    return new Promise((res, rej) => {
      const r = fn(this.db.transaction('items', mode).objectStore('items'));
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  all() { return this.req('readonly', s => s.getAll()); },
  put(it) {
    const clean = {};
    for (const k in it) if (!k.startsWith('_')) clean[k] = it[k];
    return this.req('readwrite', s => s.put(clean)).catch(e => toast('Не удалось сохранить в галерею: ' + e.message, {type: 'err'}));
  },
  del(id) { return this.req('readwrite', s => s.delete(id)).catch(() => {}); },
};

const SETTINGS_KEY = 'freefield.settings.v2';
const state = Object.assign({
  mode: 'image', view: 'create',
  style: 'none', filter: 'all', prompts: {image: '', video: ''},
}, ls.get(SETTINGS_KEY, {}));
// убранное: «Авто-улучшение» промптов (2026-09-27), поля «Других моделей» (2026-10-09)
['autoEnhance', 'aspects', 'vSource', 'models', 'count', 'motion', 'motionGroup', 'duration', 'res', 'audio', 'autoFallback', 'confirmOver'].forEach(k => delete state[k]);
function saveSettings() { ls.set(SETTINGS_KEY, state); }

let items = [];

/* =============================== ключи =============================== */
// Ключи — только в этом браузере. «Другие модели» и оплата убраны (пользователь 2026-10-09): их ключи и траты не храним
const wallet = {
  gemini: ls.get('freefield.gemini', ''),     // Google Gemini (бесплатно: сценарии, перевод промптов)
  anthropic: ls.get('freefield.anthropic', ''),   // Claude (Anthropic) — пишет сценарии, платно по ключу пользователя
};
['key', 'hf', 'hfUser', 'horde', 'spend.v1', 'catalog.v1', 'hfQuotaOut', 'nb21'].forEach(k => ls.del('freefield.' + k));
// ключи в «Настройках» — тем же блоком, что в «Сценариях» (keyCardHTML)
function renderWallet() {
  const el = $('#setKeys');
  if (!el) return;
  const card = (id, title) => { const w = WRITERS[id];
    return `<div class="set-card"><div class="set-card-head"><span class="mc-ico" style="background:${w.color};color:#fff">${esc(w.ico)}</span><div><b>${title}</b></div></div>${keyCardHTML(id)}</div>`; };
  el.innerHTML = card('gemini', 'Google Gemini — сценарии и перевод бесплатно') + card('claude', 'Claude — сценарии, платно по вашему ключу');
}
// модели сайтов (карточки «сделать на сайте», «Мои сервисы»)
const allModels = () => EXT_MODELS;







/* =============================== APIs =============================== */
// Улучшение и перевод промпта: Gemini (бесплатный ключ Google AI Studio), без ключа — только перевод на английский.
const cleanLLM = s => (s || '').trim().replace(/^(prompt|промпт)\s*:\s*/i, '').replace(/^["'«“]+|["'»”]+$/g, '').trim();

async function timedFetch(url, opts, ms = 40000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, {...opts, signal: ctrl.signal}); } finally { clearTimeout(t); }
}

// короткий ответ Gemini (перевод, улучшение промпта); нет ключа или ошибка — null, тогда вызывающий обходится без него
async function geminiShort(sys, text) {
  if (!wallet.gemini) return null;
  try {
    for (const model of (await geminiModels('flash')).slice(0, 3)) {
      const r = await timedFetch(`${GEMINI_API}/${model}:generateContent`, {
        method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': wallet.gemini},
        body: JSON.stringify({systemInstruction: {parts: [{text: sys}]}, contents: [{role: 'user', parts: [{text}]}],
          generationConfig: {temperature: 0.9, maxOutputTokens: 2048}}),
      });
      if (r.status === 404) continue;
      if (!r.ok) return null;
      const j = await r.json();
      return cleanLLM((j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join(''));
    }
  } catch { /* нет связи */ }
  return null;
}

async function translateToEnglish(text) {
  if (!/[а-яё]/i.test(text)) return text;
  const r = await timedFetch('https://api.mymemory.translated.net/get?' + new URLSearchParams({q: text.slice(0, 480), langpair: 'ru|en'}), {}, 15000);
  const j = await r.json();
  const out = j.responseData?.translatedText;
  if (j.responseStatus !== 200 || !out || /MYMEMORY WARNING/i.test(out)) throw new Error('перевод недоступен');
  return out;
}

// кнопка «🌐 На английский»: только перевод, без добавок. С ключом Gemini — умный перевод,
// без ключей — бесплатный переводчик кусками (у него предел ~480 символов за раз), чтобы длинный промпт не обрезался
async function translatePrompt(text) {
  if (!/[а-яё]/i.test(text)) return text;
  const sys = 'Translate the user text into natural English for an AI image/video generation prompt. Keep every detail, name, number and the order of ideas; add nothing, remove nothing. Output only the translation.';
  const smart = await geminiShort(sys, text);
  if (smart?.length >= 3 && !/[а-яё]{4,}/i.test(smart)) return smart;
  const parts = [], sentences = text.split(/(?<=[.!?…\n])\s+/);
  for (const s of sentences) {
    if (parts.length && (parts[parts.length - 1] + ' ' + s).length <= 450) parts[parts.length - 1] += ' ' + s;
    else for (let i = 0; i < s.length; i += 450) parts.push(s.slice(i, i + 450));
  }
  const out = [];
  for (const part of parts) out.push(await translateToEnglish(part));
  return out.join(' ');
}
// промпт — как написан: русский только переводится на английский как есть (реплики в «» остаются), ничего не добавляется
async function asIs(text) {
  if (!/[а-яё]/i.test(text || '')) return text;
  try { return await translateKeepQuotes(text); } catch { return text; }
}

async function enhancePrompt(text, kind) {
  const out = await geminiShort(SYS[kind] || SYS.image, text);
  if (out?.length >= 8) return out;
  return translatePrompt(text);   // без ключей: хотя бы переводим на английский (кусками — длинный промпт не обрежется)
}

// ---- Gradio-очередь на бесплатных GPU Hugging Face (ZeroGPU) — для «Точного голоса» (Seed-VC) ----
class GpuError extends Error { constructor(msg, kind = 'other') { super(msg); this.kind = kind; } }

function gpuError(raw, title = '') {
  const s = String(raw ?? '');
  if (/quota/i.test(s + ' ' + title)) {
    const m = s.match(/Try again in (\d+):(\d+):\d+/);
    const mins = m ? +m[1] * 60 + +m[2] : 0;
    const when = mins >= 60 ? ` (обновится через ≈ ${Math.round(mins / 60)} ч)` : mins > 0 ? ` (обновится через ${mins} мин)` : '';
    return new GpuError(`закончился дневной бесплатный лимит GPU${when}`, 'quota');
  }
  if (!s || s === 'null') return new GpuError('бесплатный GPU не справился — попробуйте ещё раз', 'busy');
  return new GpuError(s.slice(0, 180));
}

const gradioFns = {};
async function gradioFnIndex(host, endpoint) {
  const key = host + endpoint;
  if (gradioFns[key] == null) {
    let r;
    try { r = await fetch(host + '/config'); } catch { throw new GpuError('нет связи с бесплатным GPU', 'down'); }
    if (!r.ok) throw new GpuError(`бесплатная модель сейчас недоступна (${r.status})`, 'down');
    const deps = (await r.json()).dependencies || [];
    const i = deps.findIndex(d => d.api_name === endpoint);
    if (i < 0) throw new GpuError('бесплатная модель изменила API', 'down');
    gradioFns[key] = deps[i].id ?? i;
  }
  return gradioFns[key];
}

async function gradioUpload(host, blob, name = 'frame.jpg') {
  const fd = new FormData();
  fd.append('files', blob, name);
  const r = await fetch(host + '/gradio_api/upload', {method: 'POST', body: fd});
  if (!r.ok) throw new GpuError(`бесплатный GPU недоступен (${r.status})`, 'down');
  const [path] = await r.json();
  return {path, meta: {_type: 'gradio.FileData'}};
}

// ставит задачу в очередь Space и читает поток событий: позиция в очереди, прогресс, результат или точная ошибка
async function gradioCall(host, endpoint, data, onStatus, runMsg = 'GPU генерирует…') {
  const fn_index = typeof endpoint === 'number' ? endpoint : await gradioFnIndex(host, endpoint);   // число — уже найденный fn_index
  const session_hash = Math.random().toString(36).slice(2, 12);
  let r;
  try {
    r = await fetch(`${host}/gradio_api/queue/join`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({data, fn_index, session_hash, trigger_id: null, event_data: null})});
  } catch { throw new GpuError('нет связи с бесплатным GPU', 'down'); }
  if (!r.ok) throw new GpuError(`бесплатный GPU недоступен (${r.status})`, 'down');
  onStatus('Встаю в очередь GPU…');
  r = await fetch(`${host}/gradio_api/queue/data?session_hash=${session_hash}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let m;
        try { m = JSON.parse(line.slice(5)); } catch { continue; }
        if (m.msg === 'estimation') onStatus(m.rank > 0 ? `Очередь GPU: ${m.rank + 1}-й${m.rank_eta ? ` · ≈ ${Math.ceil(m.rank_eta)} с` : ''}` : 'Сейчас начнём…');
        else if (m.msg === 'process_starts') onStatus(runMsg);
        else if (m.msg === 'progress') { const p = m.progress_data?.[0]; if (p?.length) onStatus(`${runMsg} ${Math.round(100 * p.index / p.length)}%`); }
        else if (m.msg === 'process_completed') {
          if (m.success) return m.output.data;
          throw gpuError(m.output?.error, m.output?.title || m.title);
        }
        else if (m.msg === 'unexpected_error') throw gpuError(m.message);
      }
    }
  } finally { reader.cancel().catch(() => {}); }
  throw new GpuError('бесплатный GPU оборвал соединение', 'busy');
}
