import { useSyncExternalStore } from 'react';
import '../workspace/i18n.js';
export const ui = globalThis.coriloNotesUI;
export const t = key => ui.t(key);
export const useLocale = () => useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot);
export function bindLocale(ctx) {
  ctx.effect(() => ctx.locale.register('corilo-notes', { zh: ui.zh, en: ui.en }));
  ctx.effect(() => {
    const update = () => ui.setLocale(ctx.locale.getSnapshot().active);
    update();
    return ctx.locale.subscribe(update);
  });
}
