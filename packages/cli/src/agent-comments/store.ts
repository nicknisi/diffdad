import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { type AgentComment, type AgentReply, type NewAgentComment, UnknownCommentError } from './types';

const STORE_DIR = join(homedir(), '.cache', 'diffdad', 'agent-comments');

/** Sanitize a store key (base ref / PR coordinates) into a safe filename segment. */
function keyToFile(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '-');
  return join(STORE_DIR, `${safe}.json`);
}

export type StoreOptions = {
  /** Injectable for deterministic tests. */
  now?: () => string;
  genId?: () => string;
};

/**
 * The single source of truth for agent-bound comments, shared by the HTTP routes
 * (UI) and the MCP tools. In-memory with best-effort write-through persistence to
 * ~/.cache/diffdad/agent-comments/<key>.json — keyed by base ref so threads survive
 * narrative regeneration, and durable across dad restarts / agent context resets.
 */
export class AgentCommentStore {
  private comments: AgentComment[];
  private readonly file: string;
  private readonly now: () => string;
  private readonly genId: () => string;

  constructor(key: string, initial: AgentComment[] = [], opts: StoreOptions = {}) {
    this.file = keyToFile(key);
    this.comments = initial;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.genId = opts.genId ?? (() => crypto.randomUUID());
  }

  /** Load a store from disk (or start empty if absent/corrupt). */
  static async load(key: string, opts: StoreOptions = {}): Promise<AgentCommentStore> {
    let initial: AgentComment[] = [];
    try {
      const raw = await readFile(keyToFile(key), 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) initial = parsed as AgentComment[];
    } catch {
      // missing or corrupt — start clean
    }
    return new AgentCommentStore(key, initial, opts);
  }

  list(status?: AgentComment['status'] | 'all'): AgentComment[] {
    if (!status || status === 'all') return [...this.comments];
    return this.comments.filter((c) => c.status === status);
  }

  async add(input: NewAgentComment): Promise<AgentComment> {
    const comment: AgentComment = {
      id: this.genId(),
      path: input.path,
      line: input.line,
      side: input.side ?? 'RIGHT',
      body: input.body,
      status: 'open',
      author: 'user',
      replies: [],
      hunkContext: input.hunkContext ?? '',
      chapterTitle: input.chapterTitle,
      createdAt: this.now(),
    };
    this.comments.push(comment);
    await this.save();
    return comment;
  }

  /** Flip the given open comments to delivered (idempotent for already-delivered/addressed). */
  async markDelivered(ids: string[]): Promise<void> {
    const set = new Set(ids);
    let changed = false;
    for (const c of this.comments) {
      if (set.has(c.id) && c.status === 'open') {
        c.status = 'delivered';
        c.deliveredAt = this.now();
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  async addReply(id: string, reply: Omit<AgentReply, 'id' | 'createdAt'>): Promise<AgentComment> {
    const comment = this.require(id);
    comment.replies.push({ id: this.genId(), author: reply.author, body: reply.body, createdAt: this.now() });
    await this.save();
    return comment;
  }

  async resolve(id: string, note?: string): Promise<AgentComment> {
    const comment = this.require(id);
    comment.status = 'addressed';
    comment.addressedAt = this.now();
    if (note) comment.addressedNote = note;
    await this.save();
    return comment;
  }

  private require(id: string): AgentComment {
    const comment = this.comments.find((c) => c.id === id);
    if (!comment) throw new UnknownCommentError(id);
    return comment;
  }

  /** Best-effort persistence: on failure the in-memory copy stays authoritative. */
  private async save(): Promise<void> {
    try {
      await mkdir(STORE_DIR, { recursive: true });
      await writeFile(this.file, JSON.stringify(this.comments, null, 2));
    } catch (err) {
      console.warn(`[diffdad] failed to persist agent comments: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
