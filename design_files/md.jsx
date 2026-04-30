/* GitHub-flavored markdown renderer for comments
 *
 * Supports:
 *   - paragraphs, headings (#..######)
 *   - **bold**, *italic*, _italic_, ~~strike~~
 *   - `inline code`, ```fenced``` (with language)
 *   - ```suggestion blocks (rendered as accept-able patch)
 *   - > blockquotes (one or more lines)
 *   - - / * / 1. lists, including nested via 2-space indent
 *   - [ ] / [x] task list items
 *   - links [text](url) and bare urls (http(s)://)
 *   - @mentions, #123 issue refs, OWNER/REPO#123 cross-repo refs
 *   - hr (---)
 *   - basic emoji shortcodes (:check:, :warning:, :sparkles:, :rocket:, :eyes:)
 *
 * The renderer is intentionally a from-scratch implementation; it tries to look
 * close to github.com but is not a complete CommonMark implementation. Good
 * enough for a design prototype.
 */

(function () {
  const _Icons = () => window.Icons;

  // ---- inline tokenizer ----------------------------------------------------
  // Walk the string left-to-right; at each position try to match a known
  // inline construct, otherwise consume one char of "text".

  const URL_RE = /^(https?:\/\/[^\s)<>]+)/;
  const MENTION_RE = /^@([a-zA-Z0-9_-]{1,30})/;
  // OWNER/REPO#123 OR #123 OR GH-123
  const ISSUE_RE = /^(?:([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+))?#(\d+)/;
  const EMOJI_MAP = {
    ':check:': '✅',
    ':warning:': '⚠️',
    ':sparkles:': '✨',
    ':rocket:': '🚀',
    ':eyes:': '👀',
    ':thumbsup:': '👍',
    ':bug:': '🐛',
    ':fire:': '🔥',
    ':tada:': '🎉',
    ':x:': '❌',
  };

  function renderInline(src, keyPrefix = 'i') {
    const out = [];
    let buf = '';
    let i = 0;
    let k = 0;
    const flush = () => {
      if (buf) {
        out.push(buf);
        buf = '';
      }
    };
    const push = (node) => {
      flush();
      out.push(React.cloneElement(node, { key: `${keyPrefix}-${k++}` }));
    };

    while (i < src.length) {
      const rest = src.slice(i);
      const c = src[i];

      // escape \X
      if (c === '\\' && i + 1 < src.length) {
        buf += src[i + 1];
        i += 2;
        continue;
      }

      // inline code `code`
      if (c === '`') {
        // count backticks
        let ticks = 0;
        while (src[i + ticks] === '`') ticks++;
        const fence = '`'.repeat(ticks);
        const end = src.indexOf(fence, i + ticks);
        if (end !== -1) {
          const code = src.slice(i + ticks, end);
          push(<code className="md-code">{code}</code>);
          i = end + ticks;
          continue;
        }
      }

      // **bold**
      if (rest.startsWith('**')) {
        const end = src.indexOf('**', i + 2);
        if (end !== -1) {
          push(<strong>{renderInline(src.slice(i + 2, end), `${keyPrefix}-b${k}`)}</strong>);
          i = end + 2;
          continue;
        }
      }

      // ~~strike~~
      if (rest.startsWith('~~')) {
        const end = src.indexOf('~~', i + 2);
        if (end !== -1) {
          push(<del>{renderInline(src.slice(i + 2, end), `${keyPrefix}-s${k}`)}</del>);
          i = end + 2;
          continue;
        }
      }

      // *em* or _em_
      if ((c === '*' || c === '_') && src[i + 1] !== c && src[i + 1] !== ' ') {
        const end = src.indexOf(c, i + 1);
        if (end !== -1 && src[end - 1] !== ' ') {
          push(<em>{renderInline(src.slice(i + 1, end), `${keyPrefix}-e${k}`)}</em>);
          i = end + 1;
          continue;
        }
      }

      // [text](url)
      if (c === '[') {
        const close = src.indexOf(']', i + 1);
        if (close !== -1 && src[close + 1] === '(') {
          const urlEnd = src.indexOf(')', close + 2);
          if (urlEnd !== -1) {
            const text = src.slice(i + 1, close);
            const url = src.slice(close + 2, urlEnd);
            // task list checkbox is handled at block level; here we just render link
            push(
              <a href={url} className="md-link" target="_blank" rel="noreferrer">
                {renderInline(text, `${keyPrefix}-l${k}`)}
              </a>,
            );
            i = urlEnd + 1;
            continue;
          }
        }
      }

      // bare url
      if (c === 'h') {
        const m = rest.match(URL_RE);
        if (m) {
          push(
            <a href={m[1]} className="md-link" target="_blank" rel="noreferrer">
              {m[1].replace(/^https?:\/\//, '')}
            </a>,
          );
          i += m[1].length;
          continue;
        }
      }

      // @mention (must be at start of string or after whitespace/punct)
      if (c === '@') {
        const before = i === 0 ? ' ' : src[i - 1];
        if (/[\s(,.;!?]/.test(before)) {
          const m = rest.match(MENTION_RE);
          if (m) {
            push(<span className="md-mention">@{m[1]}</span>);
            i += m[0].length;
            continue;
          }
        }
      }

      // #123 issue / OWNER/REPO#123
      if (
        c === '#' ||
        (c.match(/[a-zA-Z0-9]/) && rest.match(ISSUE_RE) && /[\s(,.;!?]|^/.test(i === 0 ? ' ' : src[i - 1]))
      ) {
        // accept just plain "#NNN" cleanly
        const m = rest.match(ISSUE_RE);
        if (m && (i === 0 || /[\s(,.;!?]/.test(src[i - 1]))) {
          const repo = m[1];
          const num = m[2];
          push(
            <a className="md-issue" href="#" onClick={(e) => e.preventDefault()}>
              {repo ? `${repo}#${num}` : `#${num}`}
            </a>,
          );
          i += m[0].length;
          continue;
        }
      }

      // emoji :foo:
      if (c === ':') {
        const close = src.indexOf(':', i + 1);
        if (close !== -1 && close - i < 20) {
          const key = src.slice(i, close + 1);
          if (EMOJI_MAP[key]) {
            buf += EMOJI_MAP[key];
            i = close + 1;
            continue;
          }
        }
      }

      // default: consume one char
      buf += c;
      i++;
    }
    flush();
    return out;
  }

  // ---- block parser --------------------------------------------------------
  // Split into lines and group into blocks. Each block is rendered as JSX.

  function splitLines(s) {
    return s.replace(/\r\n/g, '\n').split('\n');
  }

  function parseBlocks(src) {
    const lines = splitLines(src);
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // blank line — skip
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      // hr
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
        blocks.push({ kind: 'hr' });
        i++;
        continue;
      }

      // heading
      const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (hMatch) {
        blocks.push({ kind: 'heading', level: hMatch[1].length, text: hMatch[2] });
        i++;
        continue;
      }

      // fenced code block
      const fenceMatch = line.match(/^```\s*([a-zA-Z0-9_-]*)\s*$/);
      if (fenceMatch) {
        const lang = fenceMatch[1] || '';
        i++;
        const buf = [];
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // consume closing fence
        blocks.push({ kind: 'code', lang, content: buf.join('\n') });
        continue;
      }

      // blockquote
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        blocks.push({ kind: 'quote', content: buf.join('\n') });
        continue;
      }

      // list (ul or ol)
      const liMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
      if (liMatch) {
        const ordered = /\d+\./.test(liMatch[2]);
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
          if (!m) {
            // continuation line (indented under last item)?
            if (items.length && /^\s{2,}\S/.test(lines[i])) {
              items[items.length - 1].text += '\n' + lines[i].replace(/^\s+/, '');
              i++;
              continue;
            }
            // blank line ends list only if next non-blank is not a list item
            if (/^\s*$/.test(lines[i])) {
              // peek
              let j = i + 1;
              while (j < lines.length && /^\s*$/.test(lines[j])) j++;
              if (j < lines.length && /^(\s*)([-*]|\d+\.)\s+/.test(lines[j])) {
                i = j;
                continue;
              }
            }
            break;
          }
          const indent = m[1].length;
          // strip leading task-list checkbox
          let text = m[3];
          let task = null;
          const taskM = text.match(/^\[( |x|X)\]\s+(.*)$/);
          if (taskM) {
            task = taskM[1].toLowerCase() === 'x';
            text = taskM[2];
          }
          items.push({ indent, text, task, ordered });
          i++;
        }
        blocks.push({ kind: 'list', ordered, items });
        continue;
      }

      // paragraph: consume lines until blank, fence, heading, list, quote, hr
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i])) {
        const cur = lines[i];
        if (cur.startsWith('```')) break;
        if (/^#{1,6}\s+/.test(cur)) break;
        if (/^\s*>/.test(cur)) break;
        if (/^(\s*)([-*]|\d+\.)\s+/.test(cur)) break;
        if (/^\s*(---|\*\*\*)\s*$/.test(cur)) break;
        buf.push(cur);
        i++;
      }
      blocks.push({ kind: 'para', content: buf.join('\n') });
    }
    return blocks;
  }

  // ---- block renderers -----------------------------------------------------

  function CodeBlock({ lang, content }) {
    if (lang === 'suggestion') {
      // GitHub-style suggestion block — the single best UX
      return (
        <div className="md-suggestion">
          <div className="md-suggestion-head">
            <span className="md-suggestion-icon">
              {window.Icons && window.Icons.Spark ? <window.Icons.Spark /> : null}
            </span>
            <span>Suggested change</span>
            <div className="md-suggestion-actions">
              <button className="md-suggestion-btn">Apply</button>
            </div>
          </div>
          <pre className="md-suggestion-body">
            <code>{content}</code>
          </pre>
        </div>
      );
    }
    if (lang === 'diff') {
      // colorize +/- lines
      const lines = content.split('\n');
      return (
        <pre className={`md-codeblock md-diff lang-diff`}>
          <code>
            {lines.map((ln, idx) => {
              const cls =
                ln.startsWith('+') && !ln.startsWith('+++')
                  ? 'diff-add'
                  : ln.startsWith('-') && !ln.startsWith('---')
                    ? 'diff-rem'
                    : ln.startsWith('@@')
                      ? 'diff-hunk'
                      : '';
              return (
                <span key={idx} className={cls}>
                  {ln}
                  {'\n'}
                </span>
              );
            })}
          </code>
        </pre>
      );
    }
    return (
      <pre className={`md-codeblock ${lang ? `lang-${lang}` : ''}`}>
        {lang && <div className="md-codeblock-lang">{lang}</div>}
        <code>{content}</code>
      </pre>
    );
  }

  function List({ block, keyPrefix }) {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag className={`md-list ${block.items.some((it) => it.task !== null) ? 'md-tasklist' : ''}`}>
        {block.items.map((it, idx) => (
          <li key={`${keyPrefix}-li${idx}`} className={it.task !== null ? 'md-task' : ''}>
            {it.task !== null && <input type="checkbox" checked={it.task} readOnly className="md-task-cb" />}
            {renderInline(it.text, `${keyPrefix}-li${idx}`)}
          </li>
        ))}
      </Tag>
    );
  }

  function Heading({ level, text, keyPrefix }) {
    const Tag = `h${Math.min(6, Math.max(1, level))}`;
    return <Tag className={`md-h md-h${level}`}>{renderInline(text, keyPrefix)}</Tag>;
  }

  function Quote({ content, keyPrefix }) {
    const inner = render(content, `${keyPrefix}-q`);
    return <blockquote className="md-quote">{inner}</blockquote>;
  }

  function Para({ content, keyPrefix }) {
    // GitHub treats single line breaks as <br/> within a paragraph
    const lines = content.split('\n');
    return (
      <p className="md-p">
        {lines.map((ln, idx) => (
          <React.Fragment key={`${keyPrefix}-pl${idx}`}>
            {renderInline(ln, `${keyPrefix}-pl${idx}`)}
            {idx < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </p>
    );
  }

  // ---- top-level render ---------------------------------------------------

  function render(src, keyPrefix = 'md') {
    if (!src) return null;
    const blocks = parseBlocks(src);
    return blocks.map((b, idx) => {
      const k = `${keyPrefix}-${idx}`;
      if (b.kind === 'hr') return <hr key={k} className="md-hr" />;
      if (b.kind === 'heading') return <Heading key={k} {...b} keyPrefix={k} />;
      if (b.kind === 'code') return <CodeBlock key={k} {...b} />;
      if (b.kind === 'quote') return <Quote key={k} {...b} keyPrefix={k} />;
      if (b.kind === 'list') return <List key={k} block={b} keyPrefix={k} />;
      return <Para key={k} {...b} keyPrefix={k} />;
    });
  }

  function Markdown({ source, className }) {
    return <div className={`md ${className || ''}`}>{render(source || '')}</div>;
  }

  Object.assign(window, { Markdown, renderMarkdown: render });
})();
