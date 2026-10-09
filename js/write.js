'use strict';
/* ---- «Сценарии»: ИИ пишет сценарии рилсов по инфографике (о чём ролик) и развёртке героя (как он выглядит) ---- */
// Кто пишет — модуль выбора ИИ: Claude (ключ Anthropic, платно — лучший сценарист), Gemini (бесплатный ключ Google)
// или «ИИ в чате» (задание копируется в буфер — для Gemini, Claude, ChatGPT). Dola убрана по просьбе пользователя (2026-09-26): пишет слабо.
// «Claude (подписка)» и «Бесплатный ИИ» — пользователь 2026-10-09: «AI Studio постоянно проблемы с ключом… у меня подписка есть»,
// «Freefield отдаёт задание в Claude Code, сценарий идёт куда надо». Подписка — через программу Freefield на компьютере (Claude Code)
const WRITERS = {
  sub: {name: 'Claude (подписка)', ico: '✳', color: 'linear-gradient(135deg,#d97757,#7c3aed)', what: 'Пишет Claude Code на вашем компьютере — по подписке Claude, без ключа и доплат'},
  claude: {name: 'Claude', ico: '✳', color: 'linear-gradient(135deg,#e08a64,#b1532f)', what: 'Лучший сценарист. Платно — с вашего счёта Anthropic, обычно центы за раз'},
  gemini: {name: 'Gemini', ico: '✦', color: 'linear-gradient(135deg,#4285f4,#9b72cb,#d96570)', what: 'Пишет очень хорошо, бесплатно — нужен бесплатный ключ Google'},
  free: {name: 'Бесплатный ИИ', ico: '◌', color: 'linear-gradient(135deg,#64748b,#334155)', what: 'Без ключа и регистрации (Pollinations). Пишет слабее и не видит картинки — запасной вариант'},
  chat: {name: 'ИИ в чате', ico: '💬', color: 'linear-gradient(135deg,#7c5cff,#4c1d95)', what: 'Без ключа — скопируется ваш эталонный промпт и просьба написать сценарии; вставьте в чат с Gemini, Claude или ChatGPT'},
};
const CLAUDE_MODELS = [['claude-opus-5-5', 'Opus 5.5 — самый сильный'], ['claude-sonnet-5', 'Sonnet 5 — быстрее и дешевле']];
// Эталонный промпт пользователя для видео. Пользователь 2026-10-09 прислал новый — по таймкодам: подпись блока на своей строке,
// под ней строки «(0:00–0:03) …» (по-русски, переведён на английский). Таймкоды — для ролика 10 с; ИИ растягивает их под длину ролика
const REF_BLOCKS = ['Scenes & Shot cuts', 'On-screen text', 'Spoken line', 'Automatic subtitles', 'Action & Emotions', 'Pose & body language', 'Location', 'Camera & framing', 'Sound design', 'Timing & pacing'];
const REF_OLD = ['On-screen text', 'Spoken line', 'Action', 'Automatic subtitles', 'Pose & body language', 'Location', 'Camera & framing', 'Sound design', 'Timing & pacing'];
const REF_PROMPT = `Scenes & Shot cuts:
(0:00–0:03) Scene 1: [Description]
(0:03–0:07) Scene 2: [Description]
(0:07–0:10) Scene 3: [Description]
On-screen text:
(0:00–0:10) [On-screen text]
Spoken line:
(0:00–0:03) "[Line 1]"
(0:03–0:07) "[Line 2]"
(0:07–0:10) "[Line 3]"
Automatic subtitles:
(0:00–0:03) [Subtitles 1]
(0:03–0:07) [Subtitles 2]
(0:07–0:10) [Subtitles 3]
Action & Emotions:
(0:00–0:03) [Actions 1]
(0:03–0:07) [Actions 2]
(0:07–0:10) [Actions 3]
Pose & body language:
(0:00–0:10) [Pose and gestures]
Location:
(0:00–0:10) [Location]
Camera & framing:
(0:00–0:03) [Camera 1]
(0:03–0:07) [Camera 2]
(0:07–0:10) [Camera 3]
Sound design:
(0:00–0:03) [Sound 1]
(0:03–0:07) [Sound 2]
(0:07–0:10) [Sound 3]
Timing & pacing:
(0:00–0:10) [Overall pace]`;
// таймкод строки эталона: «(0:00–0:03)»
const REF_TC = /\(\d+:\d{2}\s*[–—-]\s*\d+:\d{2}\)/;
// подписи блоков эталона, который пользователь вписал в «Сценариях» (строки «Подпись: …»)
const refLabels = () => { const l = [...String(wr.ref || '').matchAll(/^\s*([A-Za-zА-Яа-яЁё][^:\n]{1,40}):/gm)].map(m => m[1].trim()); return l.length ? l : REF_BLOCKS; };
const isBlockPrompt = t => { const known = new Set([...REF_BLOCKS, ...REF_OLD, ...refLabels()]);
  return [...String(t || '').matchAll(/^\s*([^:\n]{2,40}):/gm)].filter(m => known.has(m[1].trim())).length >= 3; };
// блочный промпт → на английский построчно: подписи блоков остаются, текст на экране и реплика героя — как написаны
// (по-русски), в остальных блоках переводится всё, кроме кусков в «кавычках»
async function translateBlocks(text) {
  const keep = ['On-screen text', 'Spoken line', 'Automatic subtitles'];
  let cur = '';   // блок, под которым стоит строка «(0:00–0:03) …»
  const lines = await Promise.all(String(text).split('\n').map(async line => {
    const lab = line.match(/^([A-Za-z][A-Za-z &/-]+):\s*(.*)$/), tc = !lab && line.match(/^(\s*\(\d+:\d{2}\s*[–—-]\s*\d+:\d{2}\))\s*(.*)$/);
    if (lab) cur = lab[1];
    const m = lab || (tc && [line, tc[1], tc[2]]);
    if (!m || keep.includes(lab ? m[1] : cur) || !/[а-яё]/i.test(m[2])) return line;
    const quotes = [];
    const safe = m[2].replace(/«[^»]*»/g, q => `[${quotes.push(q) - 1}]`);
    if (!/[а-яё]/i.test(safe)) return line;
    try { return `${m[1]}${lab ? ':' : ''} ${(await translatePrompt(safe)).replace(/\[(\d+)\]/g, (_, n) => quotes[+n] ?? '')}`; } catch { return line; }
  }));
  return lines.join('\n');
}
// обычный промпт → на английский как есть (ничего не дописывая); надписи и реплики в «» остаются по-русски
async function translateKeepQuotes(text) {
  const quotes = [];
  const safe = String(text).replace(/«[^»]*»/g, q => `[${quotes.push(q) - 1}]`);
  if (!/[а-яё]/i.test(safe)) return text;
  return (await translatePrompt(safe)).replace(/\[(\d+)\]/g, (_, n) => quotes[+n] ?? '');
}
const wr = {
  ai: (a => a === 'dola' ? 'auto' : a)(ls.get('freefield.write.ai', 'auto')),
  claudeModel: ls.get('freefield.write.claudeModel', CLAUDE_MODELS[0][0]),
  count: ls.get('freefield.write.count', 3),
  idea: ls.get('freefield.write.idea', ''),
  info: ls.get('freefield.write.info', null),     // инфографика (data URL)
  sheet: ls.get('freefield.write.sheet', null),   // развёртка героя (data URL)
  // кадры «персонаж в локации» (шаг 2 инструкции, обязательно): по одному на сценарий, по порядку — сценарий 1 по кадру 1…
  // хранятся в IndexedDB (10 фото в localStorage не влезут) — загружаются после открытия хранилища, см. wrLocsLoad
  locs: [],
  result: ls.get('freefield.write.result', null), // {scenarios, by, at} или {raw, by, at} — ответ не по формату
  ref: (r => { if (ls.get('freefield.write.ref.v', 1) >= 2) return r;
    if (r && r.trim() !== REF_OLD.map(b => b + ':').join('\n')) ls.set('freefield.write.ref.prev', r);
    ls.set('freefield.write.ref.v', 2); ls.set('freefield.write.ref', REF_PROMPT); return REF_PROMPT; })(ls.get('freefield.write.ref', REF_PROMPT)),   // эталонный промпт: по нему ИИ пишет видео-промпты
  char: ls.get('freefield.write.char', null),       // персонаж роликов: его развёртка — в ячейке, его голос ИИ впишет в каждый сценарий
  busy: false, note: '', pick: 'info',
  save() {
    for (const k of ['ai', 'claudeModel', 'count', 'idea', 'result', 'ref', 'char']) ls.set('freefield.write.' + k, this[k]);
    // картинки — только пока хватает места в браузере (без них раздел просто попросит загрузить их снова)
    ls.set('freefield.write.info', this.info); ls.set('freefield.write.sheet', this.sheet);
  },
};
// кадры локаций — отдельной записью в хранилище галереи (в галерею она не попадает: у неё нет status)
const WR_LOCS_ID = 'freefield-write-locs';
const wrLocsSave = () => DB.put({id: WR_LOCS_ID, locs: wr.locs});
async function wrLocsLoad() {
  const old = ls.get('freefield.write.loc', null);   // прежде был один кадр — в localStorage
  const rec = await DB.req('readonly', s => s.get(WR_LOCS_ID)).catch(() => null);
  wr.locs = rec?.locs?.length ? rec.locs : old ? [old] : [];
  if (old) { ls.del('freefield.write.loc'); if (!rec?.locs?.length) wrLocsSave(); }
  if (cl.mode === 'write') renderWrite();
  else if (cl.mode === 'scn') renderScn();
  updateGenButton();
}
// сколько кадров локаций не хватает (<0 — лишние): сценариев столько же, сколько кадров
const wrLocGap = () => wr.count - wr.locs.length;
function wrLocMsg() {
  const n = wr.count, have = wr.locs.length;
  return have < n ? `Загрузите кадры «персонаж в локации»: ${n} ${plur(n, 'сценарий', 'сценария', 'сценариев')} — ${n} фото героя в разных локациях, сейчас ${have}`
    : `Кадров в локациях ${have}, а сценариев ${n} — уберите лишние кадры или выберите ${have} ${plur(have, 'сценарий', 'сценария', 'сценариев')}`;
}
// персонаж роликов: его развёртка — в ячейку; у него развёртки нет — убираем из ячейки чужую (другого персонажа)
function wrUseChar(c) {
  wr.char = c.id;
  if (c.sheet) wr.sheet = c.sheet;
  else if (vc.chars.some(x => x.sheet && x.sheet === wr.sheet)) wr.sheet = null;
  // из «Персонажей»: его инфографика и кадры в локациях встают в ячейки (своих нет — остаются нынешние)
  if (c.info) wr.info = c.info;
  if (c.locs?.length) { wr.locs = [...c.locs]; wr.count = Math.min(CL_MAX, c.locs.length); wrLocsSave(); }
}
// что персонаж принёс в «Сценарии» — для подсказки
const wrCharTook = c => [c.sheet && 'развёртка', c.info && 'инфографика', c.locs?.length && `${c.locs.length} ${plur(c.locs.length, 'кадр', 'кадра', 'кадров')} в локациях`, c.flow?.name && `голос во Flow ${c.flow.kind === 'char' ? '@' : '@Voice: '}${c.flow.name}`].filter(Boolean).join(', ');
// сменили развёртку в ячейке: у персонажа её не было — теперь это его развёртка; была другая — выбор снимаем (иначе ИИ дал бы герою чужой голос)
function wrCharCheck() {
  const c = vc.char(wr.char);
  if (!c) return;
  if (!c.sheet && wr.sheet) { c.sheet = wr.sheet; vc.saveChars(); }
  else if (c.sheet !== wr.sheet) wr.char = null;
}
// ИИ готов писать прямо сейчас: подписка — нужна программа на компьютере с Claude Code, Claude и Gemini — ключ
const writerReady = id => id === 'sub' ? !!(hubLink.ok && hubHas('claude')) : id === 'claude' ? !!wallet.anthropic : id === 'gemini' ? !!wallet.gemini : !!WRITERS[id];
const writerAuto = () => ['sub', 'claude', 'gemini', 'free'].find(writerReady);
const writerNow = () => WRITERS[wr.ai] ? wr.ai : writerAuto();

