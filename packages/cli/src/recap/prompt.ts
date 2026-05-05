import type { CheckRun } from '../github/types';
import type { RecapSources, ReviewThread } from './sources';

const RESPONSE_SCHEMA = `{
  "goal": "string — 1 sentence: what is this PR/branch trying to do",
  "stateOfPlay": {
    "done": ["string — bullet of work that looks complete"],
    "wip": ["string — bullet of work in progress"],
    "notStarted": ["string — bullet of work the PR description implies but the diff doesn't yet contain"]
  },
  "decisions": [
    {
      "decision": "string — short imperative summary, e.g. 'Switched from REST to GraphQL'",
      "reason": "string — 1 sentence on why",
      "source": {
        "type": "commit | thread | pr-body | force-push | issue",
        "ref": "string — sha7, comment id, '#issueN', or 'force-push@createdAt'"
      },
      "alternativesRuledOut": ["string?"]
    }
  ],
  "blockers": [
    {
      "issue": "string — short statement of what's blocked",
      "evidence": "string — concrete pointer (failing check name, comment author, file:line)",
      "type": "ci | review-question | thrash | todo"
    }
  ],
  "mentalModel": {
    "coreFiles": ["string — new files that constitute the feature"],
    "touchpoints": ["string — existing files modified to integrate the feature"],
    "sketch": "string — multi-line ASCII box-and-arrow sketch of the feature, NOT the whole repo. Use plain text only."
  },
  "howToHelp": [
    {
      "suggestion": "string — concrete, actionable suggestion for a teammate landing on this work",
      "why": "string — 1 sentence on why this would unblock or de-risk"
    }
  ]
}`;

const SYSTEM_PROMPT = `You are Diff Dad in recap mode. Your reader is a teammate landing on someone else's in-flight feature work. They are familiar with the codebase but not with this slice of work.

Your job is to hand them the mental model their teammate has been building, so they can help unblock — not to review for bugs.

## Operating principles

1. **Orient, don't audit.** Describe state, decisions, and blockers. Do NOT generate review concerns or risk callouts. That is what \`review\` is for.
2. **Anchor every decision to a source.** Every decision MUST cite a commit sha (first 7 chars), a thread root comment id, the PR body, a force-push timestamp, or a linked issue. If you can't anchor it, drop it.
3. **The decision log is the killer feature.** Mine commit messages (especially \`revert\`/\`actually\`/\`switch\`/\`instead\`/\`fix X\` patterns), force-push redirections, resolved-looking review threads, and linked issue discussion. Surface what the author tried and ruled out, not just what they ended up with.
4. **Blockers must have evidence.** A failing CI check → name it. An unanswered review question → cite the author and path:line. Recent thrash (many small \`fix\`/\`try\`/\`wip\` commits in a row) → list the commit shas.
5. **Mental-model sketch is three boxes and an arrow, not the whole repo.** New files on one side, the existing-code touchpoints on the other, with the call/data direction labeled. Plain ASCII.
6. **How-to-help is concrete.** "Pair on the cache invalidation in src/cache.ts:42" beats "help with the cache." If you can't be specific, omit the suggestion.
7. **Be brief.** Each bullet is one short sentence. Skip empty arrays — return \`[]\` rather than padding.

## Detecting redirections vs rebases in force pushes

A force push is a *redirection* (worth surfacing as a decision) if commits change semantically — the author rewrote their approach. A force push that just rebases onto a newer base preserves message-equivalence and should be ignored. Lean toward surfacing only when a redirection looks meaningful.

## Detecting thrash

Multiple small commits in quick succession with messages like \`fix\`, \`try\`, \`maybe\`, \`actually\`, \`revert\`, \`wip\` — especially when they touch the same file — is thrash. Surface as a blocker of type \`thrash\` with the affected file and the commit shas as evidence.

## Output

Return ONLY valid JSON, no prose around it, matching this schema:
${RESPONSE_SCHEMA}`;

function fmtCommit(c: { sha: string; message: string; author: string; authoredAt: string }): string {
  const subject = c.message.split('\n')[0]!.slice(0, 200);
  const sha7 = c.sha.slice(0, 7);
  return `[${sha7}] ${c.author}  ${c.authoredAt}\n  ${subject}`;
}

