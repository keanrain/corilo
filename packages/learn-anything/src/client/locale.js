// UI-only copy. Lesson content and messages sent to the model never use this module.
import { useSyncExternalStore } from 'react'
import en from './ui-en.json' with { type: 'json' }

let host = null
const listeners = new Set()
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
export function uiLanguage() {
  const language = host?.getSnapshot().active ?? globalThis.document?.documentElement?.lang ?? 'zh'
  return /^zh(?:-|$)/i.test(language) ? 'zh' : 'en'
}
export function useUiLocale() {
  return useSyncExternalStore(subscribe, uiLanguage, uiLanguage)
}
export function translateUi(key, language, values = {}) {
  const text = language === 'zh' || !Object.hasOwn(en, key) ? key : en[key]
  return text.replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(values, name) ? String(values[name]) : token)
}
export function t(key, values) {
  return typeof key === 'string' ? translateUi(key, uiLanguage(), values) : key
}
export function labels(values) {
  return new Proxy(values, { get: (object, key) => Object.hasOwn(object, key) ? t(object[key]) : undefined })
}
export function installLocale(locale) {
  if (!locale) return () => {}
  host = locale
  const unregister = locale.register('corilo-learning-ui', {
    en, zh: Object.fromEntries(Object.keys(en).map((key) => [key, key])),
  })
  const unsubscribe = locale.subscribe(emit)
  emit()
  return () => { unsubscribe(); unregister(); if (host === locale) host = null; emit() }
}
