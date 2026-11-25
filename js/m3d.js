'use strict';
/* =============================== 🧊 3D-модель и 🔍 Увеличить =============================== */
// Картинка из галереи уходит в Freefield на компьютере: 3D-модель делают бесплатные сервисы под аккаунтами пользователя
// (Hunyuan 3D, Hugging Face, Tripo, Meshy), увеличение — Flow или Real-ESRGAN. Пока идёт — живая карточка в галерее,
// готовое само приходит в галерею (модель — карточкой с обложкой, увеличенная картинка — обычной картинкой).
// 2026-11-25 (пользователь вернул раздел «3D»: «чтобы всё было по порядку, как на платных сервисах»). Честно про каждый сервис:
// сколько бесплатно и сколько картинок он берёт. Meshy убран: модель делает, но скачать можно только по подписке
const M3D_SVC = [
  ['auto', 'Авто', 'Сам выберет: Tripo → Hunyuan 3D → Krea → Hugging Face; не вышло — следующий, нет входа в аккаунте — другой аккаунт', 'views'],
  ['tripo', 'Tripo', 'Лучшее качество: ≈ 5 моделей в месяц на аккаунт (300 кредитов, модель — 55). Берёт 1 картинку спереди', 'one'],
  ['hunyuan', 'Hunyuan 3D', '20 моделей в день на аккаунт. Берёт 1 картинку или 4 вида', 'views'],
  ['krea', 'Krea 3D', 'Hunyuan3D-2.1: ≈ 4 модели в день на аккаунт, нужен вход в Krea. Берёт 1 картинку', 'one'],
  ['hf', 'Hugging Face', 'TRELLIS.2 и Hunyuan3D-2.1: 1–3 модели в день на аккаунт. С видами — Hunyuan3D-2mv', 'views'],
];
const M3D_VIEWS = [['front', 'Спереди'], ['back', 'Сзади'], ['left', 'Слева'], ['right', 'Справа']];
const m3d = {src: null, views: {}, sending: false, up: null, opts: {service: 'auto', quality: 'high', texture: true, pbr: false, format: 'glb', factor: 2, count: 1, ...ls.get('freefield.m3d.opts', {})}};
if (!M3D_SVC.some(x => x[0] === m3d.opts.service)) m3d.opts.service = 'auto';   // был Meshy — его больше нет в списке
const fmtTri = n => n == null ? '' : n >= 1e6 ? `${Math.round(n / 1e5) / 10} млн` : n >= 1000 ? `${Math.round(n / 1000)} тыс.` : String(n);
function m3dCardHTML(it) {
  const m = it.m3d || {};
  return `<div class="card model" data-id="${it.id}" style="aspect-ratio:${it.w}/${it.h}">
    ${it.posterBlob ? `<img src="${urlOf(it.posterBlob)}" alt="" loading="lazy">` : '<div class="m3d-ph">🧊</div>'}
    <span class="badge">🧊 3D · ${esc(String(m.format || m.pack || 'glb').toUpperCase())}${m.triangles ? ' · ' + fmtTri(m.triangles) + ' треуг.' : ''}</span>
    <div class="card-ov">
      <div class="card-actions">
        <button class="act wide" data-act="open3d" title="Покрутить модель">👁 Смотреть</button>
        <button class="act" data-act="download" title="Скачать модель">⤓</button>
        <button class="act" data-act="delete" title="Удалить">🗑</button>
      </div>
      <div class="card-foot"><div class="card-prompt">${esc(it.prompt)}</div><div class="card-model">${esc(it.modelTitle || '')}</div></div>
    </div></div>`;
}
// просмотрщик GLB — веб-компонент Google model-viewer, грузится только когда нужен
let mvLoad = null;
const loadModelViewer = () => mvLoad ||= customElements.get('model-viewer') ? Promise.resolve() : new Promise((ok, no) => {
  const sc = document.createElement('script');
  sc.type = 'module';
  sc.src = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4/dist/model-viewer.min.js';
  sc.onload = () => ok();
  sc.onerror = () => { mvLoad = null; no(new Error('нет связи')); };
  document.head.append(sc);
});
function showLB3d(it) {
  const m = it.m3d || {}, glb = (m.pack || 'glb') === 'glb';
  $('#lbMedia').innerHTML = glb
    ? `<model-viewer class="lb-model" src="${urlOf(it.blob)}" ${it.posterBlob ? `poster="${urlOf(it.posterBlob)}"` : ''} camera-controls auto-rotate shadow-intensity="1" alt="3D-модель"></model-viewer>`
    : it.posterBlob ? `<img src="${urlOf(it.posterBlob)}" alt="">` : '<div class="m3d-ph lb-ph">🧊</div>';
  if (glb) loadModelViewer().catch(() => toast('Просмотр 3D не загрузился (нет связи с cdn.jsdelivr.net) — модель можно скачать', {type: 'err', ms: 7000}));
  const rows = [
    ['Формат', `${String(m.format || 'glb').toUpperCase()}${m.pack === 'zip' ? ' (архив: модель + текстуры)' : ''}`],
    ['Полигоны', m.triangles != null ? `${m.triangles.toLocaleString('ru-RU')} треугольников, ${Number(m.vertices || 0).toLocaleString('ru-RU')} вершин` : 'сервис не дал посчитать'],
    ['Текстуры', `${m.textures ?? '—'}${m.pbr ? ' · PBR' : ''}`],
    ['Где сделано', `${m.service || '—'}${m.engine ? ' · ' + m.engine : ''}`],
    ...(m.folder ? [['Папка на компьютере', m.folder.replace(/^.*?(outputs[\\/])/, '…$1')]] : []),
    ['Создано', new Date(it.createdAt).toLocaleString('ru-RU', {dateStyle: 'short', timeStyle: 'short'})],
  ];
  $('#lbInfo').innerHTML = `
    <div><span class="tier free">Free</span></div>
    <div><h4>Из картинки</h4><p>${esc(it.prompt)}</p></div>
    <dl class="meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${it.note ? `<p class="hint">${esc(it.note)}</p>` : ''}
    ${(m.warnings || []).map(w => `<p class="hint">⚠ ${esc(w)}</p>`).join('')}
    ${glb ? '<p class="hint">Крутите мышью или пальцем, колёсико — ближе и дальше.</p>' : '<p class="hint">Архив откройте в Blender, Unity, Unreal или Godot.</p>'}
    <div class="lb-actions">
      <button class="primary" data-act="download">⤓ Скачать ${glb ? 'GLB' : 'архив'}</button>
      <button data-act="delete" class="danger">🗑 Удалить</button>
    </div>`;
  $('#lbPrev').style.visibility = lbIndex > 0 ? '' : 'hidden';
  $('#lbNext').style.visibility = lbIndex < lbList.length - 1 ? '' : 'hidden';
}
// «3D» — пятая вкладка: картинка (из галереи кнопкой 🧊 или своим файлом), виды, где делать, качество, формат
function m3dFromItem(it) {
  if (!it?.blob) return toast('Картинка не найдена', {type: 'err'});
  m3d.src = {blob: it.blob, pcName: it.pcName || null, w: it.w, h: it.h, aspect: it.aspect, prompt: it.prompt || '', item: it.id};
  m3d.views = {};
  setView('create');
  setCreateMode('3d');
}
async function m3dFromFile(f) {
  if (!f || !/^image\//.test(f.type)) return toast('Нужна картинка (png, jpg, webp)', {type: 'err'});
  const d = await dims(f).catch(() => null);
  m3d.src = {blob: f, pcName: null, w: d?.[0] || 1024, h: d?.[1] || 1024, aspect: null, prompt: f.name.replace(/\.\w+$/, ''), item: null};
  renderM3dPanel();
  updateGenButton();
}
const m3dSeg = (key, list) => `<div class="seg">${list.map(([v, t]) => `<button data-m3d-${key}="${v}" class="${String(m3d.opts[key]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
function renderM3dPanel() {
  const o = m3d.opts, src = m3d.src, svc = M3D_SVC.find(x => x[0] === o.service) || M3D_SVC[0];
  const four = o.count === 4;
  const big = src ? `<img src="${urlOf(src.blob)}" alt=""><button class="asset-slot-rm" data-m3d-src-rm title="Убрать">✕</button>` : '<span>＋</span><small>Картинка персонажа или предмета</small>';
  const slot = (k, t) => { const v = m3d.views[k]; return `<div class="asset-slot ${v ? 'has' : ''}" data-m3d-view="${k}" title="${v ? 'Заменить' : 'Вид ' + t.toLowerCase()}">${v ? `<img src="${v}" alt=""><button class="asset-slot-rm" data-m3d-view-rm="${k}" title="Убрать">✕</button>` : '<span>＋</span>'}<small>${t}</small></div>`; };
  const have = (src ? 1 : 0) + (four ? M3D_VIEWS.slice(1).filter(([k]) => m3d.views[k]).length : 0), need = four ? 4 : 1;
  const warn = four && svc[3] === 'one' ? `<p class="m3d-note warn">⚠ ${svc[1]} берёт только вид спереди — остальные виды пропустит. Все 4 вида используют Hunyuan 3D и Hugging Face.</p>` : '';
  $('#m3dCreate').innerHTML = `
    <div class="block-head"><span class="lbl">Сколько картинок</span><span class="m3d-count ${have >= need ? 'ok' : ''}">${have} из ${need}</span></div>
    ${m3dSeg('count', [[1, '1 картинка'], [4, '4 вида (точнее)']])}
    <p class="m3d-note">${four ? 'Один и тот же герой спереди, сзади, слева и справа, на однотонном фоне. Можно выбрать 4 файла сразу — встанут по порядку.' : 'Герой или предмет целиком, на однотонном фоне, без обрезанных рук и ног. Для игры лучше A- или T-поза.'}</p>
    <div class="m3d-main"><div class="asset-slot ${src ? 'has' : ''}" data-m3d-src title="${src ? 'Заменить картинку' : 'Выбрать картинку — или нажмите 🧊 на картинке в галерее, перетащите файл, Ctrl+V'}">${big}${four ? '<small>Спереди</small>' : ''}</div></div>
    ${four ? `<div class="m3d-views">${M3D_VIEWS.slice(1).map(([k, t]) => slot(k, t)).join('')}</div>` : ''}
    ${warn}
    <div class="block-head"><span class="lbl">Где делать</span></div>
    <div class="chips">${M3D_SVC.map(([v, t, d]) => `<button class="chip ${o.service === v ? 'on' : ''}" data-m3d-service="${v}" title="${esc(d)}">${t}</button>`).join('')}</div>
    <p class="m3d-note">${esc(svc[2])}</p>
    <div class="block-head"><span class="lbl">Качество</span></div>${m3dSeg('quality', [['standard', 'Обычное'], ['high', 'Высокое'], ['max', 'Максимум']])}
    <div class="block-head"><span class="lbl">Формат</span></div>${m3dSeg('format', [['glb', 'GLB'], ['obj', 'OBJ'], ['fbx', 'FBX']])}
    <p class="hint">GLB — для Roblox, Unity, Godot и просмотра; OBJ — для Blender и 3D-печати; FBX — через Blender на компьютере.</p>
    <div class="m3d-check"><label><input type="checkbox" data-m3d-check="texture" ${o.texture ? 'checked' : ''}> Текстура (цвет)</label><label><input type="checkbox" data-m3d-check="pbr" ${o.pbr ? 'checked' : ''}> PBR-материалы</label></div>
    <p class="m3d-note">Обычно 3–8 минут. Готовая модель придёт в галерею — её можно покрутить и скачать. Платные кредиты не тратятся.</p>`;
}
// картинка для компьютера — как есть (без уменьшения), в формате, который он принимает
async function m3dDataUrl(blob) {
  if (/^image\/(png|jpeg|webp|gif)$/.test(blob.type) && blob.size < 15e6) return blobDataUrl(blob);
  return blobDataUrl(await downscale(blob, 4096));
}
// что программа на компьютере сделает с заданием — для ⟨/⟩
const M3D_PLAN = {
  order: {auto: 'Tripo → Hunyuan 3D → Krea 3D → Hugging Face; не вышло — следующий; в аккаунте нет входа — другой аккаунт Chrome',
    hunyuan: 'сайт hy3d.tencent.ai в окне Chrome Freefield', krea: 'сайт krea.ai/3d в окне Chrome Freefield', hf: 'Spaces: с текстурой — microsoft/TRELLIS.2, затем tencent/Hunyuan3D-2.1; с видами — tencent/Hunyuan3D-2mv',
    tripo: 'сайт studio.tripo3d.ai в окне Chrome Freefield (аккаунт, где вы вошли в Tripo)'},
  quality: {standard: 'TRELLIS.2: 1024, 300 тыс. граней, текстура 2048 · Hunyuan3D-2.1: octree 256, 30 шагов',
    high: 'TRELLIS.2: 1536, 500 тыс. граней, текстура 2048 · Hunyuan3D-2.1: octree 384, 50 шагов',
    max: 'TRELLIS.2: 1536, 1 млн граней, текстура 4096 · Hunyuan3D-2.1: octree 512, 50 шагов'},
};
async function m3dGo() {
  const src = m3d.src, o = m3d.opts;
  if (!src?.blob) { toast('Выберите картинку — или нажмите 🧊 на картинке в галерее', {type: 'err'}); return $('#m3dCreate [data-m3d-src]')?.click(); }
  if (o.count === 4) {
    const miss = M3D_VIEWS.slice(1).filter(([k]) => !m3d.views[k]).map(([, t]) => t.toLowerCase());
    if (miss.length) { toast(`Не хватает видов: ${miss.join(', ')} — добавьте их или выберите «1 картинка»`, {type: 'err', ms: 6000}); return; }
  }
  const body = {title: '3D: ' + (src.prompt || '').slice(0, 200), pc_name: src.pcName || undefined, image: await m3dDataUrl(src.blob), aspect: src.aspect,
    views: o.count === 4 ? {...m3d.views} : {}, service: o.service, quality: o.quality, texture: o.texture, pbr: o.pbr, format: o.format};
  if (peek.on) return peekShow('3D', {prompts: [['Что сделает программа на компьютере', [
      `Сервис: ${M3D_PLAN.order[o.service]}`, `Качество «${o.quality}»: ${M3D_PLAN.quality[o.quality]}`,
      `Текстура: ${o.texture ? 'да' : 'нет'} · PBR: ${o.pbr ? 'да' : 'нет'} · формат: ${o.format.toUpperCase()}${o.format === 'obj' ? ' (из GLB — сама программа)' : o.format === 'fbx' ? ' (из GLB — через Blender)' : ''}`,
      'Платные кредиты: не тратятся (allow_paid = false)', `Готовое: Freefield/outputs/3d/<задание>/ → в галерею карточкой «🧊 3D»`].join('\n')]],
    request: {куда: 'программа на компьютере: POST /api/3d', body}});
  m3d.sending = true;
  updateGenButton();
  try {
    if (!(await hubReady())) return toast('Нужна программа Freefield на компьютере: откройте Freefield с компьютера (раздел «Профили»)', {type: 'err', ms: 8000});
    const r = await fetch(hubLink.url('/api/3d'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(j.error || `компьютер ответил ${r.status}${r.status === 404 ? ' — обновите программу Freefield на компьютере (файлы из pc/mcp)' : ''}`);
    if (src.item) { const map = ls.get('freefield.m3d.src', {}); map[j.id] = src.item; ls.set('freefield.m3d.src', Object.fromEntries(Object.entries(map).slice(-200))); }
    toast('🧊 3D-модель делается на компьютере — карточка в галерее покажет этап', {type: 'ok', ms: 6000});
    if (isMobile()) setView('gallery');
    hubLink.refresh();
  } catch (e) { toast('Не получилось отправить: ' + e.message, {type: 'err', ms: 8000}); }
  finally { m3d.sending = false; updateGenButton(); }
}
$('#m3dCreate').addEventListener('click', async e => {
  const b = e.target.closest('button, [data-m3d-view], [data-m3d-src]');
  if (!b) return;
  const o = m3d.opts, d = b.dataset;
  if (d.m3dCount) o.count = +d.m3dCount;
  else if (d.m3dService) o.service = d.m3dService;
  else if (d.m3dQuality) o.quality = d.m3dQuality;
  else if (d.m3dFormat) o.format = d.m3dFormat;
  else if ('m3dSrcRm' in d) { m3d.src = null; updateGenButton(); }
  else if ('m3dSrc' in d) {
    // в режиме «4 вида» можно выбрать сразу несколько файлов: спереди, сзади, слева, справа — по порядку
    if (o.count !== 4) return m3dFromFile(await pickFile('image/*'));
    const fs = (await pickFile('image/*', true)).filter(f => /^image\//.test(f.type));
    if (!fs.length) return;
    for (const [i, f] of fs.slice(1, 4).entries()) m3d.views[M3D_VIEWS[i + 1][0]] = await m3dDataUrl(f);
    return m3dFromFile(fs[0]);
  }
  else if (d.m3dViewRm) delete m3d.views[d.m3dViewRm];
  else if (d.m3dView) {
    const f = await pickFile('image/*');
    if (!f) return;
    m3d.views[d.m3dView] = await m3dDataUrl(f);
  } else return;
  ls.set('freefield.m3d.opts', o);
  renderM3dPanel();
});
$('#m3dCreate').addEventListener('change', e => {
  const k = e.target.dataset.m3dCheck;
  if (!k) return;
  m3d.opts[k] = e.target.checked;
  ls.set('freefield.m3d.opts', m3d.opts);
});
// картинку можно перетащить или вставить (Ctrl+V), пока открыта вкладка «3D»
$('#m3dCreate').addEventListener('dragover', e => e.preventDefault());
$('#m3dCreate').addEventListener('drop', e => { e.preventDefault(); const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/')); if (f) m3dFromFile(f); });
document.addEventListener('paste', e => {
  if (cl.mode !== '3d' || e.target.closest?.('input, textarea')) return;
  const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); m3dFromFile(f); }
});

// «🔍 Увеличить» — окно у картинки из галереи
function openUp(it) {
  if (!it?.blob) return toast('Картинка не найдена', {type: 'err'});
  m3d.up = it.id;
  renderUp();
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#m3dSheet').classList.remove('hidden');
}
function renderUp() {
  const it = items.find(x => x.id === m3d.up), o = m3d.opts;
  if (!it) return closeSheets();
  $('#m3dTitle').textContent = '🔍 Увеличить';
  $('#m3dBody').innerHTML = `<div class="m3d-src"><img src="${urlOf(it.blob)}" alt=""><div class="hint">${it.w} × ${it.h} → ${it.w * o.factor} × ${it.h * o.factor}</div></div>
    <div class="cl-sec">Во сколько раз</div>${m3dSeg('factor', [[2, '×2'], [4, '×4']])}
    <div class="vc-foot"><button class="btn free" data-up-go>🔍 Увеличить ×${o.factor}</button><button class="btn small" data-up-peek title="Что уйдёт: запрос — ничего не отправляется">⟨/⟩</button></div>`;
}
async function upGo(btn, dry) {
  const it = items.find(x => x.id === m3d.up), o = m3d.opts;
  if (!it?.blob) return;
  const body = {title: `Увеличение ×${o.factor}: ` + (it.prompt || '').slice(0, 200), pc_name: it.pcName || undefined, image: await m3dDataUrl(it.blob), aspect: it.aspect, factor: o.factor};
  if (dry) return peekShow('🔍 Увеличить', {prompts: [['Что сделает программа на компьютере', `Картинка из Flow (известна программе по имени файла) — Flow сам: меню «Скачать» → ${o.factor === 2 ? '2K' : '4K'}.\nИначе — Space на Hugging Face с Real-ESRGAN (Nick088/Real-ESRGAN_Pytorch → doevent/Face-Real-ESRGAN → finegrain/finegrain-image-enhancer) под вашим аккаунтом.\nРезультат — в галерею обычной картинкой.`]],
    request: {куда: 'программа на компьютере: POST /api/upscale', body}});
  btn.disabled = true;
  try {
    if (!(await hubReady())) return toast('Нужна программа Freefield на компьютере: откройте Freefield с компьютера (раздел «Профили»)', {type: 'err', ms: 8000});
    const r = await fetch(hubLink.url('/api/upscale'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(j.error || `компьютер ответил ${r.status}${r.status === 404 ? ' — обновите программу Freefield на компьютере (файлы из pc/mcp)' : ''}`);
    closeSheets();
    toast('🔍 Увеличиваю на компьютере — карточка в галерее покажет этап', {type: 'ok', ms: 6000});
    hubLink.refresh();
  } catch (e) { toast('Не получилось отправить: ' + e.message, {type: 'err', ms: 8000}); }
  finally { btn.disabled = false; }
}
$('#m3dBody').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.m3dFactor) { m3d.opts.factor = +b.dataset.m3dFactor; ls.set('freefield.m3d.opts', m3d.opts); return renderUp(); }
  if (b.hasAttribute('data-up-go')) return upGo(b);
  if (b.hasAttribute('data-up-peek')) return upGo(b, true);
});
