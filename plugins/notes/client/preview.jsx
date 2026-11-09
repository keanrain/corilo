import React, { useDeferredValue, useMemo } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
// An image is a label, never a network request, even for an authenticated URL.
parser.renderer.rules.image = (tokens, index) => parser.utils.escapeHtml(`[图片：${tokens[index].content || '无说明'}]`);
const link = parser.renderer.rules.link_open || ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options));
parser.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return link(tokens, index, options, env, renderer);
};

export const PREVIEW_LIMIT = 128 * 1024;
export function safeMarkdown(text) {
  if (!DOMPurify.isSupported) return parser.utils.escapeHtml(text);
  return DOMPurify.sanitize(parser.render(text), {
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'em', 'strong', 's', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'start'],
    ADD_URI_SAFE_ATTR: ['target', 'rel', 'start'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

export function MarkdownPreview({ text }) {
  // This component is only mounted while preview is visible. Defer large edits
  // and cap preview independently from the 1 MiB storage/editor limit.
  const deferred = useDeferredValue(text);
  const oversized = text.length > PREVIEW_LIMIT;
  const html = useMemo(() => deferred.length <= PREVIEW_LIMIT ? safeMarkdown(deferred) : '', [deferred]);
  return <section className="corilo-notes-preview" aria-label="Markdown 实时预览" aria-busy={text !== deferred}>
    {oversized ? <p>正文超过 128 Ki 字符，已暂停预览；仍可完整编辑和保存。</p>
      : !text ? <p className="corilo-notes-hint">写下 Markdown，在这里查看排版。</p>
        : <div dangerouslySetInnerHTML={{ __html: html }} />}
  </section>;
}
