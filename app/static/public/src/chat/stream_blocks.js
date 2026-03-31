function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(value) {
  let output = escapeHtml(value);
  output = output.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  output = output.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return output;
}

function replaceMediaTokens(value, resolveRenderGroup) {
  if (typeof resolveRenderGroup !== 'function') return value;
  return String(value || '').replace(
    /(?:@@GROK_MEDIA_CARD_[^@]+@@(?:\s|&nbsp;|\u00a0|\u2060)*)+/g,
    (match) => {
      const ids = Array.from(match.matchAll(/@@GROK_MEDIA_CARD_([^@]+)@@/g))
        .map((part) => String(part[1] || '').trim())
        .filter(Boolean);
      if (!ids.length) return '';
      return resolveRenderGroup(ids);
    }
  );
}

function replaceMarkdownImagesLite(value, renderImage) {
  const text = String(value || '');
  if (!text.includes('![') || typeof renderImage !== 'function') return text;
  let result = '';
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf('![', index);
    if (start === -1) {
      result += text.slice(index);
      break;
    }

    result += text.slice(index, start);
    const altEnd = text.indexOf(']', start + 2);
    if (altEnd === -1) {
      result += text.slice(start);
      break;
    }

    let cursor = altEnd + 1;
    while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '(') {
      cursor += 1;
    }

    if (cursor >= text.length || text[cursor] !== '(') {
      result += text.slice(start, cursor);
      index = cursor;
      continue;
    }

    let depth = 0;
    let end = cursor;
    for (; end < text.length; end += 1) {
      const ch = text[end];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    if (end >= text.length || text[end] !== ')') {
      result += text.slice(start);
      break;
    }

    const alt = text.slice(start + 2, altEnd);
    const url = text.slice(cursor + 1, end);
    result += renderImage({ alt, url, raw: text.slice(start, end + 1) });
    index = end + 1;
  }

  return result;
}

function parseThinkLiteSections(raw) {
  const source = String(raw || '');
  if (!source.includes('<think>')) {
    return [{ type: 'text', value: source, open: false }];
  }
  const parts = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<think>', cursor);
    if (start === -1) {
      const textPart = source.slice(cursor);
      if (textPart) parts.push({ type: 'text', value: textPart, open: false });
      break;
    }
    if (start > cursor) {
      parts.push({ type: 'text', value: source.slice(cursor, start), open: false });
    }
    const thinkStart = start + '<think>'.length;
    const end = source.indexOf('</think>', thinkStart);
    if (end === -1) {
      parts.push({ type: 'think', value: source.slice(thinkStart), open: true });
      break;
    }
    parts.push({ type: 'think', value: source.slice(thinkStart, end), open: true });
    cursor = end + '</think>'.length;
  }
  return parts;
}

function renderLiteLine(line) {
  const trimmed = line.trimEnd();
  if (!trimmed) return '';
  const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const level = Math.min(6, headingMatch[1].length);
    return `<div class="stream-lite-heading stream-lite-heading-${level}">${renderInlineMarkdown(headingMatch[2])}</div>`;
  }
  const listMatch = trimmed.match(/^([*-]|\d+\.)\s+(.*)$/);
  if (listMatch) {
    return `<div class="stream-lite-list"><span class="stream-lite-marker">${escapeHtml(listMatch[1])}</span><span>${renderInlineMarkdown(listMatch[2])}</span></div>`;
  }
  const quoteMatch = trimmed.match(/^>\s?(.*)$/);
  if (quoteMatch) {
    return `<div class="stream-lite-quote">${renderInlineMarkdown(quoteMatch[1])}</div>`;
  }
  return `<div class="stream-lite-line">${renderInlineMarkdown(trimmed)}</div>`;
}

function renderLiteBody(text, options = {}) {
  const source = String(text || '').replace(/\\n/g, '\n');
  if (!source.trim()) return '';
  const withSlots = replaceMediaTokens(source, options.resolveRenderGroup);
  const withImages = replaceMarkdownImagesLite(withSlots, options.renderMarkdownImage || (({ alt, url }) => {
    const safeUrl = escapeHtml(String(url || '').trim());
    const safeAlt = escapeHtml(String(alt || 'image').trim() || 'image');
    if (!safeUrl) return '';
    return `<figure class="message-image-card stream-lite-image-card"><img src="${safeUrl}" alt="${safeAlt}" loading="lazy" referrerpolicy="no-referrer" crossorigin="anonymous"></figure>`;
  }));
  const normalizedParagraphs = withImages.split(/\n{2,}/);
  return normalizedParagraphs
    .map((paragraph) => {
      if (/<div class="stream-media-slot"|<figure class="message-image-card/.test(paragraph.trim())) {
        return `<div class="stream-lite-paragraph">${paragraph.trim()}</div>`;
      }
      const lines = paragraph.split('\n').map((line) => renderLiteLine(line)).filter(Boolean);
      if (!lines.length) return '';
      return `<div class="stream-lite-paragraph">${lines.join('')}</div>`;
    })
    .filter(Boolean)
    .join('');
}

export function renderLiteMarkdown(text, options = {}) {
  const source = String(text || '').replace(/\\n/g, '\n');
  if (!source.trim()) return '';
  const parts = parseThinkLiteSections(source);
  return parts
    .map((part) => {
      if (part.type === 'think') {
        const body = renderLiteBody(part.value, options);
        const openAttr = part.open ? ' open' : '';
        return `<details class="think-block" data-think="true"${openAttr}><summary class="think-summary">思考中</summary><div class="think-content">${body || '<em>（空）</em>'}</div></details>`;
      }
      return renderLiteBody(part.value, options);
    })
    .filter(Boolean)
    .join('');
}

export function splitStableAndTail(text) {
  const source = String(text || '').replace(/\\n/g, '\n');
  if (!source) {
    return {
      stableText: '',
      liveTailText: '',
      stableIndex: 0
    };
  }

  let inCodeFence = false;
  let thinkDepth = 0;
  let lastBoundary = 0;

  for (let index = 0; index < source.length; index += 1) {
    const slice = source.slice(index);
    const lineStart = index === 0 || source[index - 1] === '\n';

    if (lineStart && slice.startsWith('```')) {
      inCodeFence = !inCodeFence;
    }
    if (slice.startsWith('<think>')) {
      thinkDepth += 1;
    }
    if (slice.startsWith('</think>')) {
      thinkDepth = Math.max(0, thinkDepth - 1);
    }
    if (!inCodeFence && thinkDepth === 0 && slice.startsWith('\n\n')) {
      lastBoundary = index + 2;
    }
  }

  if (!inCodeFence && thinkDepth === 0 && source.endsWith('\n')) {
    const trailingBoundary = source.match(/\n{2,}$/);
    if (trailingBoundary) {
      lastBoundary = source.length;
    }
  }

  return {
    stableText: source.slice(0, lastBoundary),
    liveTailText: source.slice(lastBoundary),
    stableIndex: lastBoundary
  };
}