// заполненный эталон: каждый блок — с новой строки «Подпись: …» (ИИ иногда пишет всё в одну строку, с **жирным** или в ```)
function fillBlocks(text) {
  const labels = [...new Set([...refLabels(), ...REF_BLOCKS, ...PHOTO_BLOCKS])].sort((a, b) => b.length - a.length)
    .map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  const re = new RegExp(`[ \\t]*\\**[ \\t]*\\b(${labels.join('|')})[ \\t]*\\**[ \\t]*:[ \\t]*\\**[ \\t]*`, 'g');   // подписи — с большой буквы, как в эталоне
  return String(text || '').replace(/```[\w-]*/g, '').replace(re, (m, l) => `\n${l.replace(/\s+/g, ' ')}: `)
    .replace(/[ \t]*(\(\d+:\d{2}\s*[–—-]\s*\d+:\d{2}\))/g, '\n$1')   // «(0:00–0:03) …» — каждая с новой строки
    .replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
// вставленный промпт похож на эталон (≥3 подписей блоков — хоть в одну строку) → разложить по блокам, как эталон;
// строку «Сценарий N» над блоками (так отвечает ИИ в чате) убираем
function pastedBlocks(text) {
  // целый сценарий из чата (Block 1. Photo / Block 2. Video prompt / Block 3. Post caption) — в сценарий идёт только видео-промпт
  const video = String(text || '').match(/^[^\n]*Block\s*2\b[^\n]*\n([\s\S]*?)(?=\n[^\n]*Block\s*\d\b|(?![\s\S]))/im);
  const t = fillBlocks(video ? video[1] : text).replace(/^\s*Сценарий\s*\d+\s*[:.]?\s*\n/i, '');
  return isBlockPrompt(t) ? t : null;
}
const blocksHTML = t => fillBlocks(t).split('\n').filter(l => l.trim()).map(l => {
  const m = l.match(/^([^:\n]{2,40}):\s*(.*)$/);
  return m ? `<div><b>${esc(m[1])}:</b> ${esc(m[2])}</div>` : `<div>${esc(l)}</div>`;
}).join('');

// задание для ИИ: структура рилса пользователя (хук → речь с жестами → призыв); на выходе — эталонный промпт, только заполненный
// (пользователь 2026-09-26: «выходной промпт для сценария должен быть ровно такой, как эталонный — только заполненный»)
function writeBrief() {
  const n = wr.count, sec = cl.seconds, words = Math.round(sec * 2.3);
  // три части ролика, как в эталоне (0–3 / 3–7 / 7–10 при 10 с) — под длину ролика
  const a1 = Math.max(2, Math.round(sec * 0.3)), mid = Math.max(a1 + 2, Math.round(sec * 0.7)), tc = s => `0:${String(s).padStart(2, '0')}`;
  const segs = `(${tc(0)}–${tc(a1)}) / (${tc(a1)}–${tc(mid)}) / (${tc(mid)}–${tc(sec)})`, timed = REF_TC.test(wr.ref || '');
  // кадры «персонаж в локации»: по одному на сценарий — IMAGE 3 для сценария 1, IMAGE 4 для сценария 2…
  const L = Math.min(wr.locs.length, n), many = L > 1;
  const ref = (wr.ref || '').trim() || REF_PROMPT, shape = refLabels().map(l => `${l}: …`), labels = refLabels().map(l => l.toLowerCase());
  // голос выбранного персонажа — один и тот же во всех роликах: ИИ вписывает его слово в слово (не впишет — допишем сами, см. withVoice)
  const voice = wrVoice(), hero = VC_G[voice?.g || vc.char(wr.char)?.g]?.[2] || 'the man', him = {'the man': 'him', 'the woman': 'her'}[hero] || 'the hero';
  const about = (vc.char(wr.char)?.about || '').trim().replace(/[«»]/g, '"');   // «кто он» из «Персонажей»
  // язык речи героя (пользователь 2026-09-28: герой может говорить по-английски) — реплики, надписи и субтитры на нём
  const lang = vc.char(wr.char)?.lang === 'en' ? 'English' : 'Russian', en = lang === 'English';
  // подсказки — только к тем блокам, что есть в эталоне пользователя
  const guide = [
    ['Scenes & Shot cuts', 'what each shot shows and where the cut is; the first shot starts exactly like the location image'],
    ['Action & Emotions', 'what the hero does and feels in each part, including a concrete action with the hands or a prop'],
    ['On-screen text', `the ${lang} hook text in «» with its timing and place (0–2 s, upper third) and the ${lang} CTA text in «» for ${mid}–${sec} s, plus font style`],
    ['Spoken line', timed ? `the exact ${lang} speech of each part in «»${voice ? `; the label line itself carries the fixed voice: "Spoken line: voice — ${voice.en}"` : ''}`
      : voice ? `the hero's fixed voice word for word, then the exact ${lang} speech in «» with timing (e.g. "voice — ${voice.en}; ${a1}-${mid} s, in ${lang}: «…» ${mid}-${sec} s: «…»")`
      : `the hero's exact ${lang} speech in «», with timing and the voice (e.g. "${a1}-${mid} s, deep calm male voice, in ${lang}: «…» ${mid}-${sec} s: «…»")`],
    ['Action', 'what happens second by second, including the concrete action with the hands or a prop'],
    ['Automatic subtitles', `the burned-in subtitles of each part — the same words as the spoken line, in ${lang}; style once: bottom third, bold white sans-serif with a dark outline, word-synced`],
    ['Pose & body language', 'posture, gestures, facial expression, eye contact'],
    ['Location', `only the place, light and its details${L ? ` exactly as on ${many ? "the scenario's own location image" : 'IMAGE 3'}` : ''} — never the hero's appearance`],
    ['Camera & framing', 'shot size, angle, lens, movement, vertical 9:16'],
    ['Sound design', 'voice, ambient sound, effects, music (or none)'],
    ['Timing & pacing', `the beat timing ${segs} and the rhythm`],
  ].filter(([l]) => labels.includes(l.toLowerCase())).map(([l, t]) => `  ${l} — ${t}.`).join('\n');
  const intro = `You are a top short-form video scriptwriter (Reels / TikTok / Shorts) and an expert prompt engineer for AI video models (Veo, Omni, Seedance) and image models (Nano Banana).
You receive ${L + 2} images:
IMAGE 1 — INFOGRAPHIC: the product / topic / offer the reels are about. Read every word on it. Build the scripts on its real facts, numbers and benefits; never invent facts, prices or numbers that are not on it.
IMAGE 2 — CHARACTER TURNAROUND SHEET: the hero of every reel (front, side and back views, face close-up, clothing, accessories, tattoos). The asset_prompt describes him exactly as drawn — age, build, face, hair and beard, every clothing item with its colour, accessories, distinctive marks. The video_prompt does NOT describe his appearance at all: the video model receives this sheet${L ? " and the scenario's location image" : ''} as references.${many ? `
IMAGES 3–${L + 2} — CHARACTER IN LOCATION, one per scenario, in order: IMAGE 3 is scenario 1, IMAGE 4 is scenario 2, and so on. The hero is already placed in the scene. Each scenario takes place exactly in its own location (same place, light, props); its image is the first frame of its video.` : L ? `
IMAGE 3 — CHARACTER IN LOCATION: the hero already placed in the scene. The reel takes place exactly here (same place, light, props); this image is the first frame of the video.` : ''}${about ? `
THE HERO'S PERSONALITY (the author's words, in Russian): «${about}». Keep this character, attitude and manner of speech in every scenario — in what he says and how he acts; it never changes his look.` : ''}

Write ${n} different reel scenario${n > 1 ? 's' : ''}, ${sec} seconds each, vertical 9:16, for ${en ? 'an English' : 'a Russian'}-speaking audience. Mandatory structure of every reel:
1) 0–${a1} s HOOK: an intriguing first line or action that stops the scroll; the hook text sits in the upper third. Hook text: ${lang}, at most 7 words, hits curiosity or pain.
2) ${a1}–${mid} s: the hero speaks ${lang} in short natural spoken sentences and does a concrete action with the hands or a prop connected to the infographic.
3) ${mid}–${sec} s CTA: a short spoken call to action; CTA text for the screen in ${lang}.
All speech of one reel together: at most ${words} ${lang} words, so it fits the time.
Every scenario uses a different angle (pain → solution, myth vs fact, mini-story, comparison, secret / life hack, common mistake…)${many ? `; scenario k is set in the location of its own image (scenario 1 — IMAGE 3, scenario 2 — IMAGE 4…), and the scenarios are returned in this order.` : L ? ', set in the location of IMAGE 3.' : ' and a different location that suits the hero and the topic.'}`;
  // сам сценарий = эталонный промпт автора, только заполненный: те же подписи, тот же порядок, блок — строка
  const template = `THE SCENARIO FORMAT — the AUTHOR'S REFERENCE PROMPT below, only filled in: exactly the same labels, in the same order, nothing renamed, merged, skipped or added.${timed ? ` Each label stays on its own line ("Label:") and below it come its timecoded lines "(m:ss–m:ss) …" exactly as in the reference — the same number of lines per block; [placeholders] are replaced with real content, the brackets disappear. The reference timecodes are written for a 10-second reel: rescale them to ${sec} s — ${segs}; a "(0:00–0:10)" line covers the whole reel (0:00–${tc(sec)}).` : ' Every block on its own line as "Label: content".'} If a block in the reference already contains text (not a [placeholder]), that text is the author's rule for the block — follow it in every scenario.
AUTHOR'S REFERENCE PROMPT:
<<<
${ref}
>>>
${guide ? `How to fill the blocks:\n${guide}\n` : ''}${voice ? `THE HERO'S VOICE is fixed for this character and must sound the same in every reel: "${voice.en}". Write it into the Spoken line word for word, as "voice — ${voice.en};" before the timing; never describe or change the voice anywhere else.\n` : ''}${en ? 'Everything is in English; the on-screen texts and the spoken line go in «».' : 'Everything is in English, except the Russian texts in «» (on-screen text, spoken line).'} No filler: never describe the hero's appearance (age, face, hair, beard, clothes, tattoos) in any block — call ${him} just "${hero}"; the look comes from the reference images. 90–180 words per scenario.`;
  const sys = `${intro}

${template}

For every scenario return:
• title — a short Russian name; angle — the Russian name of the approach (боль, миф…);
• video_prompt — the scenario itself: the filled reference prompt (lines separated by \\n inside the JSON string, no markdown);
• caption — the post text for this reel in ${lang}: 1–3 short catchy sentences and 5–8 relevant hashtags;
• asset_prompt — the photo of the first frame for the Nano Banana image model (it gets the turnaround sheet as a reference), English, 60–120 words, in the same block system — exactly these labels, one per line, all filled in:
  Subject: the same hero exactly as on the sheet — age, build, face, hair and beard, every clothing item with its colour, accessories, distinctive marks
  Pose & expression: the pose, gesture and facial expression of the first frame
  Action: what he is doing in the first frame
  Location: the scenario's place${L ? ' exactly as on its location image' : ''} — props, details
  Lighting: light source, time of day, mood
  Camera & framing: vertical 3:4, shot size, angle, lens
  Style: photorealistic documentary photography, natural body posture, high detail
  Avoid: text, watermark

