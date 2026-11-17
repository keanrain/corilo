// Display helpers never change the stored date, time zone, or edit snapshot.
import { strip } from './planner-record.mjs';

export function plannerDraftChanged(editor) {
  if (!editor) return false;
  const original = editor.item ? strip(editor.item) : editor.initial ?? {};
  const keys = new Set([...Object.keys(original), ...Object.keys(editor.value)]);
  return [...keys].some(key => JSON.stringify(original[key]) !== JSON.stringify(editor.value[key]));
}

const formatters = new Map();
function format(language, options) {
  const key = JSON.stringify([language, options]);
  if (!formatters.has(key)) {
    const formatter = new Intl.DateTimeFormat(language, options);
    if (formatters.size >= 48) formatters.delete(formatters.keys().next().value);
    formatters.set(key, formatter);
  }
  return formatters.get(key);
}

export function plannerDateLabel(value, language, timeZone = 'UTC', now = new Date()) {
  if (!value) return '';
  try {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(day ? `${value}T12:00:00Z` : value);
    const displayZone = day ? 'UTC' : timeZone;
    const year = format('en', { year: 'numeric', timeZone: displayZone }).format(date);
    const currentYear = format('en', { year: 'numeric', timeZone }).format(now);
    return format(language, {
      month: 'short', day: 'numeric', ...(year !== currentYear ? { year: 'numeric' } : {}),
      ...(day ? {} : { hour: '2-digit', minute: '2-digit' }), timeZone: displayZone,
    }).format(date);
  } catch { return value; }
}
