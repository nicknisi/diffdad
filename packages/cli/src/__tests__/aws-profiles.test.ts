import { describe, expect, it } from 'bun:test';
import { mergeAwsProfiles } from '../narrative/aws-profiles';

describe('mergeAwsProfiles', () => {
  it('lists config-file profiles with their region', () => {
    const out = mergeAwsProfiles({ default: { region: 'us-east-1' }, Production: { region: 'us-west-2' } }, {});
    // localeCompare orders by base letter (d before p), using case only as a tiebreak, so 'default'
    // precedes 'Production'. Code-unit order would invert this ('P' < 'd').
    expect(out).toEqual([
      { name: 'default', region: 'us-east-1' },
      { name: 'Production', region: 'us-west-2' },
    ]);
  });

  it('surfaces credentials-only profiles with no region', () => {
    const out = mergeAwsProfiles({}, { staging: { aws_access_key_id: 'AKIA' } });
    expect(out).toEqual([{ name: 'staging' }]);
  });

  it('filters out sso-session and services sections (they are not profiles)', () => {
    const out = mergeAwsProfiles(
      {
        Production: { region: 'us-east-1' },
        'sso-session.my-sso': { sso_region: 'us-east-1' },
        'services.my-services': { s3: 'x' },
      },
      {},
    );
    expect(out.map((p) => p.name)).toEqual(['Production']);
  });

  it('dedupes a profile present in both files, keeping the config-file region', () => {
    const out = mergeAwsProfiles({ shared: { region: 'eu-west-1' } }, { shared: { aws_access_key_id: 'AKIA' } });
    expect(out).toEqual([{ name: 'shared', region: 'eu-west-1' }]);
  });

  it('omits region when a config profile has none', () => {
    const out = mergeAwsProfiles({ noregion: { output: 'json' } }, {});
    expect(out).toEqual([{ name: 'noregion' }]);
  });

  it('sorts profiles by name', () => {
    const out = mergeAwsProfiles({ zed: { region: 'us-east-1' }, alpha: { region: 'us-east-1' } }, {});
    expect(out.map((p) => p.name)).toEqual(['alpha', 'zed']);
  });
});
