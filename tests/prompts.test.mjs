// Эталон видео с таймкодами и блочные промпты «Фото» (пользователь 2026-10-09)
import {suite, serveStatic, sleep, PC} from './lib.mjs';

const site = await serveStatic();
await suite('эталон с таймкодами, фото — блоками', async t => {
  const p = await t.page(PC, 'ПК');
  // в браузере был прежний эталон (пустые подписи) — встанет новый
  await p.addInitScript(() => { if (!localStorage.getItem('ff-test-once')) { localStorage.setItem('ff-test-once', '1');
    localStorage.setItem('freefield.write.ref', JSON.stringify('On-screen text: свой\nSpoken line: \nLocation: ')); } });
  await p.goto(site.url); await sleep(1500);
  const r = await p.evaluate(() => {
    const prev = JSON.parse(localStorage.getItem('freefield.write.ref.prev') || 'null');
    cl.seconds = 8;
    const {sys, chat} = writeBrief();
    const one = fillBlocks('Spoken line: (0:00–0:02) «Привет» (0:02–0:06) «Смотри» (0:06–0:08) «Жми»\nLocation: (0:00–0:08) kitchen\nSound design: (0:00–0:08) cafe hum');
    const v = withVoice(one, {en: 'deep calm male voice'});
    const sc = parseScenarios(JSON.stringify({scenarios: [{title: 'Т', video_prompt: one, asset_prompt: 'Subject: man Pose & expression: smiling Action: typing Location: cafe Lighting: soft Camera & framing: vertical 3:4 Style: photo Avoid: text'}]}));
    return {ref: wr.ref === REF_PROMPT, prev, labels: refLabels(), timed: /rescale them to 8 s — \(0:00–0:02\) \/ \(0:02–0:06\) \/ \(0:06–0:08\)/.test(sys),
      tpl: sys.includes('(0:03–0:07) Scene 2 — MAIN: [What we see]'), subs: sys.includes('«[Exact subtitle text 1]»') && /Subtitles — the EXACT English text/.test(sys) && !sys.includes('Automatic subtitles:'), photo: sys.includes('Pose & expression: the pose'), chatPhoto: chat.includes('Pose & expression: <'),
      one, v, asset: sc?.[0]?.asset_prompt};
  });
  t.ok(r.ref && r.prev?.startsWith('On-screen text: свой'), 'новый эталон встал, прежний свой — сохранён в запас', r.prev);
  t.ok(r.labels.length === 10 && r.labels[0] === 'Scenes & Shot cuts' && r.labels.includes('Action & Emotions'), 'подписи блоков нового эталона', r.labels);
  t.ok(r.subs, 'субтитры — точный текст на экране в каждом сценарии, не «автоматические»');
  t.ok(r.timed && r.tpl,'ИИ получает эталон с таймкодами и растягивает их под 8 с');
  t.ok(r.photo && r.chatPhoto, 'промпт фото первого кадра — блоками (и для ИИ в чате)');
  t.ok(r.one.split('\n').length === 8 && /^\(0:02–0:06\) «Смотри»$/m.test(r.one), 'таймкоды в одну строку раскладываются по строкам', r.one);
  t.ok(/^Spoken line: voice — deep calm male voice\n\(0:00–0:02\)/.test(r.v), 'голос героя — в строке «Spoken line:», реплики ниже', r.v);
  t.ok(r.asset?.split('\n').length === 8 && /^Camera & framing: vertical 3:4$/m.test(r.asset), 'промпт ассета от ИИ — по строке на блок', r.asset);
  // «Фото»: кнопки — блочные промпты, место и действие встают в свои блоки
  const ph = await p.evaluate(() => {
    const loc = ASSET_KINDS.loc.prompt, info = ASSET_KINDS.info.prompt;
    asset.info = null;
    const a = locPrompt(loc, {vals: {LOCATION: 'кухня', ACTION: ''}}, 0), b = infoPrompt(info, {vals: {TOPIC: 'кофе', HEADLINE: ''}});
    const old = locPrompt('Photo of a man.', {vals: {LOCATION: 'кухня', ACTION: 'пьёт чай'}}, 0);
    return {all: Object.values(ASSET_KINDS).every(K => isPhotoBlock(K.prompt) && isAssetTpl(K.prompt) && K.prompt.split('\n').every(l => /^[A-Z][A-Za-z &]+: /.test(l) || /^[A-Z][A-Za-z &]+:$/.test(l))),
      legacy: Object.values(ASSET_KINDS).every(K => K.legacy?.some(x => isAssetTpl(x))), a, b, old};
  });
  t.ok(ph.all && ph.legacy, 'все кнопки «Фото» — блочные промпты, прежние тоже узнаются как шаблон');
  t.ok(/^Location: кухня$/m.test(ph.a) && /^Action: choose yourself one clear action/m.test(ph.a) && ph.a.indexOf('Location:') < ph.a.indexOf('Avoid:'), 'место — в «Location:», действие — подберёт модель', ph.a);
  t.ok(/^Topic: кофе$/m.test(ph.b) && /^Headline: write a short, catchy headline for this topic$/m.test(ph.b), 'тема и заголовок инфографики — в свои блоки', ph.b);
  t.ok(ph.old.includes('Location: кухня.') && ph.old.includes('Action: пьёт чай.'), 'свой обычный промпт — как раньше', ph.old);
});
