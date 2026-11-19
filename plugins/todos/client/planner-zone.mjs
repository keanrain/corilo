import { Temporal } from "./planner-dates.mjs";

// The display zone is a per-browser preference. A valid zone is applied at
// once; only an explicit change in the time-zone popover replaces it.
const KEY = "corilo-todos-display-zone";

export function validZone(zone) {
  if (typeof zone !== "string" || !zone) return false;
  try {
    Temporal.Now.zonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}

export function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function savedZone(storage = globalThis.localStorage) {
  try {
    const zone = storage?.getItem(KEY);
    return validZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

export function saveZone(zone, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, zone);
  } catch {
    // Storage can be unavailable (private mode, quota). The zone still applies
    // for this page; it will simply be asked for again next time.
  }
}

export function initialZone(storage = globalThis.localStorage) {
  const zone = savedZone(storage) ?? deviceZone();
  return { zone, confirmed: validZone(zone) };
}
