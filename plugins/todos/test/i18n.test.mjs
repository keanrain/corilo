import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectLocale, dictionaries, uiText } from '../client/i18n.mjs';

test('both locales cover the same UI keys and preserve interpolation parameters', () => {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort());
  for (const [key, translation] of Object.entries(dictionaries.en)) {
    assert.ok(translation.trim(), key);
    assert.deepEqual(translation.match(/\{\w+\}/g)?.sort() ?? [], dictionaries.zh[key].match(/\{\w+\}/g)?.sort() ?? [], key);
  }
});

test('language switches translate stored UI keys while retaining user text verbatim', () => {
  let active = 'en', registered;
  const service = {
    register(namespace, values) { assert.equal(namespace, 'corilo-todos'); registered = values; return () => { registered = undefined; }; },
    bind() { return (key, params) => registered[active][key].replace(/\{(\w+)\}/g, (whole, name) => params?.[name] ?? whole); },
  };
  const dispose = connectLocale(service);
  const notice = '未找到回执，可重试原请求';
  assert.equal(uiText(notice), 'No receipt found. You may retry the original request.');
  assert.equal(uiText('完成：{title}', { title: '保存' }), 'Complete: 保存');
  assert.equal(uiText('自定义任务内容'), '自定义任务内容');
  active = 'zh';
  assert.equal(uiText(notice), notice);
  assert.equal(uiText('完成：{title}', { title: 'Save' }), '完成：Save');
  dispose();
  assert.equal(registered, undefined);
});
