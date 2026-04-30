/* Diff line + comment thread + hunk components */

function CommentSourceBadge({ source, syncStatus }) {
  const Icon = window.Icons;
  if (syncStatus === 'syncing') {
    return (
      <span className="source syncing">
        <Icon.Refresh />
        syncing…
      </span>
    );
  }
  if (syncStatus === 'pending') {
    return (
      <span className="source pending">
        <Icon.Dot />
        pending
      </span>
    );
  }
  if (source === 'github') {
    return (
      <span className="source synced">
        <Icon.Github />
        from GitHub
      </span>
    );
  }
  return (
    <span className="source synced">
      <Icon.Check />
      synced to GitHub
    </span>
  );
}

function Comment({ c, onReply: _onReply }) {
  const a = (window.AUTHORS && window.AUTHORS[c.author]) || {
    name: c.author,
    short: c.author,
    initials: '??',
    color: '#60646C',
    kind: 'human',
  };
  const isBot = a.kind === 'bot';
  return (
    <div className={`comment ${isBot ? 'bot' : ''}`}>
      <span className="av" style={{ background: a.color }}>
        {a.initials}
      </span>
      <div className="body">
        <div className="row1">
          <b>{a.short}</b>
          {isBot && <span className="bot-tag">bot</span>}
          <span className="when">{c.createdAt}</span>
          <CommentSourceBadge source={c.source} syncStatus={c.syncStatus} />
        </div>
        <div className="text">{window.Markdown ? <window.Markdown source={c.body} /> : c.body}</div>
      </div>
    </div>
  );
}

