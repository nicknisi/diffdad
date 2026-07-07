import { describe, expect, it } from 'vitest';
import { buildPlist } from '../launchd';

// --- fixtures -------------------------------------------------------------

const ARGS = ['/opt/dad', 'daemon', '--port=4319', '--no-open'];
const LOGS = '/home/dev/.local/share/diffdad';

// --- tests ----------------------------------------------------------------

describe('buildPlist EnvironmentVariables (launchd PATH)', () => {
  it('bakes an explicit PATH into the EnvironmentVariables dict', () => {
    const xml = buildPlist(ARGS, LOGS, '/opt/homebrew/bin:/usr/local/bin:/usr/bin');
    expect(xml).toContain('<key>EnvironmentVariables</key>');
    expect(xml).toContain('<key>PATH</key>');
    expect(xml).toContain('<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin</string>');
    // The PATH lives inside the EnvironmentVariables dict, after ProgramArguments.
    expect(xml.indexOf('</array>')).toBeLessThan(xml.indexOf('<key>EnvironmentVariables</key>'));
  });

  it('XML-escapes special characters in the PATH', () => {
    const xml = buildPlist(ARGS, LOGS, '/opt/a&b/bin:/opt/<c>/bin');
    expect(xml).toContain('<string>/opt/a&amp;b/bin:/opt/&lt;c&gt;/bin</string>');
    // The raw, unescaped forms must never reach the plist.
    expect(xml).not.toContain('/opt/a&b/bin');
    expect(xml).not.toContain('/opt/<c>/bin');
  });

  it('omits the EnvironmentVariables block entirely for an empty PATH', () => {
    const xml = buildPlist(ARGS, LOGS, '');
    expect(xml).not.toContain('EnvironmentVariables');
    expect(xml).not.toContain('<key>PATH</key>');
  });

  it('omits the EnvironmentVariables block when the default PATH is unset (process.env.PATH undefined)', () => {
    // A JS default parameter treats explicit `undefined` as "use the default", so the real undefined
    // scenario is an unset process.env.PATH — exercise that by clearing it around the omitting call.
    const saved = process.env.PATH;
    delete process.env.PATH;
    try {
      const xml = buildPlist(ARGS, LOGS);
      expect(xml).not.toContain('EnvironmentVariables');
      expect(xml).not.toContain('<key>PATH</key>');
    } finally {
      process.env.PATH = saved;
    }
  });

  it('leaves ProgramArguments unchanged whether or not a PATH is baked in', () => {
    const withPath = buildPlist(ARGS, LOGS, '/usr/bin');
    const withoutPath = buildPlist(ARGS, LOGS, '');
    for (const xml of [withPath, withoutPath]) {
      expect(xml).toContain('<string>/opt/dad</string>');
      expect(xml).toContain('<string>daemon</string>');
      expect(xml).toContain('<string>--port=4319</string>');
      expect(xml).toContain('<string>--no-open</string>');
    }
  });
});
