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

// Guards the Homebrew tap update so each published artifact's checksum is mapped
// to exactly one formula branch by exact filename. A broad arch/OS regex could
// match the wrong branch (e.g. `x86_64` hitting both darwin and linux) or a
// missing branch could silently publish a stale/wrong sha256.
describe('release workflow homebrew formula update', () => {
  const updateStep = workflow.slice(workflow.indexOf('name: Update formula'));

  it('computes a checksum for every published artifact, including linux aarch64', () => {
    for (const artifact of [
      'dad-darwin-arm64.tar.gz',
      'dad-darwin-x86_64.tar.gz',
      'dad-linux-x86_64.tar.gz',
      'dad-linux-aarch64.tar.gz',
    ]) {
      expect(updateStep, `no shasum for ${artifact}`).toContain(`shasum -a 256 ${artifact}`);
    }
  });

  it('maps each exact artifact filename to its checksum env var', () => {
    const expected: Record<string, string> = {
      'dad-darwin-arm64.tar.gz': 'SHA_DARWIN_ARM64',
      'dad-darwin-x86_64.tar.gz': 'SHA_DARWIN_X86_64',
      'dad-linux-x86_64.tar.gz': 'SHA_LINUX_X86_64',
      'dad-linux-aarch64.tar.gz': 'SHA_LINUX_ARM64',
    };
    for (const [artifact, envVar] of Object.entries(expected)) {
      expect(updateStep).toContain(`'${artifact}': os.environ['${envVar}']`);
    }
    // Reject any residual broad arch/OS regex that could match multiple branches.
    expect(updateStep).not.toContain("'arm64':");
    expect(updateStep).not.toContain('dad-.*');
  });

  it('honors the tap PLACEHOLDER_LINUX_ARM64 contract and fails on count != 1', () => {
    // The coordinated homebrew-formulae PR adds the linux ARM branch with this
    // placeholder; the substitution must accept it and require exactly one hit.
    expect(updateStep).toContain('PLACEHOLDER_\\w+');
    expect(updateStep).toContain('if n != 1:');
    expect(updateStep).toContain('expected exactly one sha256 substitution');
  });
});
