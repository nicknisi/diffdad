import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileTable, UnitRow } from '../UnitRow';
import type { TriageSummary, Unit } from '../../state/types';

/**
 * What a lane actually renders.
 *
 * Rendered through `react-dom/server` rather than a DOM, following `collapse-render.test.tsx`: the web
 * suite runs vitest in the node environment on purpose (`durable-review-state.test.ts` shims
 * `globalThis.localStorage`, which a DOM environment owns as a read-only accessor). `UnitRow` is
 * prop-driven, so it renders fully here; the drawer's *open* state is not reachable without a DOM, which
 * is why `FileTable` is exported and asserted on its own props.
 *
 * The `to resolve` assertion is the one that has to exist. Every other check here could pass while the
 * queue still printed a placeholder as though it were a measurement.
 */

function mkTriage(over: Partial<TriageSummary> = {}): TriageSummary {
  return {
    files: over.files ?? [{ path: 'README.md', kind: 'docs', criticality: [] }],
    criticality: over.criticality ?? [],
    additions: over.additions ?? 4,
    deletions: over.deletions ?? 1,
    truncated: over.truncated ?? false,
    sha: over.sha ?? 'abc123',
    ...over,
  };
}

function mkUnit(over: Partial<Unit> = {}): Unit {
  return {
    unitId: 'u1',
    repo: 'workos/authkit',
    taskLabel: 'wire SAML callback',
    intent: 'intent',
    status: 'queued',
    toResolve: 0,
    createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z',
    ...over,
  };
}

const NOW = Date.parse('2026-06-26T02:00:00.000Z');
const render = (unit: Unit, onRemove = true) =>
  renderToStaticMarkup(<UnitRow unit={unit} now={NOW} onOpen={() => {}} onRemove={onRemove ? () => {} : undefined} />);

describe('lane render', () => {
  it('never prints the "to resolve" placeholder on any lane', () => {
    // `toResolve` is initialised to 0 and only written during the on-open hydrate, so every queued row
    // rendered "0 to resolve" — a number that was never measured, presented as if it had been.
    const lanes = ['needs-you', 'probably-not', 'in-flight', 'cleared'] as const;
    for (const lane of lanes) {
      const html = render(mkUnit({ lane, toResolve: 0, triage: mkTriage() }));
      expect(html).not.toContain('to resolve');
    }
  });

  it('leads a needs-you row with the alert mark and a probably-not row with the open circle', () => {
    expect(render(mkUnit({ lane: 'needs-you', triage: mkTriage({ criticality: ['auth'] }) }))).toContain('▲');
    expect(render(mkUnit({ lane: 'probably-not', triage: mkTriage() }))).toContain('○');
  });

  it('renders the reason, not a verdict glyph, as the row’s second line', () => {
    const html = render(
      mkUnit({ lane: 'probably-not', triage: mkTriage({ files: [{ path: 'a.md', kind: 'docs', criticality: [] }] }) }),
    );
    expect(html).toContain('docs only');
  });

  it('renders criticality as tags rather than prose', () => {
    const html = render(
      mkUnit({
        lane: 'needs-you',
        triage: mkTriage({ criticality: ['auth', 'session'] }),
      }),
    );
    expect(html).toContain('auth');
    expect(html).toContain('session');
  });

  it('states only what the review rollup supports — never a reviewer total it was not sent', () => {
    const nobody = render(mkUnit({ lane: 'needs-you', reviewRollup: { approved: 0, changesRequested: 0 } }));
    expect(nobody).toContain('nobody has approved');
    const some = render(mkUnit({ lane: 'needs-you', reviewRollup: { approved: 2, changesRequested: 0 } }));
    expect(some).toContain('2 approvals already');
    expect(some).not.toContain('of 3');
  });

  it('says what ✕ actually does now that it is a dismissal, not a delete', () => {
    expect(render(mkUnit({ lane: 'needs-you' }))).toContain('Dismiss until they push');
  });

  it('offers the evidence drawer on every lane', () => {
    // "Probably not" has to be auditable in one click, or it is a claim taken on faith — and "why is this
    // row here?" is a fair question of the other lanes too, which is what `drawerNote` answers for them.
    const lanes = ['needs-you', 'probably-not', 'in-flight', 'cleared'] as const;
    for (const lane of lanes) {
      expect(render(mkUnit({ lane, triage: mkTriage() }))).toContain('Why it landed here');
    }
  });

  it('sizes rows by stakes with typography and padding only — no color, no icon', () => {
    const high = render(mkUnit({ lane: 'needs-you', triage: mkTriage({ criticality: ['payment'] }) }));
    const low = render(mkUnit({ lane: 'probably-not', triage: mkTriage({ additions: 2, deletions: 0 }) }));
    // Matched with the closing quote: bare 'py-2' is a substring of 'py-2.5', so it would pass against the
    // mid tier and a demotion of low-stakes sizing would go unnoticed.
    expect(high).toContain('py-3"');
    expect(high).toContain('font-semibold');
    expect(low).toContain('py-2"');
    expect(low).not.toContain('py-2.5');
  });

  it('loses neither fact on a PR that is both truncated and criticality-tagged', () => {
    // `reasonLine` ranks truncation above criticality; the chip ranks the tags. The row must not let that
    // difference drop either fact — the tags take the chip, truncation stays in the meta line.
    const html = render(mkUnit({ lane: 'needs-you', triage: mkTriage({ truncated: true, criticality: ['auth'] }) }));
    expect(html).toContain('auth');
    expect(html).toContain('over 100 files');
  });

  it('omits the file count entirely rather than asserting zero for an unmeasured unit', () => {
    const html = render(mkUnit({ lane: 'needs-you', metadata: undefined }));
    expect(html).not.toContain('0 files');
    expect(html).toContain('not looked at yet');
  });
});

describe('lane render — evidence drawer', () => {
  it('lists every file with its kind', () => {
    const html = renderToStaticMarkup(
      <FileTable
        files={[
          { path: 'src/auth/session.ts', kind: 'source', criticality: ['auth'] },
          { path: 'bun.lock', kind: 'lockfile', criticality: [] },
        ]}
        truncated={false}
      />,
    );
    expect(html).toContain('src/auth/session.ts');
    expect(html).toContain('bun.lock');
    expect(html).toContain('source · criticality');
    expect(html).toContain('lockfile');
  });

  it('caps a long list and says how many it held back', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `src/f${i}.ts`,
      kind: 'source' as const,
      criticality: [],
    }));
    const html = renderToStaticMarkup(<FileTable files={files} truncated={false} />);
    expect(html).toContain('…and 8 more');
    expect(html).not.toContain('src/f19.ts');
  });

  it('never claims a total it does not have for a truncated PR', () => {
    // `triage.files` holds only the first page, so the remainder is over what was fetched — not the diff.
    const files = Array.from({ length: 100 }, (_, i) => ({
      path: `src/f${i}.ts`,
      kind: 'source' as const,
      criticality: [],
    }));
    const html = renderToStaticMarkup(<FileTable files={files} truncated />);
    expect(html).toContain('…and 88 more of the first 100 fetched');
  });
});
