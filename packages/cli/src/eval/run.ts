#!/usr/bin/env bun
/**
 * Eval harness for Diff Dad's narrative generation.
 *
 * Runs each fixture through generateNarrative, scores the output on a 4-axis
 * rubric (comprehensiveness, rationality, conciseness, expressiveness) using
 * an LLM-as-judge, and writes a baseline JSON snapshot.
 *
 * Usage:
 *   bun packages/cli/src/eval/run.ts                   # run all fixtures, write baseline
 *   bun packages/cli/src/eval/run.ts --fixture=auth-token-validation
 *   bun packages/cli/src/eval/run.ts --output=path.json
 *
 * Requires an AI provider configured via `dad config` (or env vars consumed by
 * readConfig). The same provider is used for both the narrative under test
 * and the judge — for stronger isolation, set DIFFDAD_JUDGE_PROVIDER /
 * DIFFDAD_JUDGE_MODEL to use a different model for judging.
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { readConfig } from '../config';
import { generateNarrative } from '../narrative/engine';
import { FIXTURES } from './fixtures';
import { chaptersOrderedByRisk, countProseWords, scoreDefectDetection, scoreNarrative } from './judge';
import type { Baseline, EvalFixture, EvalRun } from './types';

function describeProvider(config: Awaited<ReturnType<typeof readConfig>>): string {
  if (!config.aiProvider) return 'local-cli';
  return `${config.aiProvider} (${config.aiModel ?? 'default'})`;
}

async function buildJudgeConfig(
  base: Awaited<ReturnType<typeof readConfig>>,
): Promise<Awaited<ReturnType<typeof readConfig>>> {
  const judgeProvider = process.env.DIFFDAD_JUDGE_PROVIDER as
    | 'anthropic'
    | 'openai'
    | 'openai-compatible'
    | 'ollama'
    | undefined;
  const judgeModel = process.env.DIFFDAD_JUDGE_MODEL;
  const judgeApiKey = process.env.DIFFDAD_JUDGE_API_KEY;
  if (!judgeProvider) return base;
  return {
    ...base,
    aiProvider: judgeProvider,
    aiModel: judgeModel ?? base.aiModel,
    aiApiKey: judgeApiKey ?? base.aiApiKey,
  };
}

async function runOne(
  fixture: EvalFixture,
  narrativeConfig: Awaited<ReturnType<typeof readConfig>>,
  judgeConfig: Awaited<ReturnType<typeof readConfig>>,
): Promise<EvalRun> {
  const errors: string[] = [];
  let provider = describeProvider(narrativeConfig);

  try {
    const result = await generateNarrative(
      fixture.pr,
      fixture.files,
      fixture.fileTree ?? fixture.files.map((f) => f.file),
      narrativeConfig,
    );
    provider = result.provider;
    const proseWordCount = countProseWords(result.narrative);
    let scores = { comprehensiveness: 0, rationality: 0, conciseness: 0, expressiveness: 0 };
    let scoreNotes = '';
    try {
      const judged = await scoreNarrative(result.narrative, fixture, judgeConfig);
      scores = judged.scores;
      scoreNotes = judged.notes;
    } catch (err) {
      errors.push(`judge.scoreNarrative failed: ${(err as Error).message}`);
    }

    let defectDetection = {
      surfaced: 0,
      expected: fixture.groundTruth.expectedConcerns.length,
      detail: [] as { expected: string; surfaced: boolean; evidence?: string }[],
    };
    try {
      defectDetection = await scoreDefectDetection(result.narrative, fixture, judgeConfig);
    } catch (err) {
      errors.push(`judge.scoreDefectDetection failed: ${(err as Error).message}`);
    }

    return {
      fixtureId: fixture.id,
      provider,
      timeToFirstPartialMs: result.timeToFirstPartialMs,
      totalMs: result.totalMs,
      proseWordCount,
      scores,
      scoreNotes,
      defectDetection,
      hasConcerns: result.narrative.concerns.length > 0,
      chaptersOrderedByRisk: chaptersOrderedByRisk(result.narrative),
      verdict: result.narrative.verdict,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    return {
      fixtureId: fixture.id,
      provider,
      totalMs: 0,
      proseWordCount: 0,
      scores: { comprehensiveness: 0, rationality: 0, conciseness: 0, expressiveness: 0 },
      scoreNotes: '',
      defectDetection: { surfaced: 0, expected: fixture.groundTruth.expectedConcerns.length, detail: [] },
      hasConcerns: false,
      chaptersOrderedByRisk: false,
      verdict: 'caution',
      errors: [(err as Error).message],
    };
  }
}

function aggregate(runs: EvalRun[]): Baseline['aggregate'] {
  if (runs.length === 0) {
    return {
      avgComprehensiveness: 0,
      avgRationality: 0,
      avgConciseness: 0,
      avgExpressiveness: 0,
      avgTimeToFirstPartialMs: null,
      avgTotalMs: 0,
      avgProseWordCount: 0,
      avgDefectRecall: 0,
    };
  }
  const ttfp = runs.filter((r) => typeof r.timeToFirstPartialMs === 'number').map((r) => r.timeToFirstPartialMs!);
  const recall = runs
    .filter((r) => r.defectDetection.expected > 0)
    .map((r) => r.defectDetection.surfaced / r.defectDetection.expected);
  return {
    avgComprehensiveness: avg(runs.map((r) => r.scores.comprehensiveness)),
    avgRationality: avg(runs.map((r) => r.scores.rationality)),
    avgConciseness: avg(runs.map((r) => r.scores.conciseness)),
    avgExpressiveness: avg(runs.map((r) => r.scores.expressiveness)),
    avgTimeToFirstPartialMs: ttfp.length > 0 ? Math.round(avg(ttfp)) : null,
    avgTotalMs: Math.round(avg(runs.map((r) => r.totalMs))),
    avgProseWordCount: Math.round(avg(runs.map((r) => r.proseWordCount))),
    avgDefectRecall: recall.length > 0 ? Number(avg(recall).toFixed(2)) : 0,
  };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

async function main() {
  const args = Bun.argv.slice(2);
  const fixtureFlag = args.find((a) => a.startsWith('--fixture='))?.split('=')[1];
  const outputFlag = args.find((a) => a.startsWith('--output='))?.split('=')[1];
  const outputPath = resolve(outputFlag ?? 'packages/cli/eval-baseline/baseline.json');

  const config = await readConfig();
  const judgeConfig = await buildJudgeConfig(config);

  if (!config.aiProvider) {
    console.warn(
      'warning: no API provider configured. Eval will use the local CLI fallback (no streaming, no latency telemetry).',
    );
  }

  const fixtures = fixtureFlag ? FIXTURES.filter((f) => f.id === fixtureFlag) : FIXTURES;
  if (fixtures.length === 0) {
    console.error(`No fixture matched: ${fixtureFlag}`);
    process.exit(1);
  }

  const runs: EvalRun[] = [];
  for (const fixture of fixtures) {
    process.stdout.write(`\n[${fixture.id}] running... `);
    const t0 = Date.now();
    const run = await runOne(fixture, config, judgeConfig);
    const elapsed = Date.now() - t0;
    runs.push(run);
    const verdictTag = run.verdict;
    const recall =
      run.defectDetection.expected > 0 ? `${run.defectDetection.surfaced}/${run.defectDetection.expected}` : 'n/a';
    process.stdout.write(
      `done in ${(elapsed / 1000).toFixed(1)}s — verdict=${verdictTag} concerns=${run.hasConcerns ? 'y' : 'n'} recall=${recall}\n`,
    );
    const s = run.scores;
    console.log(
      `  scores: comp=${s.comprehensiveness} rat=${s.rationality} con=${s.conciseness} exp=${s.expressiveness}${run.scoreNotes ? `\n  notes: ${run.scoreNotes}` : ''}`,
    );
    if (run.errors?.length) {
      for (const e of run.errors) console.log(`  ! ${e}`);
    }
  }

  const baseline: Baseline = {
    generatedAt: new Date().toISOString(),
    provider: describeProvider(config),
    judgeProvider: describeProvider(judgeConfig),
    runs,
    aggregate: aggregate(runs),
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`\nBaseline written: ${outputPath}`);
  console.log(
    `Aggregate: comp=${baseline.aggregate.avgComprehensiveness.toFixed(2)} rat=${baseline.aggregate.avgRationality.toFixed(2)} con=${baseline.aggregate.avgConciseness.toFixed(2)} exp=${baseline.aggregate.avgExpressiveness.toFixed(2)} recall=${baseline.aggregate.avgDefectRecall} ttfp=${baseline.aggregate.avgTimeToFirstPartialMs ?? 'n/a'}ms total=${baseline.aggregate.avgTotalMs}ms`,
  );
}

void main();
