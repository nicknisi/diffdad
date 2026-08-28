import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { collapseWhitespace, findMatchingSessions, verifyPromptText } from '../local-sessions';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'diffdad-trace-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Line = Record<string, unknown>;

async function writeSession(dir: string, name: string, lines: Line[]): Promise<void> {
  const projectDir = join(root, dir);
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, name), lines.map((l) => JSON.stringify(l)).join('\n'), 'utf-8');
}

function userLine(over: Partial<Line> & { content: unknown }): Line {
  return {
    type: 'user',
    sessionId: 'sess',
    cwd: '/work/repo',
    timestamp: '2026-01-01T00:00:00.000Z',
    gitBranch: 'main',
    message: { role: 'user', content: over.content },
    ...over,
  };
}

function toolLine(filePath: string): Line {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: filePath } }] },
  };
}

describe('findMatchingSessions', () => {
  it('returns [] when the log root is missing', async () => {
    const out = await findMatchingSessions({
      repoDirHints: ['repo'],
      changedFiles: [],
      logRoot: join(root, 'does-not-exist'),
    });
    expect(out).toEqual([]);
  });

  it('ranks a branch match above a cwd-only match', async () => {
    await writeSession('branch-proj', 'a.jsonl', [
      { ...userLine({ content: 'branch session' }), sessionId: 'branch', cwd: '/x/other', gitBranch: 'feature/x' },
    ]);
    await writeSession('cwd-proj', 'b.jsonl', [
      { ...userLine({ content: 'cwd session' }), sessionId: 'cwd', cwd: '/x/repo', gitBranch: 'unrelated' },
    ]);

    const out = await findMatchingSessions({
      repoDirHints: ['repo'],
      branch: 'feature/x',
      changedFiles: [],
      logRoot: root,
    });

    expect(out.map((s) => s.sessionId)).toEqual(['branch', 'cwd']);
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it('scores a session that touches >=2 changed files via tool events', async () => {
    await writeSession('files-proj', 'c.jsonl', [
      { ...userLine({ content: 'file session' }), sessionId: 'files', cwd: '/x/other', gitBranch: 'nope' },
      toolLine('src/api.ts'),
      toolLine('src/db.ts'),
    ]);
    // one-file match should not score the file rung
    await writeSession('one-file', 'd.jsonl', [
      { ...userLine({ content: 'one' }), sessionId: 'one', cwd: '/x/other', gitBranch: 'nope' },
      toolLine('src/api.ts'),
    ]);

    const out = await findMatchingSessions({
      repoDirHints: ['nomatch'],
      changedFiles: ['src/api.ts', 'src/db.ts'],
      logRoot: root,
    });

    expect(out.map((s) => s.sessionId)).toEqual(['files']);
  });

  it('drops slash commands and enforces per-prompt and list caps', async () => {
    const long = 'x'.repeat(3000);
    const lines: Line[] = [userLine({ content: '/clear' }), userLine({ content: long })];
    for (let i = 0; i < 30; i++) lines.push(userLine({ content: `prompt ${i}` }));
    await writeSession(
      'cap-proj',
      'e.jsonl',
      lines.map((l) => ({ ...l, cwd: '/x/repo' })),
    );

    const out = await findMatchingSessions({ repoDirHints: ['repo'], changedFiles: [], logRoot: root });

    expect(out).toHaveLength(1);
    const prompts = out[0]!.userPrompts;
    expect(prompts).toHaveLength(20); // list cap
    expect(prompts.map((p) => p.text)).not.toContain('/clear'); // slash command dropped
    expect(prompts[0]!.text).toHaveLength(2000); // per-prompt cap
    expect(prompts[0]!.truncated).toBe(true); // capped display is a truncated prefix
  });

  it('extracts prompts as all-verified quotes on a clean fixture', async () => {
    await writeSession('clean-proj', 'g.jsonl', [
      { ...userLine({ content: 'first prompt' }), cwd: '/x/repo' },
      { ...userLine({ content: 'second prompt' }), cwd: '/x/repo' },
    ]);
    const out = await findMatchingSessions({ repoDirHints: ['repo'], changedFiles: [], logRoot: root });
    expect(out).toHaveLength(1);
    const prompts = out[0]!.userPrompts;
    expect(prompts.map((p) => p.text)).toEqual(['first prompt', 'second prompt']);
    expect(prompts.every((p) => p.verified)).toBe(true);
    expect(prompts.every((p) => !p.truncated)).toBe(true);
  });
});

describe('verifyPromptText', () => {
  it('verifies an exact match', () => {
    expect(verifyPromptText('fix the bug', 'fix the bug')).toEqual({ verified: true });
  });

  it('verifies a whitespace-collapsed match', () => {
    expect(verifyPromptText('fix   the\n\tbug', 'fix the bug')).toEqual({ verified: true });
    expect(collapseWhitespace('fix   the\n\tbug')).toBe('fix the bug');
  });

  it('flags a truncated prefix', () => {
    expect(verifyPromptText('fix the', 'fix the bug now')).toEqual({ verified: true, truncated: true });
  });

  it('returns false for corrupted text not in the transcript', () => {
    expect(verifyPromptText('delete everything', 'fix the bug')).toEqual({ verified: false });
  });

  it('returns false for empty text', () => {
    expect(verifyPromptText('', 'fix the bug')).toEqual({ verified: false });
  });

  it('takes at most the top 3 scoring sessions', async () => {
    for (let i = 0; i < 5; i++) {
      await writeSession(`p${i}`, `f${i}.jsonl`, [
        { ...userLine({ content: `s${i}` }), sessionId: `s${i}`, cwd: '/x/repo', gitBranch: 'nope' },
      ]);
    }
    const out = await findMatchingSessions({ repoDirHints: ['repo'], changedFiles: [], logRoot: root });
    expect(out).toHaveLength(3);
  });
});
