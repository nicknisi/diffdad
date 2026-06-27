import type { AgentComment, PRComment } from '../state/types';

/**
 * Flatten agent comments into the PRComment shape so they render inline in the diff through
 * the same `Chapter → Hunk → CommentThread` pipeline as GitHub comments. Each agent comment
 * becomes a root PRComment; its replies become PRComments linked by `inReplyToId`. The
 * `source: 'agent'` + `status` fields drive the inline badge.
 */
export function agentToPRComments(agentComments: AgentComment[]): PRComment[] {
  const out: PRComment[] = [];
  for (const ac of agentComments) {
    out.push({
      id: ac.id,
      author: ac.author === 'agent' ? 'agent' : 'you',
      body: ac.body,
      createdAt: ac.createdAt,
      updatedAt: ac.deliveredAt ?? ac.createdAt,
      path: ac.path,
      line: ac.line,
      side: ac.side,
      startLine: ac.startLine,
      startSide: ac.startSide,
      source: 'agent',
      status: ac.status,
      addressedNote: ac.addressedNote,
    });
    for (const r of ac.replies) {
      out.push({
        id: r.id,
        inReplyToId: ac.id,
        author: r.author === 'agent' ? 'agent' : 'you',
        body: r.body,
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
        path: ac.path,
        line: ac.line,
        side: ac.side,
        source: 'agent',
      });
    }
  }
  return out;
}
