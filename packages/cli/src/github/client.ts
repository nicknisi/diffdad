import { parseDiff } from './diff-parser';
import type { CheckRun, DiffFile, PRComment, PRMetadata, PRReview } from './types';

const GITHUB_API = 'https://api.github.com';

export type PostCommentOptions = {
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  commitId?: string;
  inReplyToId?: number;
};

type GhUser = { login: string; avatar_url: string } | null;

type GhPullResponse = {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  user: GhUser;
  head: { ref: string; sha: string };
  base: { ref: string };
  labels: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
};

type GhReviewComment = {
  id: number;
  user: GhUser;
  body: string;
  created_at: string;
  updated_at: string;
  path: string;
  line: number | null;
  original_line: number | null;
  position: number | null;
  side: 'LEFT' | 'RIGHT' | null;
  start_line: number | null;
  original_start_line: number | null;
  start_side: 'LEFT' | 'RIGHT' | null;
  in_reply_to_id?: number;
  diff_hunk: string;
};

type GhIssueComment = {
  id: number;
  user: GhUser;
  body: string;
  created_at: string;
  updated_at: string;
};

export class GitHubClient {
  constructor(private readonly token: string) {}

  private async fetch(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('Accept', accept);
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', 'diffdad-cli');
    }
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}: ${text}`);
    }
    return res;
  }

  async getPR(owner: string, repo: string, number: number): Promise<PRMetadata> {
    const res = await this.fetch(`/repos/${owner}/${repo}/pulls/${number}`);
    const data = (await res.json()) as GhPullResponse;
    const state: PRMetadata['state'] = data.merged ? 'merged' : data.state === 'closed' ? 'closed' : 'open';
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? '',
      state,
      draft: data.draft,
      author: {
        login: data.user?.login ?? '',
        avatarUrl: data.user?.avatar_url ?? '',
      },
      branch: data.head.ref,
      base: data.base.ref,
      labels: data.labels.map((l) => l.name),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changed_files,
      commits: data.commits,
      headSha: data.head.sha,
    };
  }

  async getDiff(owner: string, repo: string, number: number): Promise<DiffFile[]> {
    const res = await this.fetch(`/repos/${owner}/${repo}/pulls/${number}`, {}, 'application/vnd.github.v3.diff');
    const text = await res.text();
    return parseDiff(text);
  }

  async getComments(owner: string, repo: string, number: number): Promise<PRComment[]> {
    const [reviewRes, issueRes] = await Promise.all([
      this.fetch(`/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`),
      this.fetch(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`),
    ]);

    const reviews = (await reviewRes.json()) as GhReviewComment[];
    const issues = (await issueRes.json()) as GhIssueComment[];

    const reviewComments: PRComment[] = reviews.map((c) => ({
      id: c.id,
      author: c.user?.login ?? '',
      avatarUrl: c.user?.avatar_url ?? undefined,
      body: c.body,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      path: c.path,
      line: c.line ?? c.original_line ?? undefined,
      side: c.side ?? undefined,
      startLine: c.start_line ?? c.original_start_line ?? undefined,
      startSide: c.start_side ?? undefined,
      inReplyToId: c.in_reply_to_id,
      diffHunk: c.diff_hunk,
    }));

    const issueComments: PRComment[] = issues.map((c) => ({
      id: c.id,
      author: c.user?.login ?? '',
      avatarUrl: c.user?.avatar_url ?? undefined,
      body: c.body,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));

    const all = [...reviewComments, ...issueComments];
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all;
  }

  async getCheckRuns(owner: string, repo: string, ref: string): Promise<CheckRun[]> {
    const res = await this.fetch(`/repos/${owner}/${repo}/commits/${ref}/check-runs`);
    const data = (await res.json()) as {
      check_runs: Array<{
        id: number;
        name: string;
        status: 'queued' | 'in_progress' | 'completed';
        conclusion: string | null;
        started_at: string | null;
        completed_at: string | null;
        details_url: string | null;
        output?: { title?: string; summary?: string };
      }>;
    };
    return data.check_runs.map((cr) => ({
      id: cr.id,
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
      startedAt: cr.started_at,
      completedAt: cr.completed_at,
      detailsUrl: cr.details_url,
      output: {
        title: cr.output?.title,
        summary: cr.output?.summary,
      },
    }));
  }

  async postComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
    opts: PostCommentOptions = {},
  ): Promise<PRComment> {
    const isInline = opts.path !== undefined && opts.line !== undefined && opts.commitId !== undefined;
    const isReply = !isInline && opts.inReplyToId !== undefined;

    if (isInline) {
      // GitHub requires start_line < line for multi-line comments. Normalize
      // so callers can pass either endpoint of the range as start vs end.
      let endLine = opts.line!;
      let endSide = opts.side ?? 'RIGHT';
      let startLine = opts.startLine;
      let startSide = opts.startSide;
      if (startLine !== undefined && startLine !== endLine && startLine > endLine) {
        const tmpLine = endLine;
        const tmpSide = endSide;
        endLine = startLine;
        endSide = startSide ?? endSide;
        startLine = tmpLine;
        startSide = tmpSide;
      }
      const payload: Record<string, unknown> = {
        body,
        commit_id: opts.commitId,
        path: opts.path,
        line: endLine,
        side: endSide,
      };
      if (startLine !== undefined && startLine !== endLine) {
        payload.start_line = startLine;
        payload.start_side = startSide ?? endSide;
      }
      if (opts.inReplyToId !== undefined) {
        payload.in_reply_to = opts.inReplyToId;
      }
      const res = await this.fetch(`/repos/${owner}/${repo}/pulls/${number}/comments`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as GhReviewComment;
      return {
        id: data.id,
        author: data.user?.login ?? '',
        avatarUrl: data.user?.avatar_url ?? undefined,
        body: data.body,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        path: data.path,
        line: data.line ?? undefined,
        side: data.side ?? undefined,
        startLine: data.start_line ?? undefined,
        startSide: data.start_side ?? undefined,
        inReplyToId: data.in_reply_to_id,
        diffHunk: data.diff_hunk,
      };
    }

    if (isReply) {
      const res = await this.fetch(`/repos/${owner}/${repo}/pulls/${number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, in_reply_to: opts.inReplyToId }),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as GhReviewComment;
      return {
        id: data.id,
        author: data.user?.login ?? '',
        avatarUrl: data.user?.avatar_url ?? undefined,
        body: data.body,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        path: data.path,
        line: data.line ?? undefined,
        side: data.side ?? undefined,
        startLine: data.start_line ?? undefined,
        startSide: data.start_side ?? undefined,
        inReplyToId: data.in_reply_to_id,
        diffHunk: data.diff_hunk,
      };
    }

    const res = await this.fetch(`/repos/${owner}/${repo}/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = (await res.json()) as GhIssueComment;
    return {
      id: data.id,
      author: data.user?.login ?? '',
      avatarUrl: data.user?.avatar_url ?? undefined,
      body: data.body,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async getReviews(owner: string, repo: string, number: number): Promise<PRReview[]> {
    const res = await this.fetch(`/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`);
    const data = (await res.json()) as Array<{
      id: number;
      user: { login: string; avatar_url: string } | null;
      state: string;
      submitted_at: string;
    }>;
    const validStates = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']);
    const latestByUser = new Map<string, PRReview>();
    for (const r of data) {
      const login = r.user?.login ?? '';
      if (!login || !validStates.has(r.state)) continue;
      latestByUser.set(login, {
        id: r.id,
        user: login,
        avatarUrl: r.user?.avatar_url ?? '',
        state: r.state as PRReview['state'],
        submittedAt: r.submitted_at,
      });
    }
    return [...latestByUser.values()];
  }

  async submitReview(
    owner: string,
    repo: string,
    number: number,
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
    body?: string,
    comments?: {
      path: string;
      line: number;
      body: string;
      side?: 'LEFT' | 'RIGHT';
      startLine?: number;
      startSide?: 'LEFT' | 'RIGHT';
    }[],
  ): Promise<void> {
    const ghComments = comments?.map((cm) => {
      let endLine = cm.line;
      let endSide: 'LEFT' | 'RIGHT' | undefined = cm.side;
      let startLine = cm.startLine;
      let startSide = cm.startSide;
      if (startLine !== undefined && startLine !== endLine && startLine > endLine) {
        const tmpLine = endLine;
        const tmpSide = endSide;
        endLine = startLine;
        endSide = startSide ?? endSide;
        startLine = tmpLine;
        startSide = tmpSide;
      }
      const out: Record<string, unknown> = {
        path: cm.path,
        line: endLine,
        body: cm.body,
      };
      if (endSide) out.side = endSide;
      if (startLine !== undefined && startLine !== endLine) {
        out.start_line = startLine;
        out.start_side = startSide ?? endSide ?? 'RIGHT';
      }
      return out;
    });
    await this.fetch(`/repos/${owner}/${repo}/pulls/${number}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        body: body || undefined,
        comments: ghComments?.length ? ghComments : undefined,
      }),
    });
  }
}
