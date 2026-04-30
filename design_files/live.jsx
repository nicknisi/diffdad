/* live.jsx — synthetic event stream + UI primitives for the "live" CLI feel.
 *
 * In production, the local `bunx diffappointment` CLI exposes:
 *   - SSE/WebSocket stream of GitHub webhook events (issue_comment.created,
 *     pull_request_review_comment.created, push, check_suite.completed, …)
 *   - HTTP API for the UI to post new comments back, which the CLI then
 *     turns into authenticated GitHub API calls.
 *
 * Here we simulate that with a timer that emits scripted events.  The
 * useLiveStream hook returns a fully derived `livePR` so the rest of the
 * UI doesn't care whether data comes from disk or wire.
 */

const SCRIPTED_EVENTS = [
  {
    afterMs: 4000,
    kind: "bot_comment",
    chapterId: "ch3",
    hunkId: "h-discovery-cache",
    comment: {
      id: "live-bot-1",
      author: "coderabbit[bot]",
      line: 11,
      body: "**Stale-while-revalidate looks correct**, but consider returning a `{ doc, stale: true }` shape so callers can log when they're serving stale data — useful for the new telemetry in chapter 5.",
      createdAt: "just now",
      syncStatus: "synced",
      source: "github",
      replies: [],
    },
    summary: "CodeRabbit commented on packages/sso/src/oidc/discovery-cache.ts",
  },
  {
    afterMs: 9000,
    kind: "ci",
    summary: "CI: lint + typecheck passing (12/12)",
    detail: { passing: 12, failing: 0, pending: 0 },
  },
  {
    afterMs: 14000,
    kind: "human_comment",
    chapterId: "ch4",
    hunkId: "h-setup-form",
    comment: {
      id: "live-human-1",
      author: "achen",
      line: 134,
      body: "Quick one — when discovery fails should we fall back to the manual fields automatically, or surface the error and let the customer decide? I lean toward the latter.",
      createdAt: "just now",
      syncStatus: "synced",
      source: "github",
      replies: [],
    },
    summary: "Adaeze commented on packages/admin-portal/src/sso/SetupFormOIDC.tsx",
  },
  {
    afterMs: 19000,
    kind: "commit",
    sha: "8a3d91c",
    message: "Bump discovery timeout to 10s; add jitter retry",
    author: "fbarber",
    summary: "Frances pushed 1 new commit",
  },
  {
    afterMs: 24000,
    kind: "bot_comment",
    chapterId: "ch3",
    hunkId: "h-discovery-cache",
    comment: {
      id: "live-bot-2",
      author: "greptile[bot]",
      line: 24,
      body: "The stale-while-revalidate fallback swallows the underlying error. Recommend logging it (with `discovery.cache.miss_serving_stale` metric) so we don't get a silent issuer outage.",
      createdAt: "just now",
      syncStatus: "synced",
      source: "github",
      replies: [],
    },
    summary: "Greptile commented on packages/sso/src/oidc/discovery-cache.ts",
  },
  {
    afterMs: 30000,
    kind: "title_edit",
    title: "feat(sso): OIDC issuer discovery for Microsoft Entra (with cache)",
    summary: "Frances renamed this PR",
  },
];

