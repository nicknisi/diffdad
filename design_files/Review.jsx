/* Review screen — the heart of the app */

// oxlint-disable-next-line no-unused-vars
const PR = window.PR;
const Narrations = window.Narrations;

// "Re-narrate" simulates AI re-writing the narration through a different lens.
// For the prototype we splice in a lens-specific framing sentence + flag a few terms.
function renarrateNarration(html, lens) {
  if (!html || !lens) return html;
  const framings = {
    security: `<em>Through a security lens:</em> the part that matters here is what trust boundaries the change crosses and which inputs are now reaching auth-flow code. `,
    performance: `<em>Through a performance lens:</em> the part that matters here is request count, blocking time, and what hits the cache vs the wire. `,
    'API consumer': `<em>If you're calling this from outside:</em> the part that matters here is whether <code>ConnectionConfig</code> shape changes, what new errors you can now see, and whether old call sites keep working. `,
  };
  const prefix = framings[lens] || '';
  return `<span class="lens-tag">${lens}</span> ` + prefix + html;
}

function SuggestedStart({ onJump }) {
  const Icon = window.Icons;
  return (
    <div className="suggest">
      <div className="ai-mark">
        <Icon.Spark />
      </div>
      <div className="body">
        <b>Suggested place to start:</b> Chapter 4 — <em>Wire discovery into the connection setup flow</em>. It's the
        user-visible change and has the highest blast radius. Yusuf already flagged a debounce concern there.
        <div className="actions">
          <button className="btn sm" onClick={() => onJump('ch4')}>
            Jump to chapter 4
          </button>
          <button className="btn sm">Start from chapter 1</button>
        </div>
      </div>
    </div>
  );
}

function ChapterTOC({ chapters, activeId, onPick, reviewedMap }) {
  return (
    <aside className="toc">
      <div className="toc-label">Story</div>
      {chapters.map((ch, i) => (
        <div
          key={ch.id}
          className={`toc-item ${activeId === ch.id ? 'active' : ''} ${reviewedMap[ch.id] ? 'done' : ''}`}
          onClick={() => onPick(ch.id)}
        >
          <span className="num">{reviewedMap[ch.id] ? '✓' : i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="body">{ch.title}</div>
            <div className="meta">
              {ch.hunks.length} {ch.hunks.length === 1 ? 'hunk' : 'hunks'} · risk {ch.risk}
              {ch.hunks.some((h) => (h.comments || []).length > 0) && ' · has comments'}
            </div>
          </div>
        </div>
      ))}
    </aside>
  );
}

function NarrationAnchor({ density, setDensity, onAsk, onCommentChapter, onRenarrate, renarrating }) {
  const Icon = window.Icons;
  return (
    <div className="narration-anchor">
      <div className="density">
        {[
          ['terse', 'Terse'],
          ['normal', 'Normal'],
          ['verbose', 'Verbose'],
        ].map(([k, lab]) => (
          <button key={k} className={density === k ? 'active' : ''} onClick={() => setDensity(k)}>
            {lab}
          </button>
        ))}
      </div>
      <button onClick={onRenarrate} disabled={renarrating}>
        <Icon.Refresh />
        {renarrating ? 'Re-narrating…' : 'Re-narrate'}
      </button>
      <button onClick={onAsk}>
        <Icon.Spark />
        Ask AI
      </button>
      <button onClick={onCommentChapter}>
        <Icon.Chat />
        Comment on chapter
      </button>
    </div>
  );
}

function ChapterCommentBlock({ thread }) {
  if (!thread || thread.length === 0) return null;
  return (
    <div className="chap-thread">
      <div className="label">Chapter discussion</div>
      {thread.map((c) => (
        <window.DiffComponents.Comment key={c.id} c={c} />
      ))}
    </div>
  );
}

function AiAsk({ open, onClose, hunkLabel }) {
  const Icon = window.Icons;
  const [q, setQ] = React.useState('');
  const [a, setA] = React.useState(null);
  if (!open) return null;
  function ask() {
    if (!q.trim()) return;
    setA('Loading…');
    setTimeout(() => {
      setA(
        `The 5-second timeout was chosen to match the existing <code>fetch()</code> wrapper's default. Microsoft Entra cold starts are typically 800ms-1.5s in the EU/US regions; 5s gives a comfortable margin. Adaeze's comment about cold starts is referencing the <em>tenant-suspended</em> path which can stall longer — that's worth handling separately rather than relaxing the global timeout.`,
      );
    }, 600);
  }
  return (
    <div className="ai-ask">
      <div className="lab">
        <Icon.Spark />
        Ask AI about {hunkLabel || 'this chapter'}
      </div>
      <div className="input">
        <textarea
          placeholder="e.g. Why this timeout? What does this Zod schema cover?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
          }}
        />
        <button className="btn primary" onClick={ask}>
          Ask
        </button>
        <button className="btn ghost" onClick={onClose}>
          <Icon.X />
        </button>
      </div>
      {a && <div className="answer" dangerouslySetInnerHTML={{ __html: a }} />}
    </div>
  );
}