function fmtThread(t: ReviewThread): string {
  const head = `--- thread root=${t.rootId} ${t.path}${t.line !== undefined ? `:${t.line}` : ''} ---`;
  const body = t.comments
    .map((c) => `  @${c.author} (${c.createdAt}): ${c.body.replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n');
  return `${head}\n${body}`;
}

function fmtChecks(checks: CheckRun[]): string {
  if (checks.length === 0) return '(no checks reported)';
  const lines: string[] = [];
  for (const c of checks) {
    let label: string;
    if (c.status !== 'completed') {
      label = c.status;
    } else {
      label = c.conclusion ?? 'unknown';
    }
    const failOutput =
      label === 'failure' || label === 'timed_out' || label === 'action_required' || label === 'cancelled'
        ? `  ${c.output?.title ?? ''}${c.output?.summary ? ` — ${c.output.summary.slice(0, 200)}` : ''}`
        : '';
    lines.push(`- ${c.name}: ${label}${failOutput ? `\n${failOutput}` : ''}`);
  }
  return lines.join('\n');
}

const COMMITS_BUDGET = 80;
const THREADS_BUDGET = 30;
const ISSUE_BODY_MAX = 2000;
const PR_BODY_MAX = 4000;

export type RecapPrompt = {
  system: string;
  user: string;
};

export function buildRecapPrompt(sources: RecapSources): RecapPrompt {
  const { pr, files, commits, threads, reviews, checkRuns, forcePushes, linkedIssues } = sources;

  const parts: string[] = [];
  parts.push(`PR: ${pr.title}  (#${pr.number}, branch ${pr.branch} → ${pr.base})`);
  parts.push(`Author: @${pr.author.login}  state: ${pr.state}${pr.draft ? ' (draft)' : ''}`);
  parts.push(`Created: ${pr.createdAt}  updated: ${pr.updatedAt}`);
  parts.push('');

  parts.push('PR description:');
  const body = pr.body.trim();
  parts.push(body.length > 0 ? body.slice(0, PR_BODY_MAX) : '(no description)');
  parts.push('');

  if (linkedIssues.length > 0) {
    parts.push('Linked issues:');
    for (const issue of linkedIssues) {
      parts.push(`- #${issue.number} ${issue.title} (${issue.state})`);
      if (issue.body.trim().length > 0) {
        parts.push(`  body: ${issue.body.replace(/\s+/g, ' ').slice(0, ISSUE_BODY_MAX)}`);
      }
    }
    parts.push('');
  }

  parts.push(`Commits (${commits.length}, oldest first, capped to ${COMMITS_BUDGET}):`);
  const commitSubset = commits.slice(0, COMMITS_BUDGET);
  if (commitSubset.length === 0) {
    parts.push('(no commits)');
  } else {
    for (const c of commitSubset) parts.push(fmtCommit(c));
  }
  if (commits.length > COMMITS_BUDGET) {
    parts.push(`... ${commits.length - COMMITS_BUDGET} earlier commits omitted`);
  }
  parts.push('');

  parts.push(`Force-pushes (${forcePushes.length}):`);
  if (forcePushes.length === 0) {
    parts.push('(none)');
  } else {
    for (const fp of forcePushes) {
      const before = fp.beforeSha ? fp.beforeSha.slice(0, 7) : '(initial)';
      const after = fp.afterSha ? fp.afterSha.slice(0, 7) : '(unknown)';
      parts.push(`- ${fp.createdAt}  @${fp.actor || 'unknown'}  ${before} -> ${after}`);
    }
  }
  parts.push('');

  parts.push(`Review threads (${threads.length}, capped to ${THREADS_BUDGET}):`);
  const threadSubset = threads.slice(0, THREADS_BUDGET);
  if (threadSubset.length === 0) {
    parts.push('(no inline threads)');
  } else {
    for (const t of threadSubset) parts.push(fmtThread(t));
  }
  parts.push('');

  if (reviews.length > 0) {
    parts.push('Reviews (latest per user):');
    for (const r of reviews) {
      parts.push(`- @${r.user}: ${r.state}  at ${r.submittedAt}`);
    }
    parts.push('');
  }

  parts.push('CI checks (HEAD):');
  parts.push(fmtChecks(checkRuns));
  parts.push('');

  parts.push('Files changed (path, +adds, -dels):');
  if (files.length === 0) {
    parts.push('(none parsed)');
  } else {
    for (const f of files) {
      let adds = 0;
      let dels = 0;
      for (const h of f.hunks) {
        for (const l of h.lines) {
          if (l.type === 'add') adds++;
          else if (l.type === 'remove') dels++;
        }
      }
      const tag = f.isNewFile ? ' [new]' : f.isDeleted ? ' [deleted]' : '';
      parts.push(`- ${f.file}${tag}  +${adds} -${dels}`);
    }
  }

  return { system: SYSTEM_PROMPT, user: parts.join('\n') };
}
