import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the release matrix so a target/artifact can't be dropped or misnamed.
// mise's `github:` backend (ubi) matches release assets by OS + arch tokens, so
// the artifact name for each bun target must carry the arch token ubi recognizes.
const workflow = readFileSync(join(import.meta.dir, '../../../../.github/workflows/release.yml'), 'utf8');

// Extract every `target:`/`artifact:` pair from the build matrix include block.
function matrixPairs(yaml: string): Array<{ target: string; artifact: string }> {
  const pairs: Array<{ target: string; artifact: string }> = [];
  const re = /target:\s*(\S+)\s*\n\s*artifact:\s*(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yaml)) !== null) {
    pairs.push({ target: m[1]!, artifact: m[2]! });
  }
  return pairs;
}

describe('release workflow build matrix', () => {
  const pairs = matrixPairs(workflow);

  it('covers every published target/artifact pair', () => {
    expect(new Set(pairs.map((p) => `${p.target}=${p.artifact}`))).toEqual(
      new Set([
        'bun-darwin-arm64=dad-darwin-arm64',
        'bun-darwin-x64=dad-darwin-x86_64',
        'bun-linux-x64=dad-linux-x86_64',
        'bun-linux-arm64=dad-linux-aarch64',
      ]),
    );
  });

  it('names each artifact with an OS + arch token mise/ubi can resolve', () => {
    // Tokens ubi accepts per platform/arch; the artifact name must contain one.
    const osToken: Record<string, string> = { darwin: 'darwin', linux: 'linux' };
    const archTokens: Record<string, string[]> = {
      arm64: ['aarch64', 'arm64'],
      x64: ['x86_64', 'amd64', 'x64'],
    };
    for (const { target, artifact } of pairs) {
      const match = target.match(/^bun-(darwin|linux)-(arm64|x64)$/);
      expect(match, `unexpected target ${target}`).not.toBeNull();
      const os = match![1]!;
      const arch = match![2]!;
      expect(artifact).toContain(osToken[os]);
      expect(
        archTokens[arch]!.some((t: string) => artifact.includes(t)),
        `${artifact} lacks an arch token for ${arch}`,
      ).toBe(true);
    }
  });
});
