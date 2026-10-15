// Шаблоны монтажа (этап 4): каждый — рецепт ритма, переходов, эффектов, цвета, звуковых ударов, графики и субтитров.
// plan.js toProject() берёт рецепт (opts.recipe) и строит из него проект montage.json. Свой шаблон = ещё одна запись здесь.
//   pace         — нарезка: speech (по речи), fast (2 бита), medium (такт), slow (2 такта)
//   transitions  — переходы по кругу (fx.js TRANSITIONS / XFADE)
//   fx           — эффекты каждого клипа (fx.js: shake, flash, rgb, blur, smooth…)
//   ramp         — speed ramp в долях длины куска: [{at: 0…1, speed}]
//   focus        — камера следит за действием (зум zoom ×, окно едет за движением) — для записи экрана
//   keyword_punch— «удары» зумом на ключевых (длинных) словах речи
//   look, sfx    — цвет всего ролика и звуковые удары (fx.js); gfx — графика (titles/cards/launch); captions — стиль субтитров
//   hook, cta    — крупный хук-текст в начале и призыв в конце (дорожка text)
export const RECIPES = {
  aura: {
    label: 'Aura edit', desc: 'Слоумо, свечение, тряска на сильных долях, крупные слова по одному — «эстетичный» эдит',
    pace: 'slow', transitions: ['white', 'fade', 'fadewhite'], punch_amount: 0.05, drift: 0.06,
    fx: {shake: {amount: 0.3}, flash: true, smooth: true}, ramp: [{at: 0.45, speed: 0.5}],
    look: {preset: 'aura', vignette: true, grain: 0.3}, sfx: {hits: true, riser: true, volume: 0.5}, gfx: 'titles', captions: 'word',
  },
  velocity: {
    label: 'Velocity edit', desc: 'Ускорение → резкое замедление под бит, вспышки, глитч, тряска — динамичный эдит',
    pace: 'fast', transitions: ['cut', 'flash', 'hblur', 'cut', 'fadewhite'], punch_amount: 0.09, drift: 0.02,
    fx: {shake: {amount: 0.55}, rgb: true, smooth: true}, ramp: [{at: 0, speed: 1.7}, {at: 0.55, speed: 0.45}],
    look: {preset: 'teal_orange', vignette: true}, sfx: {transitions: true, hits: true, riser: true, volume: 0.6}, captions: 'box',
  },
  launch: {
    label: 'Запуск продукта', desc: '«NEW», имя продукта, фишки на бит, кнопка-призыв в ритм — в стиле Apple-анонса',
    pace: 'medium', transitions: ['fadewhite', 'smoothleft', 'circleopen', 'smoothup'], punch_amount: 0.06, drift: 0.05,
    fx: {flash: true}, look: {preset: 'cold', vignette: true}, sfx: {transitions: true, riser: true, volume: 0.5}, gfx: 'launch', captions: 'pop',
  },
  demo: {
    label: 'Демо интерфейса', desc: 'Запись экрана: камера приближает и едет за действием, спокойные переходы, тезисы карточками',
    pace: 'slow', transitions: ['fade', 'smoothleft'], punch_amount: 0, drift: 0,
    focus: {zoom: 1.5}, sfx: {transitions: true, volume: 0.35}, gfx: 'cards', captions: 'minimal',
  },
  reel: {
    label: 'Рилс по формуле', desc: 'Хук-текст первые 2 с → речь с жестами (паузы вырезаны) → призыв с текстом; русские субтитры плашкой',
    pace: 'speech', clean_speech: true, transitions: ['fadewhite', 'cut', 'hblur'], punch_amount: 0.07, drift: 0.04,
    hook: true, cta: true, look: {preset: 'warm'}, sfx: {transitions: true, volume: 0.4}, captions: 'box',
  },
  talking: {
    label: 'Говорящая голова', desc: 'Паузы и «эээ» вырезаны, крупные субтитры по словам на плашке, зум на ключевых словах',
    pace: 'speech', clean_speech: true, transitions: ['cut'], punch_amount: 0.12, drift: 0.03, keyword_punch: true,
    sfx: {hits: true, volume: 0.3}, captions: 'box',
  },
};
export const recipeList = () => Object.entries(RECIPES).map(([id, r]) => ({id, label: r.label, desc: r.desc}));
