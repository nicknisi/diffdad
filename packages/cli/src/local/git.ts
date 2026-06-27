/** Options shared by every git helper. `cwd` lets the daemon run git in a submitted worktree
 *  rather than the daemon's own process directory; omit it (the default) for in-place commands. */
export type GitOptions = { cwd?: string };

/** Run a git command, capturing stdout/stderr/exit code. Mirrors the Bun.spawn pattern in cli.ts. */
export async function spawnText(
  args: string[],
  opts: GitOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', cwd: opts.cwd });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

export class NotAGitRepoError extends Error {
  constructor() {
    super('not a git repository (or no git on PATH)');
    this.name = 'NotAGitRepoError';
  }
}

export async function assertGitRepo(opts: GitOptions = {}): Promise<void> {
  const { code } = await spawnText(['git', 'rev-parse', '--is-inside-work-tree'], opts);
  if (code !== 0) throw new NotAGitRepoError();
}

/** Resolve the repository's default branch: origin/HEAD, then `main`, then `master`. */
export async function resolveDefaultBranch(opts: GitOptions = {}): Promise<string | null> {
  const sym = await spawnText(['git', 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], opts);
  if (sym.code === 0) {
    const ref = sym.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
    if (ref) return ref;
  }
  for (const cand of ['main', 'master']) {
    const v = await spawnText(['git', 'rev-parse', '--verify', '--quiet', cand], opts);
    if (v.code === 0) return cand;
  }
  return null;
}
