import { useSyncExternalStore } from 'react';
import en from './locales/en.json' with { type: 'json' };
import zh from './locales/zh.json' with { type: 'json' };

export const dictionaries = { en, zh };
let locale;
let translate;
const emptySubscribe = () => () => {};
const initialSnapshot = Object.freeze({ active: 'zh', revision: 0 });

// Retain source keys in state; locale changes must never change mutation identity.
export function uiText(key, params) {
  if (typeof key !== 'string' || !Object.hasOwn(zh, key)) return key;
  if (translate) return translate(key, params);
  return key.replace(/\{(\w+)\}/g, (whole, name) => params?.[name] ?? whole);
}
export function connectLocale(service) {
  const dispose = service.register('corilo-todos', dictionaries);
  locale = service;
  translate = service.bind('corilo-todos');
  return () => { dispose(); if (locale === service) { locale = undefined; translate = undefined; } };
}
export function useTodosLocale() {
  return useSyncExternalStore(
    locale ? (listener) => locale.subscribe(listener) : emptySubscribe,
    () => locale?.getSnapshot() ?? initialSnapshot,
  ).active;
}
