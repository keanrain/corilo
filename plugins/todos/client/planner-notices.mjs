// Success notices fade on their own; errors, conflicts, pending and unknown
// states stay until the person handles them, so only this allow-list is cleared.
export const NOTICE_DISMISS_MS = 3000;
const TRANSIENT = new Set(["已添加", "已保存", "任务已完成", "任务已恢复"]);
export const isTransientNotice = (notice) => TRANSIENT.has(notice);

export function createNoticeDismisser({
  get, set, delay = NOTICE_DISMISS_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
}) {
  let timer;
  const cancel = () => { if (timer !== undefined) clearTimer(timer); timer = undefined; };
  return {
    schedule(notice) {
      cancel();
      if (!isTransientNotice(notice)) return;
      timer = setTimer(() => {
        timer = undefined;
        // Do not wipe a newer notice that replaced this one.
        if (get().notice === notice) set({ notice: "" });
      }, delay);
    },
    dispose: cancel,
  };
}
