import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { dirname } from 'path';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Minimal advisory lock: an exclusive-create lock file carrying the holder's pid and timestamp.
 * A lock older than `staleMs` is treated as abandoned (crashed writer) and reclaimed. Contenders
 * retry with exponential backoff until `timeoutMs`. This guards concurrent revision pointer updates
 * and prunes between the server and the daemon; it is deliberately small, not a general lock manager.
 */
export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: { staleMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  await mkdir(dirname(lockPath), { recursive: true });

  let backoff = 10;
  for (;;) {
    try {
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (await isStale(lockPath, staleMs)) {
        await unlink(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out acquiring lock ${lockPath}`);
      await sleep(Math.min(backoff, Math.max(1, deadline - Date.now())));
      backoff = Math.min(backoff * 2, 250);
    }
  }

  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}

async function isStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const held = JSON.parse(await readFile(lockPath, 'utf-8')) as { ts?: number };
    const ts = typeof held.ts === 'number' ? held.ts : (await stat(lockPath)).mtimeMs;
    return Date.now() - ts > staleMs;
  } catch {
    // Unreadable/corrupt lock: fall back to mtime, and treat a vanished file as free.
    try {
      return Date.now() - (await stat(lockPath)).mtimeMs > staleMs;
    } catch {
      return true;
    }
  }
}
