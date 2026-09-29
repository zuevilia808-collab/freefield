// Небольшое общее состояние Freefield MCP (проект Flow, расход кредитов, ключ связи с телефоном) — файл .state.json
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AsyncLocalStorage} from 'node:async_hooks';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(HERE, '.state.json');
export const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } };
export const writeState = patch => fs.writeFileSync(STATE_FILE, JSON.stringify({...readState(), ...patch}, null, 2));

// ---- профили Chrome ----
// Профиль Freefield = отдельное окно Chrome со своими аккаунтами во Flow, Dola и Arena (больше бесплатных кредитов).
// Всё, что относится к аккаунтам (вход, кредиты, расход, проект Flow…), у каждого профиля своё: у профиля 1 — в корне
// файла (как раньше), у остальных — в profiles[N]. Текущий профиль задаёт withProfile(N, fn) для всего, что внутри fn.
const profileCtx = new AsyncLocalStorage();
// без явного профиля — тот, что сейчас открыт в Chrome Freefield (не переключаем Chrome зря)
export const currentProfile = () => profileCtx.getStore() || activeProfileId();
export const withProfile = (pid, fn) => profileCtx.run(+pid || 1, fn);
export const readAcct = () => { const st = readState(), p = currentProfile(); return p === 1 ? st : (st.profiles?.[p] || {}); };
export function writeAcct(patch) {
  const p = currentProfile();
  if (p === 1) return writeState(patch);
  const st = readState();
  writeState({profiles: {...st.profiles, [p]: {...(st.profiles?.[p] || {}), ...patch}}});
}
// профили — это профили Google Chrome в окне Freefield (1 = «Default», N = «Profile N−1»); имена — как в Chrome
const chromeCache = () => {
  const dir = process.env.FREEFIELD_BROWSER_PROFILE || path.join(HERE, '..', '.browser-profile');
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'Local State'), 'utf8')).profile?.info_cache || {}; } catch { return {}; }
};
const idOf = dir => dir === 'Default' ? 1 : (+(dir.match(/^Profile (\d+)$/)?.[1]) + 1) || 0;
// номер профиля Chrome, который сейчас открыт в окне Freefield
export const activeProfileId = () => idOf(readState().chromeProfile || 'Default') || 1;
export const profileIds = () => {
  // + профили, окна которых открыл Freefield (новый профиль Chrome записывает в «Local State» не сразу)
  const ids = [...Object.keys(chromeCache()), ...Object.keys(readState().profileCtx || {})].map(idOf).filter(n => n > 0);
  return [...new Set([1, ...ids])].sort((a, b) => a - b);
};
export const profileName = p => chromeCache()[p > 1 ? `Profile ${p - 1}` : 'Default']?.name || `Профиль ${p}`;
