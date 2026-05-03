import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  detectBaseBranch,
  findRepoRoot,
  getCommitStats,
  getCurrentBranch,
  getDiffForCommit,
  getDiffForRange,
  getHeadSha,
  getRangeStats,
  listCommits,
  mergeBase,
  repoFingerprint,
} from '../git/local';

async function git(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  }
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return stdout.trim();
}

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'diffdad-git-'));
  await git(['init', '--initial-branch=main', '-q'], repo);
  await git(['config', 'user.email', 'test@diffdad.local'], repo);
  await git(['config', 'user.name', 'Test'], repo);
  await git(['config', 'commit.gpgsign', 'false'], repo);
  return repo;
}

const repos: string[] = [];

afterEach(async () => {
  while (repos.length > 0) {
    const r = repos.pop();
    if (r) await rm(r, { recursive: true, force: true });
  }
});

describe('local git', () => {
  it('finds the repo root and current branch', async () => {
    const repo = await makeRepo();
    repos.push(repo);
    await writeFile(join(repo, 'a.txt'), 'hello\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'init'], repo);

    expect(await findRepoRoot(repo)).toBe(repo);
    expect(await getCurrentBranch(repo)).toBe('main');
    const head = await getHeadSha('main', repo);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('lists commits and skips merge commits', async () => {
    const repo = await makeRepo();
    repos.push(repo);
    await writeFile(join(repo, 'a.txt'), 'hello\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'init'], repo);

    await git(['checkout', '-b', 'feature'], repo);
    await writeFile(join(repo, 'a.txt'), 'hello\nworld\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'add world'], repo);

    await writeFile(join(repo, 'b.txt'), 'two\n');
    await git(['add', 'b.txt'], repo);
    await git(['commit', '-m', 'add b'], repo);

    const commits = await listCommits('main', 'feature', repo);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.subject).toBe('add world');
    expect(commits[1]!.subject).toBe('add b');
    expect(commits[0]!.shortSha.length).toBeGreaterThanOrEqual(7);
  });

  it('produces a diff for a single commit', async () => {
    const repo = await makeRepo();
    repos.push(repo);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'first'], repo);
    await writeFile(join(repo, 'a.txt'), 'one\ntwo\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'second'], repo);

    const head = await getHeadSha('main', repo);
    const diff = await getDiffForCommit(head, repo);
    expect(diff).toContain('a.txt');
    expect(diff).toContain('+two');
  });

  it('produces a diff for a range and stats line up', async () => {
    const repo = await makeRepo();
    repos.push(repo);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'init'], repo);
    const baseSha = await getHeadSha('main', repo);

    await git(['checkout', '-b', 'feature'], repo);
    await writeFile(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'add lines'], repo);

    const rangeDiff = await getDiffForRange(baseSha, 'feature', repo);
    expect(rangeDiff).toContain('+two');
    expect(rangeDiff).toContain('+three');

    const stats = await getRangeStats(baseSha, 'feature', repo);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(0);
    expect(stats.changedFiles).toBe(1);
  });

  it('handles root commits via getDiffForCommit', async () => {
    const repo = await makeRepo();
    repos.push(repo);
    await writeFile(join(repo, 'a.txt'), 'hello\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'root'], repo);

    const head = await getHeadSha('main', repo);
    const diff = await getDiffForCommit(head, repo);
    expect(diff).toContain('a.txt');
    expect(diff).toContain('+hello');

    const stats = await getCommitStats(head, repo);
    expect(stats.additions).toBe(1);
    expect(stats.deletions).toBe(0);
  });

  it('detects base branch via origin/HEAD when set, falls back to main', async () => {
    const repo = await makeRepo();
    repos.push(repo);
    await writeFile(join(repo, 'a.txt'), 'hello\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'init'], repo);

    // No origin remote set — should fall back to local 'main'.
    const detected = await detectBaseBranch(repo);
    expect(detected).toBe('main');
  });

  it('computes mergeBase for diverged branches', async () => {
    const repo = await makeRepo();
    repos.push(repo);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'init'], repo);
    const initSha = await gitOutput(['rev-parse', 'HEAD'], repo);

    await git(['checkout', '-b', 'feature'], repo);
    await writeFile(join(repo, 'a.txt'), 'one\nfeature\n');
    await git(['add', 'a.txt'], repo);
    await git(['commit', '-m', 'feature work'], repo);

    const base = await mergeBase('main', 'feature', repo);
    expect(base).toBe(initSha);
  });

  it('produces a stable repo fingerprint', () => {
    const a = repoFingerprint('/Users/x/code/diffdad');
    const b = repoFingerprint('/Users/x/code/diffdad');
    const c = repoFingerprint('/Users/x/code/other');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

beforeAll(() => {
  // touch import to silence unused-var for direct re-exports
});
