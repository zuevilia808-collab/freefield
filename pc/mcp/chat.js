// Какой чат Claude сейчас работает (у главной копии Freefield их много — по одному подключению на чат):
// общая очередь (xq.js) раздаёт места сайтов по кругу между чатами, а не между процессами
import {AsyncLocalStorage} from 'node:async_hooks';
export const chatCtx = new AsyncLocalStorage();
export const chatTag = () => chatCtx.getStore()?.tag || String(process.pid);
