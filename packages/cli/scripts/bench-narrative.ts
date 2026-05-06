#!/usr/bin/env bun
/**
 * Bench runner for narrative generation. Reads JSON fixtures from
 * `packages/cli/src/__tests__/fixtures/prs/*.json`, runs `generateNarrative`
 * on each, computes structural metrics, and writes the results.
 *
 * Fixture JSON shape:
 *   {
 *     "label": "small/refactor",
 *     "pr": PRMetadata,
 *     "files": DiffFile[],
 *     "fileTree": string[]
 *   }
 *
 * Usage:
 *   bun packages/cli/scripts/bench-narrative.ts             # run + print
 *   bun packages/cli/scripts/bench-narrative.ts --write     # also write bench-baseline.json
 *   bun packages/cli/scripts/bench-narrative.ts --diff      # diff against bench-baseline.json
 *
 * Requires an AI provider configured via `dad config` or env vars
 * (ANTHROPIC_API_KEY / OPENAI_API_KEY) — otherwise it falls back to local CLI
 * and may be slow.
 */
import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { readConfig } from '../src/config';
import { generateNarrative } from '../src/narrative/engine';
import { computeMetrics, formatMetricsRow, type NarrativeMetrics } from '../src/narrative/metrics';
import type { DiffFile, PRMetadata } from '../src/github/types';

type Fixture = {
  label: string;
  pr: PRMetadata;
  files: DiffFile[];
  fileTree: string[];
};

type RunRow = {
  label: string;
  metrics: NarrativeMetrics;
  provider: string;
};

const FIXTURES_DIR = resolve(import.meta.dir, '../src/__tests__/fixtures/prs');
const BASELINE_PATH = resolve(import.meta.dir, '../bench-baseline.json');

async function loadFixtures(): Promise<Fixture[]> {
  if (!existsSync(FIXTURES_DIR)) return [];
  const entries = await readdir(FIXTURES_DIR);
  const out: Fixture[] = [];
  for (const e of entries.filter((n) => n.endsWith('.json'))) {
    const raw = await readFile(join(FIXTURES_DIR, e), 'utf-8');
    out.push(JSON.parse(raw) as Fixture);
  }
  return out;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const diff = args.has('--diff');

  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    console.log(`No fixtures in ${FIXTURES_DIR}. See packages/cli/scripts/bench-narrative.ts header for the format.`);
    process.exit(0);
  }

  const config = await readConfig();
  const rows: RunRow[] = [];
  const startedAll = Date.now();
  for (const fx of fixtures) {
    const t0 = Date.now();
    const result = await generateNarrative(fx.pr, fx.files, fx.fileTree, config);
    const elapsed = Date.now() - t0;
    const metrics: NarrativeMetrics = { ...computeMetrics(result.narrative, fx.files), wallMsTotal: elapsed };
    rows.push({ label: fx.label, metrics, provider: result.provider });
    console.log(formatMetricsRow(fx.label, metrics) + `  wall=${elapsed}ms  via ${result.provider}`);
  }
  const totalMs = Date.now() - startedAll;
  console.log(`\nTotal: ${totalMs}ms across ${rows.length} fixture(s).`);

  if (write) {
    await writeFile(BASELINE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
    console.log(`Wrote baseline: ${BASELINE_PATH}`);
  }

  if (diff) {
    if (!existsSync(BASELINE_PATH)) {
      console.error(`No baseline at ${BASELINE_PATH} — run with --write first.`);
      process.exit(1);
    }
    const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf-8')) as { rows: RunRow[] };
    const baseByLabel = new Map(baseline.rows.map((r) => [r.label, r.metrics]));
    console.log('\nDelta vs baseline:');
    for (const r of rows) {
      const base = baseByLabel.get(r.label);
      if (!base) {
        console.log(`  ${r.label.padEnd(40)} (no baseline row)`);
        continue;
      }
      const fmt = (k: keyof NarrativeMetrics) => {
        const b = base[k] as number | undefined;
        const c = r.metrics[k] as number | undefined;
        if (typeof b !== 'number' || typeof c !== 'number') return '';
        const delta = c - b;
        const sign = delta > 0 ? '+' : '';
        return `${k}=${sign}${delta.toFixed ? delta.toFixed(2) : delta}`;
      };
      console.log(
        `  ${r.label.padEnd(40)} ${fmt('chapters')}  ${fmt('hunksOrphaned')}  ${fmt('crossFileChapterRatio')}  ${fmt('reshowCount')}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
