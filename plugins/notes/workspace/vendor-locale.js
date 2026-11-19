/* Chinese labels for the pinned Files.md interface, applied at runtime.
 * The vendor files stay byte for byte; only known interface strings in known
 * places are swapped, never note names or note contents. Switching back to
 * English restores the upstream text. */
(() => {
  const zh = {
    'Close sidebar (⌘~)': '收起侧栏（⌘~）',
    'New File (⌘N)': '新建笔记（⌘N）',
    'New Folder (⌘⇧N)': '新建文件夹（⌘⇧N）',
    'Open folder': '打开文件夹',
    'Show Random File': '随机打开一篇',
    'Go Back (⌘[)': '后退（⌘[）',
    'Go Forward (⌘])': '前进（⌘]）',
    'Close (Esc)': '关闭（Esc）',
    'Close split view': '关闭分栏',
    'Record voice message': '录制语音',
    'Send': '发送',
    'Close chat': '关闭收集',
    'Toggle fullscreen': '切换全屏',
    'Dump your thoughts...': '想到什么，先记下来…',
    'Free your mind': '先记下，再整理',
    'Mark as done': '标记完成',
    'To File': '移到笔记',
    'To Journal': '记入日记',
    'To Later': '稍后处理',
    'To Read': '待读',
    'To Shop': '待买',
    'To Watch': '待看',
    'To Archive': '归档',
    'New file': '新建笔记',
    'New dir': '新建文件夹',
    'Rename': '重命名',
    'Move': '移动',
    'Delete': '删除',
    'chat': '收集',
    'journal': '日记',
  };
  // Native dialogs: exact texts and simple patterns with a captured tail.
  const dialogs = [
    [/^Enter folder name:$/, () => '文件夹名称：'],
    [/^New Folder$/, () => '新建文件夹'],
    [/^New directory name:$/, () => '新文件夹名称：'],
    [/^Rename folder:$/, () => '重命名文件夹：'],
    [/^Rename file:$/, () => '重命名笔记：'],
    [/^Folder name cannot be empty$/, () => '文件夹名称不能为空'],
    [/^Folder name cannot contain "(.+)"$/, (m) => `文件夹名称不能包含“${m[1]}”`],
    [/^File name cannot contain "(.+)"$/, (m) => `文件名不能包含“${m[1]}”`],
    [/^Delete folder "(.+)" and everything inside it\?$/s, (m) => `删除文件夹“${m[1]}”及其中全部内容？`],
    [/^Delete "(.+)"\?$/s, (m) => `删除“${m[1]}”？`],
    [/^(Create file|Create dir|Rename|Move|Delete) failed: (.*)$/s, (m) => `${{ 'Create file': '新建笔记', 'Create dir': '新建文件夹', Rename: '重命名', Move: '移动', Delete: '删除' }[m[1]]}失败：${m[2]}`],
    [/^Cannot rename file to "(.+)": (.*)$/s, (m) => `无法重命名为“${m[1]}”：${m[2]}`],
  ];
  const zhActive = () => globalThis.coriloNotesUI?.getSnapshot() === 'zh';
  const translateDialog = (text) => {
    if (!zhActive() || typeof text !== 'string') return text;
    for (const [pattern, render] of dialogs) { const m = text.match(pattern); if (m) return render(m); }
    return text;
  };
  for (const name of ['alert', 'confirm']) {
    const native = window[name].bind(window);
    window[name] = (message) => native(translateDialog(message));
  }
  const nativePrompt = window.prompt.bind(window);
  window.prompt = (message, value) => {
    // Only the upstream create-folder placeholder is UI text. Rename defaults
    // are existing names and must be passed through verbatim.
    const defaultValue = message === 'Enter folder name:' && value === 'New Folder'
      ? translateDialog(value) : value;
    return nativePrompt(translateDialog(message), defaultValue);
  };

  // Where interface text lives. Anything else (tree names, editor) is user data.
  const attributes = ['data-tooltip', 'aria-label', 'title', 'placeholder'];
  const textSelectors = ['.empty-title', '.btn-label', '.sidebar-ctx-menu-item'];
  const original = new WeakMap(); // element -> {attr: upstream value} / text node -> upstream text
  function swapText(node) {
    const upstream = original.get(node) ?? node.nodeValue;
    const key = upstream.trim();
    const want = zhActive() && Object.hasOwn(zh, key) ? zh[key] : null;
    if (want) { original.set(node, upstream); if (node.nodeValue !== want) node.nodeValue = want; }
    else if (original.has(node) && node.nodeValue !== upstream) node.nodeValue = upstream;
  }
  function swapAttributes(element) {
    const saved = original.get(element) ?? {};
    for (const attr of attributes) {
      if (!element.hasAttribute(attr)) continue;
      const upstream = saved[attr] ?? element.getAttribute(attr);
      const want = zhActive() && Object.hasOwn(zh, upstream) ? zh[upstream] : null;
      if (want) { saved[attr] = upstream; if (element.getAttribute(attr) !== want) element.setAttribute(attr, want); }
      else if (attr in saved && element.getAttribute(attr) !== upstream) element.setAttribute(attr, upstream);
    }
    if (Object.keys(saved).length) original.set(element, saved);
  }
  // Only the system entries of the tree: the capture page and the journal root.
  function systemTreeLabels(root) {
    for (const item of root.querySelectorAll('#sidebar .tree-item')) {
      const label = item.lastChild;
      if (label?.nodeType !== Node.TEXT_NODE) continue;
      const upstream = (original.get(label) ?? label.nodeValue).trim();
      const topLevel = !item.closest('li')?.parentElement?.closest('li');
      const isChat = item.classList.contains('sidebar-chat') && upstream === 'chat';
      const isJournal = topLevel && !item.classList.contains('tree-leaf') && upstream === 'journal';
      if (isChat || isJournal) swapText(label);
    }
  }
  function apply(root = document) {
    if (root.nodeType === Node.ELEMENT_NODE && attributes.some((a) => root.hasAttribute(a))) swapAttributes(root);
    for (const element of root.querySelectorAll?.(attributes.map((a) => `[${a}]`).join(',')) ?? []) {
      if (element.closest('.CodeMirror')) continue;
      swapAttributes(element);
    }
    const holders = [...(root.querySelectorAll?.(textSelectors.join(',')) ?? [])];
    if (root.matches?.(textSelectors.join(','))) holders.push(root);
    for (const holder of holders) for (const node of holder.childNodes) if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) swapText(node);
    // Icon-only capture actions get an accessible name from their tooltip.
    for (const button of document.querySelectorAll('.action-btn')) {
      const label = button.querySelector('.btn-label')?.textContent.trim();
      if (label && button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    }
    systemTreeLabels(document);
  }
  let pending = false;
  const schedule = () => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; observer.disconnect(); apply(); observer.observe(document.documentElement, watch); }); };
  const observer = new MutationObserver(schedule);
  const watch = { childList: true, subtree: true, attributes: true, attributeFilter: attributes };
  const start = () => { apply(); observer.observe(document.documentElement, watch); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  globalThis.coriloNotesUI?.subscribe(schedule);
})();
