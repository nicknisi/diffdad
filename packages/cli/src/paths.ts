import { cp, mkdir, readdir, rename } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Durable application data — the review queue. This is state the user would be upset to lose, so it
 * belongs in a real app-data location, NOT a cache dir that tools (or the OS) may clear:
 * `~/Library/Application Support/diffdad` on macOS, else `$XDG_DATA_HOME/diffdad` or
 * `~/.local/share/diffdad`. (Pre-1.0 this all lived under `~/.cache/diffdad`; see {@link legacyDir}.)
 */
export function dataDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'diffdad');
  const xdg = process.env.XDG_DATA_HOME;
  return xdg ? join(xdg, 'diffdad') : join(homedir(), '.local', 'share', 'diffdad');
}

/**
 * The pre-1.0 location everything used to live under (`~/.cache/diffdad`). Regenerable caches
 * (narratives, recaps) correctly stay here — `~/.cache` is the right home for disposable data — so
 * only the durable subdirs move out (see {@link migrateLegacyData}).
 */
export function legacyDir(): string {
  return join(homedir(), '.cache', 'diffdad');
}

/** The subdirs under the legacy dir that hold durable (non-regenerable) data. */
const DURABLE_SUBDIRS = ['units'] as const;

/**
 * One-time move of durable data from the legacy `~/.cache/diffdad` location into {@link dataDir}.
 * Idempotent and non-destructive: a subdir moves only when the destination doesn't already exist, so
 * a second run (or a fresh install that already wrote to the new location) is a clean no-op and the
 * user's queue is never clobbered. Regenerable caches are deliberately left in `~/.cache`. Safe to
 * call on every startup; best-effort — a failure here must never block the CLI.
 */
export async function migrateLegacyData(opts: { from?: string; to?: string } = {}): Promise<void> {
  const from = opts.from ?? legacyDir();
  const to = opts.to ?? dataDir();
  if (from === to) return;
  for (const sub of DURABLE_SUBDIRS) {
    const src = join(from, sub);
    const dest = join(to, sub);
    if (!(await dirExists(src))) continue;
    if (await dirExists(dest)) continue; // already migrated (or fresh install) — don't touch
    await mkdir(to, { recursive: true });
    try {
      await rename(src, dest); // atomic on the same volume (the common case: same home dir)
    } catch {
      // Cross-device or other rename failure — copy instead and leave the source as a backup.
      await cp(src, dest, { recursive: true });
    }
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}
