import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function dictionary() {
  const scope = {};
  vm.runInNewContext(readFileSync(new URL('../workspace/i18n.js', import.meta.url), 'utf8'), scope);
  return scope.coriloNotesUI;
}

test('owned interface copy follows English and Chinese, preserving unknown text', () => {
  const ui = dictionary();
  ui.setLocale('en-US');
  assert.equal(ui.t('保存副本'), 'Save a copy');
  assert.equal(ui.t('文件已变化，当前输入仍保留'), 'The file changed. Your input is preserved.');
  assert.equal(ui.t('用户文件 Notes.md'), '用户文件 Notes.md');
  assert.equal(ui.t('__proto__'), '__proto__');
  assert.equal(ui.t('toString'), 'toString');
  ui.setLocale('zh-CN');
  assert.equal(ui.t('Save a copy'), '保存副本');
  assert.equal(ui.t('The file changed. Your input is preserved.'), '文件已变化，当前输入仍保留');
});

test('locale subscriptions update once per change and dispose cleanly', () => {
  const ui = dictionary();
  const seen = [];
  const dispose = ui.subscribe(() => seen.push(ui.getSnapshot()));
  ui.setLocale('en');
  ui.setLocale('en-US');
  ui.setLocale('zh');
  dispose();
  ui.setLocale('en');
  assert.deepEqual(seen, ['en', 'zh']);
});