Answer with ONLY one JSON object inside a single \`\`\`json code block — no text before or after it:
{"scenarios":[{"title":"…","angle":"…","video_prompt":"${shape.join('\\n')}","caption":"…","asset_prompt":"${PHOTO_SHAPE.join('\\n')}"}]}`;
  const user = `Первая картинка — инфографика, вторая — развёртка героя${many ? `, дальше — ${L} ${plur(L, 'кадр', 'кадра', 'кадров')} героя в разных локациях: по одному на сценарий, по порядку` : L ? ', третья — герой в локации' : ''}.\nСценариев: ${n}, длина каждого: ${sec} секунд.\nПожелания автора: ${wr.idea.trim() || 'нет — выбери самые сильные углы для этой темы и аудитории'}`;
  // для чата с любым ИИ (Gemini, Claude, ChatGPT): просьба написать N сценариев и структура ответа автора (пользователь 2026-09-27):
  // «N. Название» → Block 1. Photo (промпт ассета) → Block 2. Video prompt (эталон, только заполненный) → Block 3. Post caption;
  // каждый блок — в своём блоке кода. Пожелания — если автор их вписал
  const fence = '```';
  const chat = `Напиши ${n} ${plur(n, 'сценарий', 'сценария', 'сценариев')}. Каждый сценарий выдай ровно в такой структуре:

1. Название сценария
Block 1. Photo

${fence}
Subject: <герой точно как на развёртке: возраст, лицо, волосы, одежда с цветами, аксессуары>
Pose & expression: <поза и выражение лица первого кадра>
Action: <что он делает в первом кадре>
Location: <место первого кадра, предметы>
Lighting: <свет, время суток, настроение>
Camera & framing: vertical 3:4, <крупность, ракурс, объектив>
Style: photorealistic documentary photography, natural body posture, high detail
Avoid: text, watermark
${fence}

Block 2. Video prompt

${fence}
${ref}
${fence}

Block 3. Post caption

${fence}
<текст поста к ролику и хэштеги>
${fence}

В Block 2 внешность героя не описывай — её возьмут из фото (развёртка и «персонаж в локации»); в Location — только место.${en ? ' Герой говорит по-английски: реплики, надписи на экране и субтитры — на английском, для англоязычной аудитории.' : ''}${about ? ` Характер героя: ${about} — держи его в каждом сценарии.` : ''}${voice ? ` Голос героя — один и тот же во всех сценариях: строка Spoken line начинается словами "voice — ${voice.en};" — слово в слово, по-английски; другой голос нигде не описывай.` : ''}${many ? ` Приложены ${L} фото героя в разных локациях (после инфографики и развёртки) — по одному на сценарий, по порядку: сценарий 1 — в локации с первого из них, сценарий 2 — со второго и так далее; место действия — ровно как на фото.` : L ? ' Место действия — как на приложенном фото «персонаж в локации».' : ''}${wr.idea.trim() ? `

Пожелания: ${wr.idea.trim()}` : ''}`;
  return {sys, user, chat};
}

