export type AgentCommentStatus = 'open' | 'delivered' | 'addressed';
export type AgentAuthor = 'user' | 'agent';

export type AgentReply = {
  id: string;
  author: AgentAuthor;
  body: string;
  createdAt: string;
};

export type AgentComment = {
  id: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
  status: AgentCommentStatus;
  author: AgentAuthor;
  replies: AgentReply[];
  hunkContext: string;
  chapterTitle?: string;
  createdAt: string;
  deliveredAt?: string;
  addressedAt?: string;
  addressedNote?: string;
};

/** Input for composing a new user comment (status/author/id are assigned by the store). */
export type NewAgentComment = {
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  body: string;
  hunkContext?: string;
  chapterTitle?: string;
};

/** Thrown when a mutation references a comment id the store doesn't hold. */
export class UnknownCommentError extends Error {
  constructor(public readonly commentId: string) {
    super(`unknown agent comment id: ${commentId}`);
    this.name = 'UnknownCommentError';
  }
}
