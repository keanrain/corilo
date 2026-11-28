// UI-only copy. Lesson content and messages sent to the model never use this module.
// The English table is served by the Host (GET /api/learn-anything/locale/en) and loaded only when
// the UI is in English, so it stays out of the client bundle; until it arrives the Chinese source shows.
import { useSyncExternalStore } from 'react'

export const ENGLISH_URL = '/api/learn-anything/locale/en'
const RETRY_MS = 30_000

let host = null
let en = {}
let loading = null
let failedAt = 0
let version = 0
let unregister = () => {}
const listeners = new Set()
const emit = () => { version++; listeners.forEach((listener) => listener()) }
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

function registerResources() {
  if (!host) return
  unregister()
  unregister = host.register('corilo-learning-ui', { en, zh: Object.fromEntries(Object.keys(en).map((key) => [key, key])) })
}

/** Use an English table directly (tests and fixtures without the Host route). */
export function provideEnglish(table) {
  en = table && typeof table === 'object' ? table : {}
  loading = null; failedAt = 0
  registerResources()
  emit()
}

function loadEnglish() {
  if (loading || Object.keys(en).length || Date.now() - failedAt < RETRY_MS || typeof globalThis.fetch !== 'function') return
  loading = globalThis.fetch(ENGLISH_URL, { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
    .then((table) => provideEnglish(table))
    .catch(() => { loading = null; failedAt = Date.now() })
}

export function uiLanguage() {
  const language = host?.getSnapshot().active ?? globalThis.document?.documentElement?.lang ?? 'zh'
  if (/^zh(?:-|$)/i.test(language)) return 'zh'
  loadEnglish()
  return 'en'
}
const snapshot = () => `${uiLanguage()}:${version}`
export function useUiLocale() {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return uiLanguage()
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
  registerResources()
  const unsubscribe = locale.subscribe(emit)
  emit()
  uiLanguage()
  return () => {
    unsubscribe()
    if (host === locale) { unregister(); unregister = () => {}; host = null }
    emit()
  }
}