// ответ ИИ → список сценариев (JSON в блоке кода, просто JSON или JSON посреди текста); не вышло — null
function parseScenarios(raw, code = '') {
  const tries = [code, (String(raw).match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], raw].filter(Boolean);
  const str = v => typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  const out = list => list.map(o => ({title: str(o.title) || 'Сценарий', angle: str(o.angle), location: str(o.location), hook: str(o.hook), cta: str(o.cta),
    beats: (Array.isArray(o.beats) ? o.beats : []).map(b => ({time: str(b.time), action: str(b.action), speech: str(b.speech)})),
    asset_prompt: fillBlocks(str(o.asset_prompt)), caption: str(o.caption), video_prompt: fillBlocks(str(o.video_prompt))}));
  for (const t of tries) {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) continue;
    const s = t.slice(a, b + 1);
    for (const x of [s, s.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const j = JSON.parse(x), list = Array.isArray(j) ? j : j.scenarios;
        if (Array.isArray(list) && list.length) return out(list);
      } catch { /* следующий вариант */ }
    }
  }
  // ответ оборвался (упёрся в лимит длины) — берём сценарии, дописанные целиком
  for (const t of tries) {
    const list = jsonWhole(t).filter(o => o && typeof o === 'object' && o.video_prompt);
    if (list.length) return out(list);
  }
  return null;
}
// целые объекты из массива «scenarios» (или из массива в начале текста), даже если сам текст оборван
function jsonWhole(t) {
  const m = /"scenarios"\s*:\s*\[/.exec(t) || /^\s*\[/.exec(t);
  if (!m) return [];
  const list = [];
  let depth = 0, from = -1, str = false, bs = false;
  for (let i = m.index + m[0].length; i < t.length; i++) {
    const ch = t[i];
    if (str) { if (bs) bs = false; else if (ch === '\\') bs = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') str = true;
    else if (ch === '{') { if (!depth++) from = i; }
    else if (ch === '}') { if (depth && !--depth) try { list.push(JSON.parse(t.slice(from, i + 1))); } catch { /* битый — пропускаем */ } }
    else if (ch === ']' && !depth) break;
  }
  return list;
}

const b64 = d => { const m = /^data:((?:image|video)\/[\w.+-]+);base64,(.+)$/.exec(d || ''); if (!m) throw new Error('картинка не прочиталась — загрузите её снова'); return {mime: m[1], data: m[2]}; };
// media — свои картинки с подписями [[подпись, data URL], …] (ИИ-монтажёр); без них — ячейки «Сценариев»
async function writeClaude(sys, user, media) {
  const img = d => { const x = b64(d); return {type: 'image', source: {type: 'base64', media_type: x.mime, data: x.data}}; };
  const r = await timedFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-api-key': wallet.anthropic, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'},
    body: JSON.stringify({model: wr.claudeModel, max_tokens: 12000, system: sys, messages: [{role: 'user', content: media ? [
      ...media.flatMap(([t, d]) => [{type: 'text', text: t}, img(d)]), {type: 'text', text: user}] : [
      {type: 'text', text: 'IMAGE 1 — INFOGRAPHIC:'}, img(wr.info), {type: 'text', text: 'IMAGE 2 — CHARACTER TURNAROUND SHEET:'}, img(wr.sheet),
      ...wr.locs.slice(0, wr.count).flatMap((d, i) => [{type: 'text', text: `IMAGE ${i + 3} — CHARACTER IN LOCATION (scenario ${i + 1}):`}, img(d)]), {type: 'text', text: user}]}]}),
  }, 300000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = j.error?.message || '';
    throw new Error(r.status === 401 || r.status === 403 ? 'ключ Anthropic не подошёл — вставьте его заново'
      : /credit balance/i.test(m) ? 'на счёте Anthropic нет денег — пополните баланс на console.anthropic.com (Billing)'
      : r.status === 404 ? `модель ${wr.claudeModel} недоступна для вашего ключа — выберите другую`
      : r.status === 429 ? 'Anthropic: слишком много запросов — подождите минуту'
      : r.status >= 500 ? 'Anthropic сейчас перегружен — попробуйте ещё раз через минуту' : `Anthropic ${r.status}: ${m}`);
  }
  return {text: (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'), cut: j.stop_reason === 'max_tokens', by: 'Claude ' + (CLAUDE_MODELS.find(m => m[0] === wr.claudeModel)?.[1].split(' — ')[0] || wr.claudeModel)};
}
// ИИ-писатель для «Сценариев», «Серии» и ИИ-монтажёра: who — 'sub', 'claude', 'gemini' или 'free'
const aiWrite = (who, sys, user, media) => ({sub: writeSub, claude: writeClaude, free: writeFree}[who] || writeGemini)(sys, user, media);
// задание с картинками: [подпись, data URL] — свои (ИИ-монтажёр) или ячейки «Сценариев»
const wrMedia = media => media || [['IMAGE 1 — INFOGRAPHIC:', wr.info], ['IMAGE 2 — CHARACTER TURNAROUND SHEET:', wr.sheet],
  ...wr.locs.slice(0, wr.count).map((d, i) => [`IMAGE ${i + 3} — CHARACTER IN LOCATION (scenario ${i + 1}):`, d])];
// картинка для Claude Code: jpeg/png/webp/gif до ~4 МБ; видео и прочее — кадром нельзя, пропускаем
async function wrImg(d) {
  if (/^data:image\/(png|jpeg|webp|gif);base64,/.test(d || '') && d.length < 5.2e6) return d;
  if (!/^data:image\//.test(d || '')) return null;
  const im = new Image(); im.src = d; await im.decode();
  const k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}
// Claude по подписке: задание уходит в программу Freefield на компьютере, там его пишет Claude Code; ответ — сюда же
async function writeSub(sys, user, media) {
  if (!await hubReady() || !hubHas('claude')) throw new Error(hubLink.ok ? 'на компьютере нет Claude Code или программа Freefield старая — обновите её (🔌 MCP)' : 'компьютер с программой Freefield не отвечает — откройте Freefield на компьютере');
  const content = [];
  for (const [t, d] of wrMedia(media)) { const img = await wrImg(d).catch(() => null); content.push({type: 'text', text: t}); if (img) content.push({type: 'image', data: img}); }
  content.push({type: 'text', text: user});
  const model = /sonnet/.test(wr.claudeModel) ? 'sonnet' : 'opus';
  const r = await fetch(hubLink.url('/api/write'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({system: sys, content, model})});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `компьютер ответил ${r.status}`);
  for (let t = 0; t < 900; t++) {   // до получаса: 10 сценариев Opus пишет минуты 2–5, задания идут по одному
    await sleep(t ? 2000 : 1500);
    const s = await (await fetch(hubLink.url('/api/write/' + j.id))).json().catch(() => null);
    if (!s) continue;
    if (s.status === 'error' || s.error) throw new Error(s.error || 'Claude Code не ответил');
    if (s.status === 'done') return {text: s.text, cut: s.cut, by: `Claude ${s.model === 'sonnet' ? 'Sonnet' : 'Opus'} (подписка)`};
  }
  throw new Error('Claude Code не ответил за полчаса');
}
// без ключа: Pollinations (анонимно — только текст, картинки ИИ не видит: даём ему подписи и просим держаться задания)
async function writeFree(sys, user, media) {
  const pics = wrMedia(media).map(([t]) => t).join('\n');
  const body = JSON.stringify({model: 'openai', messages: [{role: 'system', content: sys}, {role: 'user', content:
    `${pics ? `(The images below were attached but you cannot see them — write from the text, keep the character and places generic and consistent:\n${pics})\n\n` : ''}${user}`}]});
  let r, last = '';
  for (const pause of [4000, 16000, 0]) {   // анонимный доступ — не чаще раза в 15 с; занят — подождать и повторить
    r = await timedFetch('https://text.pollinations.ai/openai', {method: 'POST', headers: {'Content-Type': 'application/json'}, body}, 300000).catch(e => ({ok: false, status: 0, e}));
    if (r.ok) break;
    last = r.status ? `ответ ${r.status}` : 'нет связи';
    if (!pause || r.status && r.status < 429 && r.status !== 402) break;
    await sleep(pause);
  }
  if (!r.ok) throw new Error(`бесплатный ИИ сейчас не отвечает (${last}) — попробуйте через минуту или выберите другой ИИ`);
  const j = await r.json().catch(() => ({})), ch = j.choices?.[0];
  if (!ch?.message?.content) throw new Error('бесплатный ИИ вернул пустой ответ — попробуйте ещё раз');
  return {text: ch.message.content, cut: ch.finish_reason === 'length', by: 'Бесплатный ИИ (Pollinations)'};
}
async function writeGemini(sys, user, media) {
  const part = d => { const x = b64(d); return {inline_data: {mime_type: x.mime, data: x.data}}; };
  const req = {systemInstruction: {parts: [{text: sys}]}, contents: [{role: 'user', parts: media ? [...media.flatMap(([t, d]) => [{text: t}, part(d)]), {text: user}] : [
    {text: 'IMAGE 1 — INFOGRAPHIC:'}, part(wr.info), {text: 'IMAGE 2 — CHARACTER TURNAROUND SHEET:'}, part(wr.sheet),
    ...wr.locs.slice(0, wr.count).flatMap((d, i) => [{text: `IMAGE ${i + 3} — CHARACTER IN LOCATION (scenario ${i + 1}):`}, part(d)]), {text: user}]}],
    generationConfig: {temperature: 1, responseMimeType: 'application/json'}};
  const tried = [], fails = [];   // что ответила каждая модель: busy, quota, 404, cut, block:…, или текст ошибки Google
  // сразу Flash (пользователь 2026-09-28: «пусть сразу будет Flash, не Pro» — Pro часто перегружен, 503); модели — те, что есть у ключа.
  // Перегрузка (500/503) — два повтора с паузой, потом следующая модель; нет модели (404), лимит (429), ошибка модели (400) — сразу следующая
  for (const model of await geminiModels('flash')) {
    tried.push(model);
    // сколько модель может написать: «размышления» Gemini тратят тот же лимит, и 5–10 сценариев обрывались на полуслове
    // (пользователь 2026-09-29: в серии «↻ Повторить» — снова «сценарии не написаны»)
    req.generationConfig.maxOutputTokens = Math.min(geminiList.out[model] || 16384, 65536);
    const body = JSON.stringify(req);
    let r;
    for (const pause of [2000, 6000, 0]) {
      r = await timedFetch(`${GEMINI_API}/${model}:generateContent`, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': wallet.gemini}, body}, 300000);
      if (r.status < 500 || !pause) break;
      await sleep(pause);
    }
    if (r.status === 404 || r.status === 429 || r.status >= 500) { fails.push(r.status === 429 ? 'quota' : r.status >= 500 ? 'busy' : '404'); continue; }
    if (!r.ok) {
      const e = await geminiWhy(r);
      if (r.status === 400 && e.reason !== 'API_KEY_INVALID' && e.message !== GEMINI_GEO_MSG) { fails.push(e.message); continue; }   // не про ключ — пробуем другую модель
      throw e;
    }
    const j = await r.json().catch(() => ({})), c = j.candidates?.[0];
    const text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    const cut = c?.finishReason === 'MAX_TOKENS';
    if (text) return {text, cut, by: `Gemini (${model.replace(/^gemini-/, '').replace('-latest', '')})`};
    fails.push(cut ? 'cut' : 'block:' + (j.promptFeedback?.blockReason || c?.finishReason || '—'));
  }
  // одна модель занята, другая «не найдена» — это перегрузка, а не плохой ключ: серия повторит сама
  const had = k => fails.find(f => f === k || f.startsWith(k + ':'));
  if (had('busy') || had('quota') || had('cut')) throw Object.assign(new Error(had('busy')
    ? 'Gemini сейчас перегружен (ошибка 503) — у Google не хватает мощности, попробуйте через несколько минут'
    : had('quota') ? 'у Gemini закончился бесплатный лимит — попробуйте позже или выберите другой ИИ'
    : 'ответ Gemini оборвался на полуслове — попробуйте ещё раз'), {transient: true});
  const block = had('block');
  if (block) throw new Error(`Gemini не стал отвечать (причина Google: ${block.slice(6)}) — обычно из-за картинок: попробуйте другую инфографику или развёртку`);
  const other = fails.find(f => f !== '404');
  throw new Error(other || `у ключа Gemini не нашлось модели для текста (пробовал: ${tried.join(', ')}) — создайте ключ в AI Studio заново`);
}
async function writeGo() {
  if (wr.busy) return;
  if (peek.on) {
    const who = writerNow(), {sys, user, chat} = writeBrief();
    return peekShow('Сценарии', {prompts: who === 'chat' ? [['Задание для ИИ в чате (копируется)', chat]] : [['Системный промпт', sys], ['Задание (вместе с картинками)', typeof user === 'string' ? user : JSON.stringify(user, null, 2)]],
      request: {ИИ: who === 'chat' ? 'ИИ в чате' : WRITERS[who]?.name, картинки: {инфографика: wr.info || null, развёртка: wr.sheet || null, кадры_в_локациях: wr.locs || []}, сценариев: wr.count}});
  }
  if (['auto', 'sub'].includes(wr.ai) && !hubLink.ok) await hubReady().catch(() => false);
  if (wrNeedKey()) { openKeys(); return geminiOpen(); }   // ключ вставляется в «Настройках» — они уже открыты, когда вернётесь из AI Studio
  // кадры «персонаж в локации» обязательны при любом ИИ: сколько сценариев, столько кадров (пользователь 2026-09-27)
  const pics = writerNow() === 'chat' ? [] : ['info', 'sheet'].filter(k => !wr[k]), gap = wrLocGap();
  const miss = gap ? [...pics, 'loc'] : pics;
  if (miss.length) {
    miss.forEach(k => { const el = $(`#writeCreate [data-wslot="${k}"]`); el?.classList.remove('need'); void el?.offsetWidth; el?.classList.add('need'); });
    if (isMobile()) setView('create');
    if (!pics.length) {   // не хватает только кадров локаций; лишние кадры — можно сразу взять столько сценариев
      const have = wr.locs.length;
      return toast(wrLocMsg(), {type: 'err', ms: 8000, ...(gap < 0 && have <= 10 && {action: `${have} ${plur(have, 'сценарий', 'сценария', 'сценариев')}`,
        onAction: () => { wr.count = have; wr.save(); renderWrite(); updateGenButton(); }})});
    }
    return toast((pics.length === 2 ? 'Загрузите инфографику и развёртку героя — без них ИИ не напишет сценарий' : pics[0] === 'info' ? 'Загрузите инфографику — о чём ролик' : 'Загрузите развёртку героя — как он выглядит') +
      (gap ? `. И кадры «персонаж в локации»: ${wr.count} — по одному на сценарий` : ''), {type: 'err', ms: 7000});
  }
  const who = writerNow(), {sys, user, chat} = writeBrief();
  if (who === 'chat') {
    // ИИ в чате: ответом будут только заполненные эталонные промпты, каждый в своём блоке
    return toast(await clCopyText(chat) ? `Скопировано: эталонный промпт и просьба написать ${wr.count} ${plur(wr.count, 'сценарий', 'сценария', 'сценариев')} — вставьте в чат с ИИ и приложите инфографику, развёртку и ${wr.count} ${plur(wr.count, 'кадр', 'кадра', 'кадров')} в локациях по порядку` : 'Не удалось скопировать', {type: 'ok', ms: 10000});
  }
  if (!writerReady(who)) {
    if (who === 'sub') return toast('«Claude (подписка)» пишет через программу Freefield на компьютере — откройте Freefield на компьютере или выберите другой ИИ', {type: 'err', ms: 8000});
    toast(`Вставьте ключ ${WRITERS[who].name} — или выберите другой ИИ`, {type: 'err'});
    return openKeys();
  }
  wr.busy = true; wr.note = who === 'free' ? 'Бесплатный ИИ пишет сценарии (картинки он не видит)…' : `${WRITERS[who].name} читает картинки и пишет сценарии…`;
  renderWriteNote(); updateGenButton();
  try {
    const {r, list} = await writeRun();
    wr.result = list ? {scenarios: list, by: r.by, at: Date.now(), char: wr.char} : {raw: r.text, by: r.by, at: Date.now()};
    if (list) scrAdd(list, r.by);
    toast(list ? `Готово: ${list.length} ${plur(list.length, 'сценарий', 'сценария', 'сценариев')}${r.cut && list.length < wr.count ? ` из ${wr.count} — ответ ИИ оборвался, остальные напишите ещё раз` : ''} — ниже и в «📜 Готовых сценариях»`
      : r.cut ? 'Ответ ИИ оборвался на полуслове — нажмите «Написать» ещё раз или возьмите меньше сценариев' : 'ИИ ответил не по формату — его текст ниже', {type: list ? 'ok' : 'err', ms: 8000});
  } catch (e) { toast('Сценарий не написан: ' + e.message, {type: 'err', ms: 9000}); }
  wr.busy = false; wr.note = '';
  wr.save();
  renderWrite(); updateGenButton();
  $('#writeOut')?.scrollIntoView({behavior: 'smooth', block: 'start'});
}

// сам ИИ-сценарист: задание из нынешних ячеек «Сценариев» → Claude или Gemini → сценарии с голосом героя
async function writeRun() {
  if (['auto', 'sub'].includes(wr.ai) && !hubLink.ok) await hubReady().catch(() => false);
  const who = writerNow(), {sys, user} = writeBrief();
  if (who === 'chat') throw new Error('в «Сценариях» выбран «ИИ в чате» — он сам не пишет; выберите «⚡ Авто»');
  if (who === 'sub' && !writerReady(who)) await hubReady();
  if (!writerReady(who)) throw new Error(who === 'sub' ? 'компьютер с программой Freefield и Claude Code не отвечает' : `нет ключа ${WRITERS[who].name} — вставьте его в «Сценариях»`);
  const r = await aiWrite(who, sys, user);
  const list = parseScenarios(r.text, r.code), voice = wrVoice();
  if (list && voice) list.forEach(x => { x.video_prompt = withVoice(x.video_prompt, voice); });
  return {r, list};
}

// Google не даёт Gemini API в части стран — это не ошибка ключа
const GEMINI_GEO = /location is not supported|not (available|supported) in your (country|region)/i;
const GEMINI_GEO_MSG = 'Google не пускает к Gemini из вашей страны — включите VPN и попробуйте ещё раз, или выберите «ИИ в чате»';
// ключи Gemini: новые (с мая 2026) — «AQ.…», прежние — «AIza…» (Google их отключает с сентября 2026); ключ — только в заголовке
const GEMINI_KEY_RE = /\bAQ\.[A-Za-z0-9._-]{20,}|AIza[0-9A-Za-z_-]{30,}/;
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Модели Gemini — те, что есть у этого ключа: Google переименовывает и списывает модели (пользователь 2026-09-28: «Gemini 404» —
// зашитых gemini-pro-latest / gemini-2.5-* у ключа не оказалось). Список спрашиваем у Google; не ответил — запасные имена.
const GEMINI_FALLBACK = ['gemini-pro-latest', 'gemini-flash-latest', 'gemini-3.5-pro', 'gemini-3.5-flash', 'gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'];
const geminiList = {key: null, names: null, out: {}};   // out — сколько токенов модель может написать (из списка Google)
async function geminiModels(prefer = 'pro', key = wallet.gemini) {
  if (geminiList.key !== key || !geminiList.names) {
    let names = [], out = {};
    try {
      const r = await timedFetch(GEMINI_API + '?pageSize=1000', {headers: {'x-goog-api-key': key}}, 20000);
      if (r.ok) for (const m of ((await r.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))) {
        const n = String(m.name).replace(/^models\//, '');
        names.push(n);
        if (m.outputTokenLimit) out[n] = m.outputTokenLimit;
      }
    } catch { /* нет связи — запасные имена */ }
    Object.assign(geminiList, {key, names: names.length ? names : null, out});
  }
  // только текстовые модели Gemini: без озвучки, картинок, эмбеддингов, «живых» и узких
  const list = (geminiList.names || GEMINI_FALLBACK).filter(n => /^gemini-/.test(n) && !/tts|image|embed|audio|live|native|robotics|computer|learnlm|aqa|nano/i.test(n));
  const ver = n => /latest/.test(n) ? 99 : parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]) || 0;
  const tier = n => /lite/.test(n) ? 0 : /pro/.test(n) ? (prefer === 'pro' ? 2 : 1) : /flash/.test(n) ? (prefer === 'pro' ? 1 : 2) : 0;
  const score = n => tier(n) * 1000 + ver(n) * 10 - (/preview|exp/.test(n) ? 20 : 0) - (/-\d{3}$|\d{2}-\d{2}$/.test(n) ? 1 : 0);   // стабильные — раньше preview: реже перегружены
  return [...new Set(list)].sort((a, b) => score(b) - score(a)).slice(0, 6);
}
// отказ Google → понятная причина (пользователь 2026-09-28: «ключ не подошёл», хотя скопирован верно — причину не было видно)
async function geminiWhy(r) {
  const e = (await r.json().catch(() => ({}))).error || {}, m = e.message || '';
  const reason = (e.details || []).map(d => d.reason).find(Boolean) || e.status || '';
  const why = GEMINI_GEO.test(m) ? GEMINI_GEO_MSG
    : reason === 'API_KEY_INVALID' ? 'Google: ключ неверный — скопируйте его заново кнопкой копирования в AI Studio, целиком'
    : reason === 'ACCESS_TOKEN_TYPE_UNSUPPORTED' || r.status === 401 ? 'Google не принимает этот ключ. У части аккаунтов новые ключи «AQ.…» сейчас не работают — это ошибка на стороне Google. Попробуйте ключ из другого Google-аккаунта, а пока — «ИИ в чате»'
    : reason === 'SERVICE_DISABLED' || /has not been used|is disabled/i.test(m) ? 'В проекте этого ключа выключен Gemini API — в AI Studio создайте ключ заново: «Create API key» → в новом проекте'
    : reason === 'API_KEY_HTTP_REFERRER_BLOCKED' || /referer|referrer/i.test(m) ? 'У ключа стоит ограничение по сайтам — создайте в AI Studio новый ключ без ограничений'
    : r.status === 429 ? 'у Gemini закончился бесплатный лимит — попробуйте позже'
    : `Google ответил ${r.status}${m ? ': ' + m.slice(0, 160) : ''}`;
  return Object.assign(new Error(why), {status: r.status, reason});
}
async function saveGeminiKey(k) {
  k = (k || '').trim();
  if (!k) { wallet.gemini = ''; ls.del('freefield.gemini'); renderWallet(); renderWriteAi(); return toast('Ключ Gemini удалён'); }
  k = (k.match(GEMINI_KEY_RE) || [k.replace(/\s+/g, '')])[0];   // вставили с лишним текстом или пробелами — берём сам ключ
  const call = (url, o = {}) => timedFetch(url, {...o, headers: {...o.headers, 'x-goog-api-key': k}}, 20000);
  try {
    let r = await call(GEMINI_API + '?pageSize=1');
    if (r.status === 401 || r.status === 403) {
      // список моделей не пустил по доступу — проверяем тем, чем пишем: крошечный запрос к Gemini Flash
      for (const m of GEMINI_FALLBACK.filter(n => /flash/.test(n))) {
        const r2 = await call(`${GEMINI_API}/${m}:generateContent`, {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({contents: [{role: 'user', parts: [{text: 'hi'}]}], generationConfig: {maxOutputTokens: 1}})});
        if (r2.status !== 404) { r = r2; break; }
      }
    }
    if (!r.ok && r.status !== 429) throw await geminiWhy(r);
    wallet.gemini = k; ls.set('freefield.gemini', k); wr.keyWait = false; geminiList.names = null; renderWallet(); renderWriteAi(); updateGenButton();
    toast(r.ok ? 'Gemini подключён — теперь сценарии пишутся прямо здесь, бесплатно ✨' : 'Ключ Gemini сохранён. Сейчас у Gemini кончился бесплатный лимит — сценарии пойдут, когда он обновится', {type: 'ok', ms: 8000});
  } catch (e) {
    toast(e.status ? e.message : 'Нет связи с Google — проверьте интернет, VPN или блокировщик рекламы и нажмите ещё раз', {type: 'err', ms: 14000});
  }
}
async function saveAnthropicKey(k) {
  k = (k || '').trim();
  if (!k) { wallet.anthropic = ''; ls.del('freefield.anthropic'); renderWallet(); renderWriteAi(); updateGenButton(); return toast('Ключ Claude удалён из браузера'); }
  if (!/^sk-ant-/.test(k)) return toast('Ключ Anthropic начинается с sk-ant-', {type: 'err'});
  const r = await timedFetch('https://api.anthropic.com/v1/models?limit=1', {headers: {'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'}}, 15000).catch(() => null);
  if (r && (r.status === 401 || r.status === 403)) return toast('Ключ Anthropic не подошёл — проверьте, что скопировали его целиком', {type: 'err'});
  wallet.anthropic = k; ls.set('freefield.anthropic', k); renderWallet(); renderWriteAi(); updateGenButton();
  toast(r?.ok ? 'Claude подключён — теперь он пишет сценарии ✳' : 'Ключ сохранён — проверю его при первом сценарии', {type: 'ok'});
}

function renderWrite() {
  const box = $('#writeCreate');
  if (!box) return;
  const slot = (k, title, hint) => `<div class="wr-slot ${wr[k] ? 'has' : ''}" data-wslot="${k}" title="Нажмите, перетащите картинку или вставьте Ctrl+V">
      ${wr[k] ? `<img src="${wr[k]}" alt=""><button class="wr-x" data-wrm="${k}" title="Убрать">✕</button>` : '<div class="wr-add">＋</div>'}
      <b>${title}</b><span class="hint">${hint}</span></div>`;
  // в «ИИ в чате» копируется только эталон — картинки вы прикладываете в чат сами
  const need = writerNow() === 'chat' ? 'для Claude и Gemini' : 'обязательно';
  // кадры «персонаж в локации» — в той же ячейке мелкой сеткой (номер = сценарий); нажать на кадр — убрать, «＋» — добавить
  const locSlot = () => {
    const have = wr.locs.length, n = wr.count, cells = have + (have < n ? 1 : 0);
    const cols = cells <= 1 ? 1 : cells <= 4 ? 2 : cells <= 9 ? 3 : 4;
    const grid = wr.locs.map((src, i) => `<button class="wr-loc" data-wloc-rm="${i}" title="Кадр для сценария ${i + 1} — нажмите, чтобы убрать"><img src="${src}" alt=""><i>${i + 1}</i></button>`).join('') +
      (have < n ? '<span class="wr-loc add">＋</span>' : '');
    return `<div class="wr-slot ${have ? 'has' : ''}" data-wslot="loc" title="Нажмите, перетащите кадры или вставьте Ctrl+V — можно несколько сразу">
      ${have ? `<div class="wr-locs ${cells === 1 ? 'one' : ''}" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${grid}</div>` : '<div class="wr-add">＋</div>'}
      <b>📍 Персонаж в локации</b><span class="hint">обязательно · <span class="${have === n ? 'wr-ok' : 'wr-bad'}">${have} из ${n}</span> — по кадру на сценарий, в разных местах</span></div>`;
  };
  // инструкция пользователя (2026-09-27): развёртка и инфографика → герой в локациях → эталонный сценарий по кадру «персонаж в локации» →
  // видео с двумя фото (локация + развёртка) и эталонным промптом без лишних слов (внешность героя не описываем)
  const go = (m, t) => `<button class="wr-link" data-wgo="${m}">${t}</button>`;
  box.innerHTML = `
    <details class="wr-howto" ${ls.get('freefield.write.howto', false) ? 'open' : ''}><summary>📋 Как сделать ролик — 4 шага</summary><ol>
      <li><b>Развёртка и инфографика.</b> Развёртка героя — вид спереди, сбоку, сзади, лицо, одежда; инфографика — о чём ролик. Загрузите обе ниже.</li>
      <li><b>Герой в разных локациях.</b> В ${go('one', '🖼 Фото')} приложите развёртку как референс и сделайте героя в разных местах — по кадру на каждый сценарий: 5 сценариев — 5 разных локаций.</li>
      <li><b>Эталонный сценарий.</b> Загрузите эти кадры в ячейку «📍 Персонаж в локации» ниже — сколько сценариев, столько кадров. ИИ напишет сценарий 1 по кадру 1, сценарий 2 по кадру 2… В «ИИ в чате» приложите кадры в чат по порядку.</li>
      <li><b>Видео.</b> В ${go('scn', '🎬 Видео')} у сценария два фото — его «персонаж в локации» и развёртка (кнопка «🎬 В видео сервисы» приложит их сама) — и эталонный промпт без лишних слов: внешность героя не описываем, её берут из фото; в Location — только место.</li>
    </ol></details>
    <div class="wr-slots">${slot('info', '📊 Инфографика', `${need} · о чём ролик: товар, факты, выгоды`)}${slot('sheet', vc.char(wr.char)?.sheet ? `🧍 Развёртка · ${esc(vc.char(wr.char).name)}` : '🧍 Развёртка героя', `${need} · вид спереди, сбоку, сзади, лицо, одежда`)}${locSlot()}</div>
    ${wrCharsHTML()}
    <div class="block-head" style="margin-top:12px"><span class="lbl">Пожелания</span><span class="hint">необязательно</span></div>
    <textarea class="wr-idea" data-widea rows="2" placeholder="Для кого ролики, что продаём, какой призыв — например: новичкам в программировании, призыв «ссылка в профиле»">${esc(wr.idea)}</textarea>
    <div class="cl-row" style="margin-top:8px">
      <div class="seg" title="Сколько сценариев написать">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button data-wcount="${n}" class="${wr.count === n ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="seg" title="Длина ролика (во Flow — Omni 1.1 Flash)">${[[10, '10 с'], [8, '8 с']].map(([v, t]) => `<button data-wsec="${v}" class="${cl.seconds === v ? 'on' : ''}">${t}</button>`).join('')}</div>
    </div>
    <div class="block-head" style="margin-top:14px"><span class="lbl">📐 Эталонный промпт</span>
      <span class="hint">по нему ИИ пишет промпт видео · <button class="wr-link" data-wref-reset title="Вернуть исходные блоки">↺ исходный</button> · <button class="wr-link" data-wref-copy>📋 копировать</button></span></div>
    <textarea class="wr-idea wr-ref" data-wref rows="9" spellcheck="false" placeholder="${esc(REF_PROMPT)}">${esc(wr.ref)}</textarea>
    <div class="hint" style="margin-top:4px">Блоки — по строке: «Подпись: …». Что впишете после двоеточия (например, «Sound design: без музыки»), ИИ сделает правилом для всех сценариев.</div>
    <div id="writeAi"></div>
    <div id="writeNote"></div>
    <div id="writeOut">${writeOutHTML()}</div>`;
  renderWriteAi();
  renderWriteNote();
}
// «Сценарии» → кто говорит: выбран персонаж — его развёртка в ячейке, его голос ИИ впишет в каждый сценарий
function wrCharsHTML() {
  const c = vc.char(wr.char), v = wrVoice();
  return `<div class="block-head" style="margin-top:12px"><span class="lbl">🎙 Герой и голос</span><span class="hint"><button class="wr-link" data-wgo="chars">все персонажи</button></span></div>
    <div class="vc-chars">${vc.chars.map(x => vcCharBtn(x, `data-wchar="${x.id}"`, x === c)).join('')}<button class="vc-char add" data-wchar-new>＋ Персонаж</button></div>
    <div class="hint vc-note">${c ? `Говорит <b>${esc(c.name)}</b>${v ? `: голос «${esc(v.name)}» ИИ впишет в каждый сценарий, в строку «Spoken line»` : c.flow?.name ? `: во Flow — его голос ${c.flow.kind === 'char' ? '@' : '@Voice: '}${esc(c.flow.name)}${c.sample ? ', в Dola — образец' : ''}` : ' — выберите ему голос'} · <button class="wr-link" data-wchar-edit="${c.id}">✎ изменить</button>`
      : vc.chars.length ? 'Выберите, кто говорит в роликах: его развёртка встанет в ячейку, а голос ИИ впишет в каждый сценарий. Не выбран — голос придумает ИИ'
      : 'Создайте персонажа — имя, развёртка и голос. Голос ИИ впишет в каждый сценарий, и герой будет звучать одинаково во всех роликах'}</div>`;
}
function renderWriteNote() {
  const el = $('#writeNote');
  if (el) el.innerHTML = wr.busy ? `<div class="wr-note">⏳ ${esc(wr.note)}</div>` : '';
}
function writerState(id) {
  if (id === 'sub') return writerReady(id) ? ['ok', '✓ компьютер подключён'] : ['no', hubLink.ok ? 'обновите программу на компьютере' : 'нужен Freefield на компьютере'];
  if (id === 'claude') return wallet.anthropic ? ['ok', '✓ ключ есть'] : ['no', 'нужен ключ'];
  if (id === 'free') return ['ok', '✓ без ключа'];
  if (id === 'gemini') return wallet.gemini ? ['ok', '✓ ключ есть'] : ['no', 'нужен ключ'];
  return ['ok', '✓ всегда доступно'];
}
function renderWriteAi() {
  if (cl.mode === 'edit') renderMtChat();   // ключ ИИ появился или удалён — чат «ИИ-монтажёра» тоже
  const el = $('#writeAi');
  if (!el) return;
  const who = writerNow();
  const tile = id => { const w = WRITERS[id], [c, t] = writerState(id);
    return `<button class="wr-ai ${wr.ai === id ? 'on' : ''}" data-wai="${id}"><b><span class="mc-ico" style="background:${w.color}">${esc(w.ico)}</span>${w.name}</b>${w.what}<i class="${c}">${t}</i></button>`; };
  const setup = {
    sub: `${CLAUDE_MODELS.length ? `<select data-wmodel aria-label="Модель Claude">${CLAUDE_MODELS.map(([v, t]) => `<option value="${v}" ${wr.claudeModel === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
      ${writerReady('sub') ? '✓ Задание уходит в Claude Code на компьютере, сценарии возвращаются сюда сами. Без доплат — в пределах лимитов вашей подписки Claude.'
        : hubLink.ok ? 'Программа Freefield на компьютере не видит Claude Code или старая — обновите её (🔌 MCP → обновить) и перезапустите Claude.' : 'Работает, когда Freefield открыт на компьютере с Claude (или телефон связан с ним по QR).'}`,
    free: 'Без ключа и регистрации. Картинки этот ИИ не видит — пишет по тексту задания, поэтому слабее Claude и Gemini. Запасной вариант, когда остальные недоступны.',
    claude: `${CLAUDE_MODELS.length ? `<select data-wmodel aria-label="Модель Claude">${CLAUDE_MODELS.map(([v, t]) => `<option value="${v}" ${wr.claudeModel === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
      ${wallet.anthropic ? '✓ Ключ Claude есть — оплата с вашего счёта Anthropic за каждый сценарий.' : '<button class="btn small free" data-keys-open>🔑 Вставить ключ Claude — в «Настройках»</button>'}`,
    gemini: wallet.gemini ? '✓ Ключ Gemini есть — пишет Gemini Flash, бесплатно.' : '<button class="btn small free" data-keys-open>🔑 Подключить Gemini — в «Настройках», бесплатно</button>',
    chat: 'Задание скопируется в буфер вместе с вашим эталонным промптом. Вставьте его в чат с Gemini, Claude или ChatGPT и приложите картинки — инфографику, развёртку и кадры «персонаж в локации» по порядку (сценарий 1 — первый кадр…). ИИ ответит по вашей структуре: название, Block 1. Photo, Block 2. Video prompt, Block 3. Post caption — каждый блок с кнопкой «копировать».',
  };
  el.innerHTML = `
    <div class="block-head" style="margin-top:14px"><span class="lbl">Кто пишет сценарий</span><span class="hint">${wr.ai === 'auto' ? 'сейчас: ' + WRITERS[who].name : ''}</span></div>
    <div class="wr-ais"><button class="wr-ai auto ${wr.ai === 'auto' ? 'on' : ''}" data-wai="auto"><b>⚡ Авто</b>Лучший из доступных: Claude по подписке → Claude по ключу → Gemini → бесплатный</button>
      ${Object.keys(WRITERS).map(tile).join('')}</div>
    <div class="wr-setup" id="wrSetup">${wrNeedKey() ? '<div class="wr-lead">✨ <b>Чтобы ИИ писал сценарии прямо здесь</b> — подключите Gemini: бесплатно, один раз, около минуты.</div><button class="btn free" data-keys-open>🔑 Подключить Gemini</button>' +
      '<div class="hint" style="margin-top:6px">Без ключа — выберите «ИИ в чате»: задание скопируется, и вставите его в чат с ИИ.</div>' : setup[who]}</div>`;
}
// ключи ИИ живут только в «Настройках»: остальные разделы ведут туда этой кнопкой
function openKeys() {
  openSheet('settings');
  $('#setKeys')?.scrollIntoView({block: 'start'});
  keyInput()?.focus();
}
document.addEventListener('click', e => { if (e.target.closest('[data-keys-open]')) openKeys(); });
// ключ ИИ — один вид («Настройки»): сохранён — что он даёт и «Удалить»; нет — как получить и поле ввода
function keyCardHTML(id, lead = '') {
  const row = ph => `<div class="key-row"><input data-wkey-in="${id}" type="text" placeholder="${ph}" autocomplete="off" spellcheck="false"><button class="btn free" data-wkey-save="${id}">Сохранить</button></div>`;
  const del = `<button class="btn small danger" data-wkey-del="${id}">Удалить ключ</button>`;
  if (id === 'claude') return wallet.anthropic ? `✓ Ключ Anthropic сохранён в этом браузере. Оплата — с вашего счёта Anthropic за каждый сценарий. ${del}`
    : `${lead}<ol class="steps"><li>Откройте <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> и войдите.</li>
        <li>В «Billing» пополните баланс (от $5) — этого хватит на много сценариев.</li><li>«Create Key» → скопируйте ключ (начинается с <code>sk-ant-</code>) и вставьте сюда.</li></ol>
      ${row('sk-ant-…')}<div class="hint" style="margin-top:6px">Ключ хранится только в этом браузере и уходит только в Anthropic.</div>`;
  // Gemini без ключа: взять бесплатный ключ в AI Studio и вставить из буфера одной кнопкой
  return wallet.gemini ? `✓ Ключ Gemini сохранён: пишет сценарии (Gemini Flash — быстрый и бесплатный; перегружен — Freefield подождёт и повторит) и переводит промпты. ${del}`
    : `${lead}<ol class="steps">
      <li><button class="btn small free" data-wkey-open>🔑 Открыть Google AI Studio</button> и войдите своим Google-аккаунтом</li>
      <li>Нажмите «Create API key» и скопируйте ключ — он начинается с <code>AQ.</code> (старые — с <code>AIza</code>)</li>
      <li>Вернитесь сюда: <button class="btn small ${wr.keyWait ? 'free wr-pulse' : ''}" data-wkey-paste>📋 Вставить ключ</button> — или вставьте его в поле:</li></ol>
    ${row('AQ.… или AIza…')}<div class="hint" style="margin-top:6px">Бесплатно, в пределах дневных лимитов Google. Ключ хранится только в этом браузере и уходит только в Google.</div>`;
}
// поле ключа, которое сейчас на экране (в «Настройках» или в «Сценариях»)
const keyInput = id => $$(`[data-wkey-in${id ? `="${id}"` : ''}]`).find(el => el.offsetParent);
// «Авто», а ключей нет — не уходим в чат, а предлагаем подключить бесплатный Gemini (пользователь 2026-09-28: писать сценарий в приложении)
const wrNeedKey = () => wr.ai === 'auto' && writerNow() === 'chat';
const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';
function geminiOpen() {
  wr.keyWait = true;
  openSide(GEMINI_KEY_URL, 'aistudio');
  renderWallet();
  toast('В Google AI Studio: «Create API key» → скопируйте ключ, вернитесь и нажмите «📋 Вставить ключ»', {type: 'ok', ms: 10000});
}
async function geminiPaste() {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch {}
  const k = (String(t).match(GEMINI_KEY_RE) || [])[0];
  if (k) return saveGeminiKey(k);
  keyInput('gemini')?.focus();
  toast(t ? 'В буфере не ключ Gemini — скопируйте в AI Studio ключ, он начинается с AQ. или AIza' : 'Не получилось прочитать буфер — вставьте ключ в поле: долгое нажатие → «Вставить»', {type: 'err', ms: 8000});
}
// вернулись из AI Studio — подсвечиваем «📋 Вставить ключ»
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !wr.keyWait || wallet.gemini || $('#settingsSheet').classList.contains('hidden')) return;
  renderWallet();
  $('#setKeys [data-wkey-paste]')?.scrollIntoView({behavior: 'smooth', block: 'center'});
});
function writeOutHTML() {
  const r = wr.result;
  if (!r) return '';
  const by = `<span class="hint">написал ${esc(r.by || 'ИИ')}</span>`;
  if (!r.scenarios) return `<div class="cl-sec">Ответ ИИ ${by}</div><div class="wr-card"><pre class="wr-raw">${esc(r.raw)}</pre>
    <div class="cl-row"><button class="btn small" data-wcopy-raw>📋 Копировать</button><button class="btn small" data-wclear>✕ Убрать</button></div></div>`;
  return `<div class="cl-sec">Сценарии ${by}<button class="wr-link" data-scripts>📜 все готовые</button></div>` + r.scenarios.map((s, i) => `
    <div class="wr-card" data-wi="${i}">
      <div class="scn-head">${wr.locs[i] ? `<img class="wr-card-loc" src="${wr.locs[i]}" alt="" title="Кадр ${i + 1} — «персонаж в локации» этого сценария">` : ''}<b>${i + 1}. ${esc(s.title)}</b>${s.angle ? `<span class="wr-tag">${esc(s.angle)}</span>` : ''}</div>
      <div class="wr-blocks">${s.video_prompt ? blocksHTML(s.video_prompt) : '<div>ИИ не заполнил эталонный промпт — напишите сценарий заново</div>'}</div>
      ${s.asset_prompt ? `<details class="wr-prompts"><summary>Промпт ассета — для «🖼 Ассет ×4»</summary><div class="wr-blocks">${blocksHTML(s.asset_prompt)}</div></details>` : ''}
      <div class="cl-row">
        <button class="btn small" data-wcopy-video="${i}" title="Скопировать сценарий — заполненный эталонный промпт, по блокам">📋 Копировать</button>
        ${s.asset_prompt ? `<button class="btn small" data-wasset="${i}" title="Flow · Nano Banana 2.1 · 3:4 · ×4 с развёрткой героя — без кредитов">🖼 Ассет ×4</button>` : ''}
        <button class="btn small" data-wscn="${i}" title="Добавить сценарий в «Видео»">🎬 В видео сервисы</button></div>
    </div>`).join('') +
    `<div class="cl-row"><button class="btn" data-wasset="all" title="Для каждого сценария — 4 фото героя в его локации (Flow, без кредитов)">🖼 Ассеты для всех</button>
      <button class="btn" data-wscn="all">🎬 Все в «Видео»</button><button class="btn small" data-wclear>✕ Убрать</button></div>`;
}
// «🖼 Ассет ×4»: Flow · Nano Banana 2 · 3:4 · ×4, развёртка героя — «ингредиент» (так пользователь делает референсы для рилсов)
async function writeAssets(list) {
  list = list.filter(s => s.asset_prompt.length >= 3);
  if (!list.length) return toast('У сценария нет промпта для ассета', {type: 'err'});
  if (!(await hubReady())) return phoneCards(list.map(s => ({prompt: s.asset_prompt, kind: 'image', service: 'flow', model: 'nano-banana-2.1', aspect_ratio: '3:4', count: 4, images: wr.sheet ? [wr.sheet] : undefined})));
  try {
    const r = await fetch(hubLink.url('/api/batch'), {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({scenarios: list.map(s => ({prompt: s.asset_prompt, kind: 'image', service: 'flow', model: 'nano-banana-2.1', aspect_ratio: '3:4', count: 4, images: [wr.sheet]}))})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `компьютер ответил ${r.status}`);
    toast(`Отправлено в Google Flow: ${list.length} × 4 фото героя. Выберите лучшее в галерее и приложите его к сценарию кнопкой 📎`, {type: 'ok', ms: 8000});
  } catch (e) { toast('Не удалось отправить: ' + e.message, {type: 'err'}); }
  hubLink.refresh();
}
// «🎬 В видео сервисы»: видео-промпт — в «Видео» (как написан: без авто-улучшения, речь остаётся по-русски)
function writeToScn(idxs) {
  const list = wr.result?.scenarios || [], ch = vc.char(wr.result?.char), sheet = ch?.sheet || wr.sheet;
  let added = 0, full = 0, withLoc = 0;
  for (const i of idxs) {
    const s = list[i];
    if (!s?.video_prompt) continue;
    // шаг 4: к видео — оба фото: его кадр «персонаж в локации» (сценарий i — кадр i) и развёртка
    const loc = wr.locs[i];
    const scn = {...blankScn(), kind: 'video', prompt: fillBlocks(s.video_prompt), aspect: '9:16', fixed: true, ...(loc && {ref: loc}), ...(sheet && {sheet}), ...(ch && {char: ch.id, voice: ch.voice})};
    const empty = cl.scn.findIndex(scnEmpty);
    if (empty >= 0) cl.scn[empty] = scn; else if (cl.scn.length < CL_MAX) cl.scn.push(scn); else break;
    added++;
    if (loc) withLoc++;
    if (loc && sheet) full++;
  }
  if (!added) return toast(`Уже ${CL_MAX} сценариев — уберите лишние в «Видео»`, {type: 'err'});
  cl.save();
  setCreateMode('scn');
  const each = added > 1 ? 'К каждому приложен его' : 'Приложен';
  toast(`Добавлено в «Видео»: ${added}.${full === added ? ` ${each} кадр «персонаж в локации» и развёртка`
    : withLoc === added ? ` ${each} кадр «персонаж в локации»; развёртку добавьте кнопкой 🧍 или загрузите её в «Сценариях»`
    : ' Приложите к сценарию кадр «персонаж в локации» (📎) и развёртку (🧍)'}`, {type: 'ok', ms: 8000});
}
async function writeAddImage(k, files) {
  files = [].concat(files).filter(f => f?.type?.startsWith('image/'));
  if (!files.length) return toast('Нужна картинка (png, jpg, webp)', {type: 'err'});
  if (k === 'loc') {   // кадры локаций — добавляются по порядку, до 10 (больше сценариев за раз не бывает)
    const room = CL_MAX - wr.locs.length;
    if (room <= 0) return toast(`Уже ${CL_MAX} кадров — больше сценариев за раз не пишется`, {type: 'err'});
    for (const f of files.slice(0, room)) { try { wr.locs.push(await refDataUrl(f)); } catch { toast('Не удалось прочитать картинку', {type: 'err'}); } }
    if (files.length > room) toast(`Взял ${room} ${plur(room, 'кадр', 'кадра', 'кадров')} — больше ${CL_MAX} не нужно`, {type: 'err'});
    wrLocsSave();
  } else {
    try { wr[k] = await refDataUrl(files[0]); } catch { return toast('Не удалось прочитать картинку', {type: 'err'}); }
    wrCharCheck();
    wr.save();
  }
  renderWrite(); updateGenButton();
}
function bindWrite() {
  const box = $('#writeCreate');
  box.addEventListener('click', async e => {
    const b = e.target.closest('button, [data-wslot]');
    if (!b || e.target.closest('a')) return;
    if (b.dataset.wrm) { wr[b.dataset.wrm] = null; wrCharCheck(); wr.save(); renderWrite(); return updateGenButton(); }
    if (b.dataset.wchar) {   // персонаж роликов (ещё раз — снять выбор)
      const c = vc.char(b.dataset.wchar);
      if (!c) return;
      const on = wr.char !== c.id;
      if (on) wrUseChar(c); else wr.char = null;
      wr.save(); renderWrite(); updateGenButton();
      return on && toast(`Говорит ${c.name}: ${wrCharTook(c) || 'голос не выбран'}${c.sheet ? '' : ' — загрузите его развёртку в ячейку'}`, {type: 'ok', ms: 6000});
    }
    if (b.hasAttribute('data-wchar-new')) { vcUi.i = null; return vcOpenChar(null, 'write'); }
    if (b.dataset.wcharEdit) return vcOpenChar(vc.char(b.dataset.wcharEdit), 'write');
    if (b.hasAttribute('data-wvoices')) return openVoices('list');
    if (b.hasAttribute('data-scripts')) return openScripts();
    if (b.dataset.wlocRm) {   // кадр локации убран — с возможностью вернуть на то же место
      const i = +b.dataset.wlocRm, [src] = wr.locs.splice(i, 1);
      wrLocsSave(); renderWrite(); updateGenButton();
      return toast(`Кадр ${i + 1} убран`, {action: 'Вернуть', onAction: () => { wr.locs.splice(Math.min(i, wr.locs.length), 0, src); wrLocsSave(); renderWrite(); updateGenButton(); }});
    }
    if (b.dataset.wslot) { const k = b.dataset.wslot; return pickFile('image/*', k === 'loc').then(f => [].concat(f || []).length && writeAddImage(k, f)); }
    if (b.dataset.wai) { wr.ai = b.dataset.wai; wr.save(); renderWrite(); return updateGenButton(); }
    if (b.dataset.wgo) { setCreateMode(b.dataset.wgo); return $('.panel-scroll')?.scrollTo({top: 0, behavior: 'smooth'}); }
    if (b.dataset.wcount) { wr.count = +b.dataset.wcount; wr.save(); renderWrite(); return updateGenButton(); }
    if (b.dataset.wsec) { cl.seconds = +b.dataset.wsec; cl.save(); return renderWrite(); }
    const list = wr.result?.scenarios || [];
    const pick = v => v === 'all' ? list : [list[+v]].filter(Boolean);
    if (b.dataset.wasset) return writeAssets(pick(b.dataset.wasset));
    if (b.dataset.wscn) return writeToScn(b.dataset.wscn === 'all' ? list.map((_, i) => i) : [+b.dataset.wscn]);
    if (b.dataset.wcopyVideo) return toast(await clCopyText(fillBlocks(list[+b.dataset.wcopyVideo]?.video_prompt)) ? 'Сценарий скопирован — по блокам, как эталон' : 'Не удалось скопировать', {type: 'ok'});
    if (b.hasAttribute('data-wref-copy')) return toast(await clCopyText(wr.ref) ? 'Эталонный промпт скопирован' : 'Не удалось скопировать', {type: 'ok'});
    if (b.hasAttribute('data-wref-reset')) { wr.ref = REF_PROMPT; wr.save(); const ta = box.querySelector('[data-wref]'); if (ta) ta.value = wr.ref; return toast('Эталонный промпт — снова исходные блоки', {type: 'ok'}); }
    if (b.hasAttribute('data-wcopy-raw')) return toast(await clCopyText(wr.result?.raw || '') ? 'Текст скопирован' : 'Не удалось скопировать', {type: 'ok'});
    if (b.hasAttribute('data-wclear')) { wr.result = null; wr.save(); return renderWrite(); }
  });
  box.addEventListener('input', e => {
    if (e.target.matches('[data-widea]')) { wr.idea = e.target.value; ls.set('freefield.write.idea', wr.idea); }
    if (e.target.matches('[data-wref]')) { wr.ref = e.target.value; ls.set('freefield.write.ref', wr.ref); }
  });
  // инструкцию можно свернуть — запоминаем (toggle не всплывает, ловим на погружении)
  box.addEventListener('toggle', e => { if (e.target.matches('.wr-howto')) ls.set('freefield.write.howto', e.target.open); }, true);
  // ключи ИИ — где бы ни был их блок
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-wkey-save], [data-wkey-open], [data-wkey-paste], [data-wkey-del]');
    if (!b) return;
    if (b.dataset.wkeySave) { const v = b.closest('.key-row')?.querySelector('[data-wkey-in]')?.value; return b.dataset.wkeySave === 'claude' ? saveAnthropicKey(v) : saveGeminiKey(v); }
    if (b.hasAttribute('data-wkey-open')) return geminiOpen();
    if (b.hasAttribute('data-wkey-paste')) return geminiPaste();
    if (b.dataset.wkeyDel) return b.dataset.wkeyDel === 'claude' ? saveAnthropicKey('') : saveGeminiKey('');
  });
  document.addEventListener('keydown', e => { if (e.target.matches?.('[data-wkey-in]') && e.key === 'Enter') { e.preventDefault(); e.target.closest('.key-row')?.querySelector('[data-wkey-save]')?.click(); } });
  box.addEventListener('change', e => { if (e.target.matches('[data-wmodel]')) { wr.claudeModel = e.target.value; wr.save(); updateGenButton(); } });
  // перетаскивание картинки на нужную ячейку
  const over = e => e.target.closest?.('[data-wslot]');
  box.addEventListener('dragover', e => { const z = over(e); if (z) { e.preventDefault(); z.classList.add('drag'); } });
  box.addEventListener('dragleave', e => over(e)?.classList.remove('drag'));
  box.addEventListener('drop', e => {
    const z = over(e); if (!z) return;
    e.preventDefault(); z.classList.remove('drag');
    writeAddImage(z.dataset.wslot, [...e.dataTransfer.files]);
  });
}

async function clCopyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function clCopy() {
  const list = cl.ready();
  if (!list.length) return toast('Напишите хотя бы один сценарий', {type: 'err'});
  const svc = {auto: 'сервис выбери сам', flow: 'Google Flow', arena: 'Arena', dola: 'Dola'};
  const text = `Сгенерируй через Freefield пакет сценариев (batch_generate). Перепиши каждый в подробный английский промпт ` +
    `(сцена, действие, камера, свет, стиль) и разложи по Google Flow / Arena / Dola так, чтобы хватило бесплатных кредитов. Длина видео: ${cl.seconds} с (seconds=${cl.seconds}).\n` +
    list.map((s, i) => `${i + 1}. ${s.kind === 'video' ? 'Видео' : 'Картинка'} · ${svc[s.service]} · формат ${scnAspect(s)}${s.ref || s.sheet ? ` · с фото (${[s.ref && 'персонаж в локации', s.sheet && 'развёртка'].filter(Boolean).join(' и ')}) — приложу в чат` : ''}: ${composePrompt(s.kind === 'video' ? withVoice(withCamera(s.prompt.trim(), s.camera), scnVoice(s)) : s.prompt.trim(), s.style ?? state.style, s.kind)}`).join('\n');
  const copied = await clCopyText(text);
  toast(copied ?'Задание скопировано — вставьте его в чат с Claude' : 'Не удалось скопировать — выделите текст вручную', {type: 'ok'});
}

// сценарии → задания (одни и те же для компьютера и для карточек «на телефоне»)
async function clTasks(list, phone = false) {
  const plan = clPlan(list);
  let out = list.map((s, i) => ({site: plan[i].site, char: s.kind === 'video' ? vc.char(s.char) : null, prompt: s.prompt.trim(), kind: s.kind, service: s.service, aspect_ratio: scnAspect(s), seconds: s.kind === 'video' ? cl.seconds : undefined, model: s.service !== 'auto' ? s.model || undefined : undefined, image: s.ref || undefined, sheet: s.sheet || undefined, fixed: s.fixed, style: s.style, camera: s.kind === 'video' ? s.camera : undefined, voice: s.kind === 'video' ? scnVoice(s) : null}));
  // промпты не «улучшаем» (переключатель убран по просьбе пользователя) — только переводим русское на английский как есть;
  // готовые промпты из «Сценариев» не трогаем, в эталонном (блочном) — переводим по блокам, реплики в «» остаются
  out = await Promise.all(out.map(async s => {
    if (s.fixed || !/[а-яё]/i.test(s.prompt)) return s;
    try { return {...s, prompt: isBlockPrompt(s.prompt) ? await translateBlocks(s.prompt) : await translateKeepQuotes(s.prompt)}; } catch { return s; }
  }));
  // у сценария может быть свой стиль и голос; char — только для карточек (образец голоса), компьютеру не нужен
  return out.map(({fixed, style, camera, voice, site, char, ...s}) => ({...s, ...(phone && char && {char: char.id}),
    prompt: composePrompt(voicePrompt(withCamera(s.prompt, camera), voice, char, site, phone), style ?? state.style, s.kind)}));
}

async function clSend(own) {
  const list = own || cl.ready();
  if (!list.length) return toast('Напишите хотя бы один сценарий', {type: 'err'});
  let ok = false;
  cl.sending = true;
  updateGenButton();
  try {
    const out = await clTasks(list);
    const r = await fetch(hubLink.url('/api/batch'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({scenarios: out})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `компьютер ответил ${r.status}`);
    if (!own) {
      cl.scn = [scnLike(cl.scn.at(-1))];   // дальше — один пустой сценарий с теми же настройками
      cl.sel = null;
      cl.save();
      styleSync();
    }
    toast(`Отправлено на компьютер: ${out.length} ${plur(out.length, 'сценарий', 'сценария', 'сценариев')}. Готовые файлы сами появятся в галерее`, {type: 'ok', ms: 6000});
    ok = true;
  } catch (e) { toast('Не удалось отправить: ' + e.message, {type: 'err'}); }
  cl.sending = false;
  renderScn();
  updateGenButton();
  hubLink.refresh();
  return ok;
}

// Без компьютера (версия с GitHub, APK, другая сеть): у Flow, Vids, Dola и Arena нет публичного API, а до компьютера,
// где Freefield запускает их сам, эта версия не достаёт. Поэтому на каждое задание — карточка в галерее: фото, промпт,
// сервис, модель и формат; «Создать» на сайте нажимает сам пользователь (тратятся те же бесплатные кредиты),
// готовый файл загружается в карточку. Задания — те же, что ушли бы на компьютер (/api/batch).
function phoneCards(tasks, {quiet = false} = {}) {
  // newItem кладёт карточку в начало — идём с конца, чтобы первая была сверху
  const made = [];
  tasks.map((t, i) => [t, i]).reverse().forEach(([t, i]) => {
    const site = t.service, kind = t.kind;
    const m = EXT_MODELS.find(x => x.service === site && x.kind === kind) || EXT_MODELS.find(x => x.service === site);
    const sm = scnModel(kind, site, t.model) || scnModel(kind, site, scnDefault(kind, site));
    // формат — из тех, что есть на сайте; Arena формат не выбирает — пишем его словами в промпт
    const ar = site === 'arena' || !SITE_AR[kind][site] ? t.aspect_ratio : fitAr(SITE_AR[kind][site], t.aspect_ratio);
    const r = arRatio(ar), shape = r < 0.95 ? 'vertical' : r > 1.05 ? 'horizontal' : 'square';
    const prompt = site !== 'arena' ? t.prompt : isBlockPrompt(t.prompt) ? `${t.prompt}\nFormat: ${shape} ${ar}` : `${t.prompt}, ${shape} ${ar} format`;
    const it = newItem({type: kind, status: 'external', statusText: '', prompt: t.prompt, userPrompt: t.prompt, finalPrompt: prompt,
      aspect: ar, w: r >= 1 ? 1024 : Math.round(1024 * r), h: r >= 1 ? Math.round(1024 / r) : 1024, seed: 0, cost: 0,
      source: t.images?.length ? 'image' : 'text', refs: t.images || [], ...modelFields(m),
      ...(t.char && {char: t.char}),
      phone: {site, engine: sm ? sm[2] : m.engine, info: sm ? sm[3] : '', count: t.count > 1 ? t.count : 0, n: i + 1, of: tasks.length}});
    DB.put(it);
    made[i] = it;
  });
  render();
  if (isMobile()) setView('gallery');
  requestAnimationFrame(() => $('#feed').scrollTo({top: 0, behavior: 'smooth'}));   // карточки — вверху галереи
  const n = tasks.length;
  if (!quiet) toast(`Компьютер не подключён — ${n > 1 ? `${n} ${plur(n, 'карточка', 'карточки', 'карточек')}` : 'карточка'} для сайтов в галерее: сохраните фото, скопируйте промпт, нажмите «Создать» на сайте и загрузите результат`, {type: 'ok', ms: 9000});
  return made;
}

// «Видео» без компьютера: сервис и модель — по тому же плану, что у компьютера
async function scnPhone(own) {
  const list = own || cl.ready();
  if (!list.length) return toast('Напишите хотя бы один сценарий', {type: 'err'});
  let ok = false;
  cl.sending = true;
  updateGenButton();
  try {
    const plan = clPlan(list), out = await clTasks(list, true);
    // Flow и Vids берут оба фото («ингредиенты»), Dola и Arena — только первое
    ok = phoneCards(out.map(({image, sheet, ...t}, i) => ({...t, service: plan[i].site, model: plan[i].model,
      images: [image, sheet].filter(Boolean).slice(0, ['flow', 'vids'].includes(plan[i].site) ? 2 : 1)})));
    if (!own) {
      cl.scn = [scnLike(cl.scn.at(-1))];   // дальше — один пустой сценарий с теми же настройками
      cl.sel = null;
      cl.save();
      styleSync();
    }
  } catch (e) { ok = false; toast('Не удалось подготовить: ' + e.message, {type: 'err'}); }
  cl.sending = false;
  renderScn();
  updateGenButton();
  return ok;
}

// фото сценария: референс-кадр или развёртка героя (key) из файла
async function scnPickRef(i, key) {
  const file = await pickFile('image/*'), s = cl.scn[i];
  if (!file || !s) return;
  try { s[key] = await refDataUrl(file); } catch { return toast('Не удалось прочитать фото', {type: 'err'}); }
  cl.save(); renderScn(); updateGenButton();
}
function bindClaude() {
  const idx = e => +e.target.closest('.scn')?.dataset.i;
  const plan = () => {
    $$('.cl-plan').forEach(el => { el.innerHTML = clPlanText(); });
    $$('#scnCreate [data-to]').forEach(el => { el.innerHTML = scnToHTML(+el.dataset.to); });
    updateGenButton();
  };
  const scnBox = $('#scnCreate');
  scnBox.addEventListener('input', e => {
    if (!e.target.matches('[data-prompt]')) return;
    cl.scn[idx(e)].prompt = e.target.value;
    cl.save();
    plan();
  });
  // вставили блочный промпт (из чата с ИИ, одной строкой, с ** или ```) — сразу раскладываем по блокам эталона
  scnBox.addEventListener('paste', e => {
    const ta = e.target;
    if (!ta.matches('[data-prompt]')) return;
    setTimeout(() => {
      const t = pastedBlocks(ta.value);
      if (t == null || t === ta.value) return;
      ta.value = t; ta.rows = Math.max(ta.rows, 10);
      cl.scn[idx({target: ta})].prompt = t;
      cl.save(); plan();
    });
  });
  scnBox.addEventListener('keydown', e => { if (e.target.matches('[data-prompt]') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); scnGo(); } });   // без аргумента — все сценарии раздела
  scnBox.addEventListener('change', e => {
    if (e.target.matches('[data-sm]')) {
      const [site, model] = e.target.value.split(':');
      if (!['auto', 'flow', 'dola', 'arena', 'vids'].includes(site)) return;
      Object.assign(cl.scn[idx(e)], site === 'auto' ? {service: 'auto', model: null} : {service: site, model});
      cl.save(); renderScn(); updateGenButton();   // у другого сервиса — свои форматы
    }
  });
  $('#createMode').addEventListener('click', e => { const b = e.target.closest('[data-cm]'); if (b) setCreateMode(b.dataset.cm); });
  const onClick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.kind) {
      const s = cl.scn[idx(e)];
      s.kind = b.dataset.kind;
      if (s.kind === 'image' && s.service === 'vids') Object.assign(s, {service: 'auto', model: null});   // Vids делает только видео
      if (s.model && !scnModel(s.kind, s.service, s.model)) s.model = null;
    } else if (b.hasAttribute('data-rm')) { cl.scn.splice(idx(e), 1); cl.sel = null; cl.pickFor = null; styleSync(); }
    else if (b.hasAttribute('data-style-pick')) {   // 🎨 — выбрать сценарий для стиля (ещё раз — снять выбор)
      cl.sel = cl.sel === idx(e) ? null : idx(e);
      renderScn(); styleSync();
      if (cl.sel != null) $('#styleGrid').scrollIntoView({behavior: 'smooth', block: 'nearest'});
      return;
    }
    else if (b.hasAttribute('data-cam-pick')) return openCamPick(idx(e));
    else if (b.hasAttribute('data-voice-pick')) return openVoices('pick', {i: idx(e)});
    else if (b.hasAttribute('data-add')) return openScnCount();
    else if (b.hasAttribute('data-tok')) return openTok();   // баланс токенов по сервисам   // сколько сценариев нужно — окно 1…10
    else if (b.dataset.sar) {   // меняется только этот сценарий; новые сценарии получат последний выбранный формат
      cl.scn.forEach(x => { x.aspect ||= scnAspect(x); });
      cl.scn[idx(e)].aspect = cl.aspect = b.dataset.sar;
    }
    else if (b.hasAttribute('data-copy')) return clCopy();
    else if (b.dataset.accOut) return accAction('out', b.dataset.accOut, b, +b.dataset.p || 1);
    else if (b.dataset.accIn) return accAction('in', b.dataset.accIn, b, +b.dataset.p || 1);
    else if (b.dataset.accAs) return accAction('in', b.dataset.accAs, b, +b.dataset.p || 1, b.dataset.email);
    else if (b.dataset.accCheck) return accAction('check', b.dataset.accCheck, b, +b.dataset.p || 1);
    else if (b.hasAttribute('data-acc-refresh')) return accAction('refresh', null, b);
    else if (b.hasAttribute('data-acc-new')) return accAction('new', null, b);
    else if (b.hasAttribute('data-acc-all')) return accAction('all', null, b);
    else if (b.hasAttribute('data-acc-close-all')) return accAction('close-all', null, b);
    else if (b.dataset.accOpen) return accAction('open', null, b, +b.dataset.accOpen);
    else if (b.dataset.accClose) return accAction('close', null, b, +b.dataset.accClose);
    else if (b.hasAttribute('data-ref-add') && wr.locs.length) cl.pickFor = idx(e);   // сначала — кадры из «Сценариев»
    else if (b.hasAttribute('data-ref-add') || b.hasAttribute('data-ref-file')) { const i = idx(e); cl.pickFor = null; renderScn(); return scnPickRef(i, 'ref'); }
    else if (b.dataset.locPick) { cl.scn[idx(e)].ref = wr.locs[+b.dataset.locPick]; cl.pickFor = null; }
    else if (b.hasAttribute('data-pick-x')) cl.pickFor = null;
    else if (b.hasAttribute('data-ref-rm')) delete cl.scn[idx(e)].ref;
    else if (b.hasAttribute('data-sheet-add')) {   // развёртка — та, что загружена в «Сценариях»; её нет — выбрать файл
      if (!wr.sheet) return scnPickRef(idx(e), 'sheet');
      cl.scn[idx(e)].sheet = wr.sheet;
    }
    else if (b.hasAttribute('data-sheet-rm')) delete cl.scn[idx(e)].sheet;
    else if (b.hasAttribute('data-copy-one')) {   // «📋» у сценария — его промпт одной кнопкой
      const t = cl.scn[idx(e)].prompt.trim();
      if (!t) return toast('В этом сценарии пока пусто', {type: 'err'});
      return clCopyText(t).then(ok => toast(ok ? 'Промпт скопирован' : 'Не удалось скопировать', {type: ok ? 'ok' : 'err'}));
    }
    else if (b.hasAttribute('data-import-all')) return hubLink.importAll(b);
    else return;
    cl.save();
    renderScn();
    updateGenButton();
  };
  ['#scnCreate', '#scnLive', '#scnAcc'].forEach(sel => $(sel).addEventListener('click', onClick));
}