function Thread({ comments, onAddReply, autoOpen: _autoOpen, onClose }) {
  const Icon = window.Icons;
  const [reply, setReply] = React.useState('');
  const baselineRef = React.useRef(comments.length);
  const [conflictedSince, setConflictedSince] = React.useState(0);

  // Detect new comments arriving while user is composing.
  React.useEffect(() => {
    if (reply.trim() && comments.length > baselineRef.current) {
      setConflictedSince(comments.length - baselineRef.current);
    } else if (!reply.trim()) {
      // user cleared the draft → reset baseline
      baselineRef.current = comments.length;
      setConflictedSince(0);
    }
  }, [comments.length, reply]);

  const acknowledgeConflict = () => {
    baselineRef.current = comments.length;
    setConflictedSince(0);
  };

  return (
    <div className={`thread ${conflictedSince > 0 ? 'has-conflict' : ''}`}>
      {comments.map((c, idx) => {
        const isNewArrival = idx >= baselineRef.current && conflictedSince > 0;
        return (
          <React.Fragment key={c.id}>
            <div className={isNewArrival ? 'comment-new-arrival' : ''}>
              <Comment c={c} />
              {(c.replies || []).map((r) => (
                <Comment key={r.id} c={r} />
              ))}
            </div>
          </React.Fragment>
        );
      })}
      {conflictedSince > 0 && (
        <div className="conflict-banner">
          <Icon.Refresh />
          <span>
            <b>
              {conflictedSince} new {conflictedSince === 1 ? 'comment' : 'comments'}
            </b>{' '}
            arrived while you were typing.
          </span>
          <button onClick={acknowledgeConflict}>Got it</button>
        </div>
      )}
      <div className="reply-area">
        <textarea
          placeholder="Reply… (this will sync to GitHub)"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <div className="btnrow">
          {onClose && (
            <button className="btn ghost sm" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn surface sm">Save draft</button>
          <button
            className="btn primary sm"
            onClick={() => {
              if (reply.trim()) {
                onAddReply && onAddReply(reply);
                setReply('');
              }
            }}
          >
            <Icon.Send />
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}

function CodeLine({ line, comments, onAddComment, hasComment, onToggleComment, isOpen, dim }) {
  const Icon = window.Icons;
  const cls = `line ${line.kind === '+' ? 'add' : line.kind === '-' ? 'rem' : ''} ${dim ? 'dim' : ''}`;
  return (
    <>
      <div className={cls}>
        <span className="ln">{line.n ?? ''}</span>
        <span className="ln">{line.m ?? ''}</span>
        <span className="sigil">{line.kind === '+' ? '+' : line.kind === '-' ? '−' : ''}</span>
        <span className="code">{line.code}</span>
        {line.m != null && (
          <button className="ln-comment" title="Comment on this line" onClick={() => onToggleComment(line.m)}>
            <Icon.Plus />
          </button>
        )}
      </div>
      {hasComment && isOpen && (
        <Thread
          comments={comments}
          onAddReply={(text) => onAddComment(line.m, text, true)}
          onClose={() => onToggleComment(null)}
        />
      )}
    </>
  );
}

function Hunk({
  hunk,
  openLine,
  setOpenLine,
  addComment,
  reshown,
  framing,
  highlight,
  onJumpToOwner,
  clusterBots,
  justUpdated,
}) {
  const Icon = window.Icons;
  const AUTHORS = window.AUTHORS || {};
  const isBot = (c) => AUTHORS[c.author]?.kind === 'bot';
  const [botsExpanded, setBotsExpanded] = React.useState(false);

  const allComments = hunk.comments || [];
  const botComments = clusterBots ? allComments.filter(isBot) : [];
  const visibleComments = clusterBots ? allComments.filter((c) => !isBot(c)) : allComments;

  const grouped = React.useMemo(() => {
    const map = {};
    visibleComments.forEach((c) => {
      const k = c.line;
      if (!map[k]) map[k] = [];
      map[k].push(c);
    });
    return map;
  }, [visibleComments]);

  const inHighlight = (m) => {
    if (!highlight || m == null) return true;
    return m >= highlight.from && m <= highlight.to;
  };
  return (
    <div className={`hunk ${reshown ? 'reshown' : ''} ${justUpdated ? 'just-updated' : ''}`}>
      {reshown && (
        <div className="reshow-frame">
          <div className="reshow-pill">
            <Icon.Refresh />
            <span>Showing again from chapter {reshown.idx + 1}</span>
            <span className="dot">·</span>
            <button className="lk" onClick={() => onJumpToOwner && onJumpToOwner(reshown.id)}>
              {reshown.title} <Icon.ArrowRight />
            </button>
          </div>
          {framing && <div className="reshow-framing" dangerouslySetInnerHTML={{ __html: framing }} />}
        </div>
      )}
      <div className="hunk-head">
        <Icon.Files />
        <span className="file">{hunk.file}</span>
        <span className="range">{hunk.range}</span>
        {hunk.isNewFile && <span className="new">new file</span>}
        {highlight && (
          <span className="hl-pill">
            focus L{highlight.from}–L{highlight.to}
          </span>
        )}
        <span className="right">
          <button className="ic" title="Open in editor">
            <Icon.ArrowRight />
          </button>
          <button className="ic" title="View on GitHub">
            <Icon.Github />
          </button>
        </span>
      </div>

      {clusterBots && botComments.length > 0 && (
        <div className={`bot-cluster ${botsExpanded ? 'open' : ''}`}>
          <button className="bot-cluster-head" onClick={() => setBotsExpanded((v) => !v)}>
            <span className="bot-stack">
              {[...new Set(botComments.map((c) => c.author))].slice(0, 3).map((a, i) => (
                <span key={a} className="av sm" style={{ background: AUTHORS[a]?.color || '#888', zIndex: 3 - i }}>
                  {AUTHORS[a]?.initials || '??'}
                </span>
              ))}
            </span>
            <span className="bot-summary">
              <b>
                {botComments.length} bot {botComments.length === 1 ? 'suggestion' : 'suggestions'}
              </b>
              <span className="from">
                from {[...new Set(botComments.map((c) => AUTHORS[c.author]?.short || c.author))].join(', ')}
              </span>
            </span>
            <span className="bot-cluster-toggle">
              {botsExpanded ? 'Collapse' : 'Expand'}
              <Icon.ChevronRight style={{ transform: botsExpanded ? 'rotate(90deg)' : 'none' }} />
            </span>
          </button>
          {botsExpanded && (
            <div className="bot-cluster-body">
              {botComments.map((c) => (
                <div key={c.id} className="bot-cluster-item">
                  <div className="lref">L{c.line}</div>
                  <Comment c={c} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="codelines">
        {hunk.lines.map((ln, i) => {
          const commentsForLine = ln.m != null ? grouped[ln.m] || [] : [];
          const hasComment = commentsForLine.length > 0;
          const isOpen = openLine === `${hunk.file}:${ln.m}`;
          const dim = highlight && !inHighlight(ln.m);
          return (
            <CodeLine
              key={i}
              line={ln}
              comments={commentsForLine}
              hasComment={hasComment || isOpen}
              isOpen={isOpen || hasComment}
              dim={dim}
              onAddComment={(lineN, text, isReply) => addComment(hunk, lineN, text, isReply)}
              onToggleComment={(lineN) => setOpenLine(lineN == null ? null : `${hunk.file}:${lineN}`)}
            />
          );
        })}
      </div>
    </div>
  );
}

window.DiffComponents = { Comment, Thread, CodeLine, Hunk, CommentSourceBadge };