function useLiveStream(initialPR, { enabled = true, speed = 1 } = {}) {
  const [pr, setPr] = React.useState(initialPR);
  const [log, setLog] = React.useState([
    { id: "boot-1", at: Date.now() - 8000, kind: "system", summary: "Connected to bunx diffappointment on :4317" },
    { id: "boot-2", at: Date.now() - 7000, kind: "system", summary: "Subscribed to webhooks for workos/workos#1847" },
    { id: "boot-3", at: Date.now() - 6500, kind: "system", summary: "Hydrated 5 chapters · 9 comments · 11 checks" },
  ]);
  const [highlightedComment, setHighlightedComment] = React.useState(null);
  const [updatedHunks, setUpdatedHunks] = React.useState({}); // hunkId -> ts
  const [status, setStatus] = React.useState("connected"); // connected | reconnecting | offline
  const [lastEventAt, setLastEventAt] = React.useState(Date.now() - 6500);

  const applyEvent = React.useCallback((ev) => {
    const at = Date.now();
    setLastEventAt(at);
    setLog(l => [...l, { id: ev.comment?.id || `ev-${at}`, at, ...ev }]);

    if (ev.kind === "bot_comment" || ev.kind === "human_comment") {
      const { chapterId, hunkId, comment } = ev;
      setPr(p => ({
        ...p,
        chapters: p.chapters.map(ch => ch.id !== chapterId ? ch : ({
          ...ch,
          hunks: ch.hunks.map(h => h.id !== hunkId ? h : ({
            ...h,
            comments: [...(h.comments || []), comment],
          })),
        })),
      }));
      setHighlightedComment({ id: comment.id, at });
      setUpdatedHunks(u => ({ ...u, [hunkId]: at }));
      setTimeout(() => setHighlightedComment(prev => prev?.id === comment.id ? null : prev), 6000);
      setTimeout(() => setUpdatedHunks(u => {
        const { [hunkId]: _drop, ...rest } = u; return rest;
      }), 6000);
    } else if (ev.kind === "ci") {
      setPr(p => ({ ...p, checks: { ...p.checks, ...ev.detail } }));
    } else if (ev.kind === "commit") {
      setPr(p => ({
        ...p,
        stats: { ...p.stats, commits: (p.stats.commits || 0) + 1 },
        updatedAt: "just now",
      }));
    } else if (ev.kind === "title_edit") {
      setPr(p => ({ ...p, title: ev.title, updatedAt: "just now" }));
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    const timers = SCRIPTED_EVENTS.map(ev =>
      setTimeout(() => applyEvent(ev), ev.afterMs / speed)
    );
    return () => timers.forEach(clearTimeout);
  }, [enabled, applyEvent, speed]);

  // expose a manual fire for the activity drawer "replay" button
  const replayLastN = (n = 3) => {
    const recent = SCRIPTED_EVENTS.slice(-n);
    recent.forEach((ev, i) => setTimeout(() => applyEvent({ ...ev, comment: ev.comment ? { ...ev.comment, id: `${ev.comment.id}-r${Date.now()}` } : undefined }), i * 800));
  };

  return { livePR: pr, status, log, lastEventAt, highlightedComment, updatedHunks, replayLastN, setStatus };
}

function relTime(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function LivePill({ status, lastEventAt, eventCount, onOpenLog }) {
  const Icon = window.Icons;
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const t = setInterval(force, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <button className={`live-pill ${status}`} onClick={onOpenLog} title="Open activity log">
      <span className="dot" />
      <span className="label">
        {status === "connected" ? "Live" : status === "reconnecting" ? "Reconnecting…" : "Offline"}
      </span>
      <span className="meta">
        :4317 · {eventCount} events · last {relTime(lastEventAt)}
      </span>
    </button>
  );
}

function CliFraming({ pr }) {
  const Icon = window.Icons;
  return (
    <div className="cli-framing">
      <span className="cli-prompt">$</span>
      <code className="cli-cmd">bunx diffappointment {pr.number}</code>
      <span className="cli-arrow"><Icon.ArrowRight /></span>
      <span className="cli-target"><b>{pr.repo || "workos/workos"}</b>#{pr.number}</span>
      <span className="cli-pid">pid 41278</span>
    </div>
  );
}

function ActivityDrawer({ open, onClose, log, status, replayLastN }) {
  const Icon = window.Icons;
  if (!open) return null;
  const ICONS = {
    bot_comment: <Icon.Spark />,
    human_comment: <Icon.Chat />,
    ci: <Icon.Check />,
    commit: <Icon.Github />,
    title_edit: <Icon.Files />,
    system: <Icon.Refresh />,
  };
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="activity-drawer">
        <div className="ad-head">
          <div>
            <div className="ad-title">Activity</div>
            <div className="ad-sub">webhooks streaming from <code>bunx diffappointment</code></div>
          </div>
          <button className="ic-btn" onClick={onClose} title="Close"><Icon.X /></button>
        </div>
        <div className="ad-status">
          <span className={`live-dot ${status}`} />
          <span><b>{status === "connected" ? "Connected" : status}</b> · port 4317</span>
          <button className="lk" onClick={() => replayLastN(3)}>replay last 3</button>
        </div>
        <div className="ad-log">
          {[...log].reverse().map(e => (
            <div key={e.id + e.at} className={`ad-row k-${e.kind}`}>
              <span className="ad-icon">{ICONS[e.kind] || <Icon.Dot />}</span>
              <div className="ad-body">
                <div className="ad-summary">{e.summary || e.kind}</div>
                <div className="ad-when">{relTime(e.at)}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

Object.assign(window, { useLiveStream, LivePill, CliFraming, ActivityDrawer });
