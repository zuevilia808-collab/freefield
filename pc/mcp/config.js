// Конфиг Freefield, который пользователь заполняет сам: файл Freefield\config.json (рядом с папками mcp и outputs).
// Сюда — то, что нельзя передавать через чат: токен Hugging Face, путь к Blender. Freefield читает значения только у себя на
// компьютере и никогда не возвращает их в ответах инструментов и не пишет в журнал. Пример — config.example.json.
import fs from 'node:fs';
import path from 'node:path';
import {HERE} from './state.js';

export const CONFIG_FILE = process.env.FREEFIELD_CONFIG || path.join(HERE, '..', 'config.json');
let cache = null;
export function readConfig() {
  try {
    const st = fs.statSync(CONFIG_FILE);
    if (cache?.mtime === st.mtimeMs) return cache.data;
    // допускаем комментарии // в начале строк — пользователь правит файл в Блокноте
    const text = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    cache = {mtime: st.mtimeMs, data: JSON.parse(text)};
    return cache.data;
  } catch (e) {
    if (e.code !== 'ENOENT') cache = null;
    return e.code === 'ENOENT' ? {} : {_error: 'config.json не читается: проверьте запятые и кавычки (' + e.message.split('\n')[0].slice(0, 80) + ')'};
  }
}

// Токен Hugging Face для профиля Chrome p: свой у профиля (hf_tokens), общий (hf_token) или из переменной HF_TOKEN.
// Нет токена — Freefield работает через вход в Hugging Face в окне Chrome Freefield этого профиля.
export function hfToken(p = 1) {
  const c = readConfig();
  const t = c.hf_tokens?.[String(p)] || c.hf_token || process.env.HF_TOKEN || '';
  return /^hf_[\w]{10,}$/.test(String(t).trim()) ? String(t).trim() : '';
}
// откуда токен — для отчёта (сам токен не показываем)
export function hfTokenSource(p = 1) {
  const c = readConfig();
  if (c.hf_tokens?.[String(p)]) return `config.json (hf_tokens.${p})`;
  if (c.hf_token) return 'config.json (hf_token)';
  if (process.env.HF_TOKEN) return 'переменная HF_TOKEN';
  return null;
}
export const blenderPath = () => readConfig().blender || '';
// HF Spaces для апскейла: по порядку, первый рабочий
export const upscaleSpaces = () => readConfig().upscale_spaces || null;
// убрать из текста всё, похожее на токен, — на случай, если сервис вернёт его в сообщении об ошибке
export const scrub = s => String(s ?? '').replace(/hf_[A-Za-z0-9]{8,}/g, 'hf_***').replace(/Bearer\s+[\w.-]+/gi, 'Bearer ***');
