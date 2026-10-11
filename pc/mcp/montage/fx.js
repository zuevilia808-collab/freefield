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
export const transitionOf = t => {
  const def = TRANSITIONS[t?.type] || (t?.type ? {xfade: t.type, d: 0.25} : TRANSITIONS.cut);
  return {xfade: def.xfade, d: def.xfade ? Math.max(0.04, t.duration || def.d) : 0};
};
// набор для автомонтажа под бит: разные, но предсказуемые
export const BEAT_SET = ['hblur', 'fadewhite', 'smoothleft', 'cut', 'circleopen', 'smoothup', 'cut', 'slideleft'];

// зум кадра во времени для zoompan (ot = секунды от начала потока куска; pre — где в потоке начало клипа на шкале)
export function zoomExpr(fx, {fps, pre, len}) {
  const ot = `(on/${fps})`;
  const parts = ['1'];
  if (fx.drift) parts.push(`${fx.drift}*max(0,${ot}-${pre.toFixed(3)})/${Math.max(0.1, len).toFixed(3)}`);
  for (const p of fx.punch || []) {
    const at = (pre + p).toFixed(3);
    parts.push(`${fx.punch_amount}*exp(-11*(${ot}-${at}))*gte(${ot},${at})`);
  }
  return parts.join('+');
}
export const hasZoom = fx => !!(fx.drift || fx.punch?.length);