function Chapter({
  ch,
  idx,
  density,
  setDensity,
  openLine,
  setOpenLine,
  addComment,
  reviewed,
  toggleReviewed,
  onJump,
  clusterBots,
  updatedHunks,
  structure = 'chapters',
}) {
  const Icon = window.Icons;
  const [askOpen, setAskOpen] = React.useState(false);
  const [chapComment, setChapComment] = React.useState(false);
  const [renarrating, setRenarrating] = React.useState(false);
  const [renarrationLens, setRenarrationLens] = React.useState(null); // null | string lens
  const [collapsed, setCollapsed] = React.useState(structure === 'outline' && idx > 0);
  React.useEffect(() => {
    setCollapsed(structure === 'outline' && idx > 0 && !reviewed);
  }, [structure]);
  const [chapThread, _setChapThread] = React.useState(
    ch.id === 'ch3'
      ? [
          {
            id: `chcom-${ch.id}`,
            author: 'achen',
            body: 'I like that this chapter stands on its own — the cache layer being separate from the fetcher makes the SWR test trivial. Approving this chapter independently.',
            createdAt: '20 minutes ago',
            syncStatus: 'synced',
            source: 'github',
            replies: [],
          },
        ]
      : [],
  );

  // Linear mode: drop the chapter card chrome; render as a flowing section.
  if (structure === 'linear') {
    return (
      <section className={`chapter linear ${reviewed ? 'done' : ''}`} data-chid={ch.id}>
        <div className="linear-head">
          <span className="rule" />
          <h2>
            <span className="ch-num">Ch {idx + 1}</span>
            {ch.title}
            <span className={`risk ${ch.risk}`}>{ch.risk}</span>
          </h2>
          <span className="rule" />
        </div>
        <p className="narration" dangerouslySetInnerHTML={{ __html: Narrations[ch.id][density] }} />
        <ChapterCommentBlock thread={chapThread} />
        {ch.hunks.map((h, i) => (
          <window.DiffComponents.Hunk
            key={i}
            hunk={h}
            openLine={openLine}
            setOpenLine={setOpenLine}
            addComment={addComment}
            clusterBots={clusterBots}
            justUpdated={!!updatedHunks?.[h.id]}
          />
        ))}
      </section>
    );
  }

  return (
    <section className={`chapter ${reviewed ? 'done' : ''} ${collapsed ? 'collapsed' : ''}`} data-chid={ch.id}>
      <div
        className="chapter-head"
        onClick={structure === 'outline' ? () => setCollapsed((v) => !v) : undefined}
        style={structure === 'outline' ? { cursor: 'pointer' } : undefined}
      >
        <span className="badge-num">{idx + 1}</span>
        <div className="titles">
          <h2>
            {ch.title}
            <span className={`risk ${ch.risk}`}>{ch.risk} risk</span>
          </h2>
          {structure === 'outline' && (
            <div className="outline-meta">
              {ch.hunks.length} {ch.hunks.length === 1 ? 'hunk' : 'hunks'} ·{' '}
              {ch.hunks.reduce((n, h) => n + (h.comments || []).length, 0)} comments
            </div>
          )}
        </div>
        {structure === 'outline' && (
          <button className="outline-toggle" aria-label={collapsed ? 'Open chapter' : 'Collapse chapter'}>
            <Icon.ChevronDown
              style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 120ms ease' }}
            />
          </button>
        )}
        <button
          className={`reviewed-toggle ${reviewed ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleReviewed();
          }}
        >
          {reviewed ? (
            <>
              <Icon.Check />
              Reviewed
            </>
          ) : (
            <>Mark reviewed</>
          )}
        </button>
      </div>

      {!collapsed && (
        <>
          {renarrationLens && (
            <div className="renarrate-banner">
              <Icon.Spark />
              <span>
                Re-narrated for <b>{renarrationLens}</b> reviewers.
              </span>
              <button onClick={() => setRenarrationLens(null)}>Restore default</button>
            </div>
          )}
          <p
            className="narration"
            dangerouslySetInnerHTML={{
              __html: renarrationLens
                ? renarrateNarration(Narrations[ch.id][density], renarrationLens)
                : Narrations[ch.id][density],
            }}
          />
          <NarrationAnchor
            density={density}
            setDensity={setDensity}
            onAsk={() => setAskOpen((v) => !v)}
            onCommentChapter={() => setChapComment((v) => !v)}
            onRenarrate={() => {
              setRenarrating(true);
              setTimeout(() => {
                setRenarrating(false);
                const lenses = ['security', 'performance', 'API consumer'];
                const next = lenses[(lenses.indexOf(renarrationLens) + 1) % lenses.length];
                setRenarrationLens(next);
              }, 700);
            }}
            renarrating={renarrating}
          />

          <AiAsk open={askOpen} onClose={() => setAskOpen(false)} hunkLabel={`chapter ${idx + 1}`} />

          <ChapterCommentBlock thread={chapThread} />
          {chapComment && (
            <div className="chap-thread">
              <div className="label">Comment on this chapter</div>
              <div className="thread" style={{ background: 'transparent', boxShadow: 'none', padding: 0 }}>
                <div className="reply-area">
                  <textarea placeholder="Comment on the whole chapter — syncs to the PR description thread on GitHub" />
                  <div className="btnrow">
                    <button className="btn ghost sm" onClick={() => setChapComment(false)}>
                      Cancel
                    </button>
                    <button className="btn primary sm">
                      <Icon.Send />
                      Comment
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(ch.reshow || []).map((rs, i) => {
            const h = window.hunkById[rs.ref];
            if (!h) return null;
            const owner = window.ownerChapterById[rs.ref];
            return (
              <window.DiffComponents.Hunk
                key={`rs-${i}`}
                hunk={h}
                openLine={openLine}
                setOpenLine={setOpenLine}
                addComment={addComment}
                reshown={owner}
                framing={rs.framing}
                highlight={rs.highlight}
                onJumpToOwner={onJump}
                clusterBots={clusterBots}
                justUpdated={!!updatedHunks?.[h.id]}
              />
            );
          })}

          {ch.hunks.map((h, i) => (
            <window.DiffComponents.Hunk
              key={i}
              hunk={h}
              openLine={openLine}
              setOpenLine={setOpenLine}
              addComment={addComment}
              clusterBots={clusterBots}
              justUpdated={!!updatedHunks?.[h.id]}
            />
          ))}
        </>
      )}
    </section>
  );
}

function ClassicView({ chapters }) {
  const Icon = window.Icons;
  const allHunks = chapters.flatMap((c) => c.hunks);
  // Group by file
  const byFile = {};
  allHunks.forEach((h) => {
    if (!byFile[h.file]) byFile[h.file] = [];
    byFile[h.file].push(h);
  });
  return (
    <div className="classic">
      {Object.entries(byFile).map(([file, hunks]) => {
        const adds = hunks.flatMap((h) => h.lines).filter((l) => l.kind === '+').length;
        const rems = hunks.flatMap((h) => h.lines).filter((l) => l.kind === '-').length;
        return (
          <div key={file} className="filecard">
            <div className="head">
              <Icon.Files />
              <span className="file">{file}</span>
              {hunks.some((h) => h.isNewFile) && <span className="new">new file</span>}
              <span className="stat-add">+{adds}</span>
              <span className="stat-rem">−{rems}</span>
              <span className="right">
                <button className="btn surface sm">
                  <Icon.Github />
                  View on GitHub
                </button>
              </span>
            </div>
            {hunks.map((h, i) => (
              <div key={i} className="codelines">
                {h.lines.map((ln, j) => (
                  <div key={j} className={`line ${ln.kind === '+' ? 'add' : ln.kind === '-' ? 'rem' : ''}`}>
                    <span className="ln">{ln.n ?? ''}</span>
                    <span className="ln">{ln.m ?? ''}</span>
                    <span className="sigil">{ln.kind === '+' ? '+' : ln.kind === '-' ? '−' : ''}</span>
                    <span className="code">{ln.code}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SubmitDialog({ open, onClose, onSubmit }) {
  const [verdict, setVerdict] = React.useState('comment');
  const [body, setBody] = React.useState('');
  if (!open) return null;
  return (
    <div className="dlg-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg">
        <h3>Submit your review</h3>
        <p className="sub">3 inline comments will be posted to GitHub along with this summary.</p>
        <div className="opts">
          {[
            ['comment', 'Comment', 'General feedback without explicit approval.'],
            ['approve', 'Approve', 'Mark as ready to merge once any feedback is addressed.'],
            ['request', 'Request changes', 'Block merge until your concerns are resolved.'],
          ].map(([k, lab, desc]) => (
            <label key={k} className={`opt ${verdict === k ? 'active' : ''}`}>
              <input type="radio" name="verdict" checked={verdict === k} onChange={() => setVerdict(k)} />
              <div>
                <div className="lab">{lab}</div>
                <div className="desc">{desc}</div>
              </div>
            </label>
          ))}
        </div>
        <textarea
          placeholder="Leave a summary comment (optional)…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="footer">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${verdict === 'request' ? 'danger' : 'primary'}`}
            onClick={() => onSubmit(verdict, body)}
          >
            {verdict === 'approve' && 'Approve'}
            {verdict === 'comment' && 'Submit comment'}
            {verdict === 'request' && 'Request changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Review({ tweaks, pr, clusterBots, updatedHunks }) {
  const Icon = window.Icons;
  const PR = pr || window.PR;
  const [view, setView] = React.useState('story'); // story | classic
  const [density, setDensity] = React.useState(tweaks.storyDensity);
  React.useEffect(() => setDensity(tweaks.storyDensity), [tweaks.storyDensity]);

  const [activeId, setActiveId] = React.useState(PR.chapters[0].id);
  const [openLine, setOpenLine] = React.useState(null);
  const [reviewedMap, setReviewedMap] = React.useState({ ch1: true });
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [pendingDrafts, setPendingDrafts] = React.useState(2);
  const [submittedToast, setSubmittedToast] = React.useState(null);

  const toggleReviewed = (id) => setReviewedMap((m) => ({ ...m, [id]: !m[id] }));

  const addComment = (_hunk, _lineN, _text, _isReply) => {
    // For prototype: just bump pending drafts counter
    setPendingDrafts((n) => n + 1);
  };

  const reviewedCount = PR.chapters.filter((c) => reviewedMap[c.id]).length;
  const totalCount = PR.chapters.length;
  const pct = Math.round((reviewedCount / totalCount) * 100);

  const jumpTo = (id) => {
    setActiveId(id);
    const el = document.querySelector(`[data-chid='${id}']`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Track active chapter on scroll
  React.useEffect(() => {
    const onScroll = () => {
      const els = PR.chapters
        .map((c) => ({ id: c.id, el: document.querySelector(`[data-chid='${c.id}']`) }))
        .filter((x) => x.el);
      const top = window.scrollY + 120;
      for (let i = els.length - 1; i >= 0; i--) {
        if (els[i].el.offsetTop <= top) {
          setActiveId(els[i].id);
          return;
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const reviewClasses = [
    'review',
    `vis-${tweaks.visualStyle || 'stripe'}`,
    `struct-${tweaks.storyStructure || 'chapters'}`,
    tweaks.codeRatio === 'code' ? 'code-heavy' : tweaks.codeRatio === 'prose' ? 'prose-heavy' : '',
    tweaks.density === 'compact' ? 'dense' : '',
    tweaks.collapseNarration ? 'collapsed-narration' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={reviewClasses}>
      <div className="prhead">
        <div className="row1">
          <h1>
            <span className="num">#{PR.number}</span>
            {PR.title}
          </h1>
          <div className="actions">
            <div className="viewtoggle">
              <button className={view === 'story' ? 'active' : ''} onClick={() => setView('story')}>
                <Icon.Story />
                Story
              </button>
              <button className={view === 'classic' ? 'active' : ''} onClick={() => setView('classic')}>
                <Icon.Files />
                Files
              </button>
            </div>
            <button className="btn surface" onClick={() => setSubmitOpen(true)}>
              <Icon.Comment />
              Submit review
            </button>
          </div>
        </div>
        <div className="meta">
          <span className="branch">
            <b>{PR.branch}</b> → {PR.base}
          </span>
          <span>
            <b style={{ color: 'var(--fg-1)', fontWeight: 500 }}>{PR.author.name}</b> opened {PR.createdAt} · updated{' '}
            {PR.updatedAt}
          </span>
          <span>·</span>
          <span>
            <span className="stat-add">+{PR.stats.additions}</span>{' '}
            <span className="stat-rem">−{PR.stats.deletions}</span> across {PR.stats.files} files
          </span>
          <span>·</span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <Icon.Check style={{ color: 'var(--green-11)' }} /> {PR.checks.passing} checks passing
          </span>
        </div>
      </div>

      {view === 'story' ? (
        <div className={`story ${tweaks.layout === 'linear' ? 'no-toc' : ''}`}>
          {tweaks.layout !== 'linear' && (
            <ChapterTOC chapters={PR.chapters} activeId={activeId} onPick={jumpTo} reviewedMap={reviewedMap} />
          )}
          <div>
            <SuggestedStart onJump={jumpTo} />
            {PR.chapters.map((ch, i) => (
              <Chapter
                key={ch.id}
                ch={ch}
                idx={i}
                density={density}
                setDensity={setDensity}
                openLine={openLine}
                setOpenLine={setOpenLine}
                addComment={addComment}
                reviewed={!!reviewedMap[ch.id]}
                toggleReviewed={() => toggleReviewed(ch.id)}
                onJump={jumpTo}
                clusterBots={clusterBots}
                updatedHunks={updatedHunks}
                structure={tweaks.storyStructure || 'chapters'}
              />
            ))}
          </div>
        </div>
      ) : (
        <ClassicView chapters={PR.chapters} />
      )}

      <div className="submitbar">
        <div>
          <div className="progress">
            <b>
              {reviewedCount} of {totalCount}
            </b>{' '}
            chapters reviewed · <b>{pendingDrafts}</b> pending drafts
          </div>
          <div className="pgbar">
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button className="btn primary" onClick={() => setSubmitOpen(true)}>
          Submit review
        </button>
      </div>

      <SubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onSubmit={(verdict, _body) => {
          setSubmitOpen(false);
          setSubmittedToast(verdict);
          setPendingDrafts(0);
          setTimeout(() => setSubmittedToast(null), 3500);
        }}
      />

      {submittedToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 90,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--gray-12)',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 8,
            font: '500 13px var(--font-sans)',
            boxShadow: '0 12px 24px -4px rgba(3,2,13,0.30)',
            zIndex: 30,
          }}
        >
          Review submitted to GitHub ·{' '}
          {submittedToast === 'approve'
            ? 'Approved ✓'
            : submittedToast === 'request'
              ? 'Changes requested'
              : 'Comments posted'}
        </div>
      )}
    </div>
  );
}

window.Review = Review;
