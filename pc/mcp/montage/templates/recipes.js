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
//   pace: drop   — драматургия вирусного эдита: нарастание (build_bars тактов, кадр на build_step долей) → удар на дропе (hit) →
//                  частые склейки по drop_steps долям → финальный кадр (end_beats долей); phases — свои скорость, эффекты и переходы у каждой части
//   cards        — тезисы (items) крупным текстом на кадрах нарастания, title — в финале (кино-трейлер)
export const RECIPES = {
  aura: {
    label: 'Aura edit', desc: 'Нарастание в слоумо со свечением → на дропе вспышка и тряска → частые склейки на доли → финал в слоумо',
    pace: 'drop', build_bars: 2, build_step: 4, drop_steps: [2, 2, 1, 1, 2, 2, 1, 1], end_beats: 4,
    transitions: ['fade', 'white'], punch_amount: 0.06, drift: 0.06,
    phases: {
      build: {speed: 0.6, fx: {smooth: true}, transitions: ['fade'], punch_amount: 0, drift: 0.09},
      hit: {fx: {flash: true, shake: {amount: 0.9}, rgb: true}, transitions: ['white'], punch_amount: 0.16, punch_every: 1},
      drop: {fx: {flash: true, shake: {amount: 0.4}}, transitions: ['cut', 'flash', 'cut', 'hblur'], punch_amount: 0.08, punch_every: 2},
      end: {speed: 0.5, fx: {smooth: true}, transitions: ['white'], punch_amount: 0, drift: 0.12},
    },
    look: {preset: 'aura', vignette: true, grain: 0.3}, sfx: {hits: true, riser: true, transitions: true, volume: 0.5}, gfx: 'titles', captions: 'word',
  },
  velocity: {
    label: 'Velocity edit', desc: 'Ускорение → резкое замедление под фонк, на дропе вспышки, глитч и тряска, склейка на каждую долю',
    pace: 'drop', build_bars: 2, build_step: 4, drop_steps: [1, 1, 2, 1, 1, 1, 2, 1], end_beats: 8,
    transitions: ['cut', 'flash', 'hblur', 'cut', 'fadewhite'], punch_amount: 0.09, drift: 0.02,
    phases: {
      build: {ramp: [{at: 0, speed: 1.6}, {at: 0.6, speed: 0.4}], fx: {smooth: true, shake: {amount: 0.3}}, transitions: ['hblur', 'smoothleft']},
      hit: {fx: {flash: true, shake: {amount: 1}, rgb: true}, transitions: ['white'], punch_amount: 0.15, punch_every: 1},
      drop: {fx: {shake: {amount: 0.6}, rgb: true}, transitions: ['cut', 'flash', 'cut', 'smoothleft', 'cut', 'hblur'], punch_amount: 0.1, punch_every: 1},
      end: {speed: 0.4, fx: {smooth: true}, transitions: ['white'], punch_amount: 0, drift: 0.1},
    },
    look: {preset: 'teal_orange', vignette: true}, sfx: {transitions: true, hits: true, riser: true, volume: 0.6}, captions: 'box',
  },
  trailer: {
    label: 'Кино-трейлер', desc: 'Полосы кино, затемнения, крупные титры-удары на нарастании, на дропе — вспышка и быстрые кадры, финал с названием',
    pace: 'drop', build_bars: 3, build_step: 4, drop_steps: [2, 2, 2, 1, 1, 2], end_beats: 4,
    transitions: ['black'], punch_amount: 0.06, drift: 0.07, cards: true,
    phases: {
      build: {speed: 0.75, fx: {smooth: true}, transitions: ['black'], punch_amount: 0, drift: 0.08},
      hit: {fx: {flash: true, shake: {amount: 0.8}}, transitions: ['white'], punch_amount: 0.14, punch_every: 1},
      drop: {fx: {shake: {amount: 0.35}}, transitions: ['cut', 'black', 'cut', 'flash'], punch_amount: 0.07, punch_every: 2},
      end: {speed: 0.6, fx: {smooth: true}, transitions: ['black'], punch_amount: 0, drift: 0.1},
    },
    look: {preset: 'teal_orange', vignette: true, grain: 0.35, letterbox: true}, sfx: {hits: true, riser: true, transitions: true, volume: 0.55}, captions: 'outline',
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
  // пользователь 2026-10-17: «доделай автомонтаж, чтобы был на крутом уровне» — на сценке из двух частей прежний монтаж клал титр поверх
  // надписи модели, чёрный кадр с титром в конце и субтитры на персонаже. Скетч — по умолчанию для клипов с речью
  sketch: {
    label: 'Скетч', desc: 'Сценка из клипов с речью: части встык, паузы и «эээ» вырезаны, удар зумом на каждом восклицании, субтитры внизу, без титров и чёрных кадров',
    pace: 'speech', clean_speech: true, transitions: ['cut'], punch_amount: 0.08, drift: 0.03, exclaim_punch: true,
    sfx: {hits: true, volume: 0.3}, captions: 'pop',
  },
  brainrot: {
    label: 'Брейнрот', desc: 'Мем-ролик: склейки встык и вспышки, удары зумом с тряской и звуковые удары на выкриках, сочный цвет, без субтитров и титров',
    pace: 'auto', clean_speech: true, transitions: ['cut', 'flash', 'cut', 'hblur'], punch_amount: 0.13, drift: 0.02, exclaim_punch: true,
    fx: {shake: {amount: 0.5}}, look: {preset: 'neon', vignette: true}, sfx: {hits: true, transitions: true, volume: 0.65}, captions: false,
  },
};
export const recipeList = () => Object.entries(RECIPES).map(([id, r]) => ({id, label: r.label, desc: r.desc}));
