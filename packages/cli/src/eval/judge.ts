import { callAi } from '../narrative/engine';
import type { DiffDadConfig } from '../config';
import type { NarrativeResponse } from '../narrative/types';
import type { DefectDetectionResult, EvalFixture, RubricScores } from './types';

const JUDGE_SYSTEM = `You are a strict code-review-quality judge. You evaluate AI-generated PR review narratives against ground truth.

Use this 4-axis rubric (1-5 each, integer):

- COMPREHENSIVENESS: did the narrative cover the meaningful changes? Penalize if it missed major behavior changes the diff makes. (1=missed most, 5=covered all material changes)
- RATIONALITY: did each chapter explain WHY (whyMatters) the change matters, not just describe WHAT? Penalize "describes the code" output. (1=mostly describes, 5=consistently explains consequences)
- CONCISENESS: tight prose, no padding, no repetition? Penalize bloated narration with low insight density. (1=very padded, 5=very tight)
- EXPRESSIVENESS: clear, specific, well-anchored to file:line? Penalize vague "it does several things" prose. (1=vague, 5=specific and anchored)

Return ONLY this JSON, no markdown fences, no prose:
{
  "comprehensiveness": <1-5>,
  "rationality": <1-5>,
  "conciseness": <1-5>,
  "expressiveness": <1-5>,
  "notes": "<2-3 sentences explaining the lowest score>"
}`;

const DEFECT_DETECTION_SYSTEM = `You are evaluating whether an AI code-review narrative surfaced specific expected concerns.

For EACH expected concern, decide if the narrative addressed it (in tldr, readingPlan, concerns array, missing array, chapter whyMatters, callouts, or section narration).

Return ONLY this JSON:
{
  "results": [
    { "expected": "<expected concern verbatim>", "surfaced": <true|false>, "evidence": "<short quote from narrative if surfaced, otherwise empty string>" }
  ]
}`;

function summarizeNarrative(narrative: NarrativeResponse): string {
  const parts: string[] = [];
  parts.push(`title: ${narrative.title}`);
  parts.push(`tldr: ${narrative.tldr}`);
  parts.push(`verdict: ${narrative.verdict}`);
  if (narrative.readingPlan.length) {
    parts.push('readingPlan:');
    for (const step of narrative.readingPlan) {
      parts.push(
        `  - ${step.step}${typeof step.chapterIndex === 'number' ? ` (-> ch${step.chapterIndex})` : ''}${step.why ? ` :: ${step.why}` : ''}`,
      );
    }
  }
  if (narrative.concerns.length) {
    parts.push('concerns:');
    for (const c of narrative.concerns) {
      parts.push(`  - [${c.category}] ${c.file}:${c.line} — ${c.question} (why: ${c.why})`);
    }
  }
  parts.push('chapters:');
  narrative.chapters.forEach((ch, i) => {
    parts.push(`  ch${i}: [${ch.risk}] ${ch.title}`);
    parts.push(`    summary: ${ch.summary}`);
    parts.push(`    whyMatters: ${ch.whyMatters}`);
    if (ch.callouts?.length) {
      for (const co of ch.callouts) {
        parts.push(`    callout[${co.level}]: ${co.file}:${co.line} — ${co.message}`);
      }
    }
    for (const s of ch.sections) {
      if (s.type === 'narrative') {
        parts.push(`    narrative: ${s.content}`);
      } else {
        parts.push(`    diff-ref: ${s.file}:${s.startLine}-${s.endLine}`);
      }
    }
  });
  if (narrative.missing?.length) {
    parts.push('missing:');
    for (const m of narrative.missing) parts.push(`  - ${m}`);
  }
  return parts.join('\n');
}

function summarizeFixture(fixture: EvalFixture): string {
  const parts: string[] = [];
  parts.push(`PR: ${fixture.pr.title} (#${fixture.pr.number})`);
  parts.push(`Description: ${fixture.pr.body || '(none)'}`);
  parts.push(`Files changed: ${fixture.files.length}`);
  for (const f of fixture.files) {
    const churn = f.hunks.reduce(
      (acc, h) => acc + h.lines.filter((l) => l.type === 'add' || l.type === 'remove').length,
      0,
    );
    parts.push(`  - ${f.file} (${churn} churn)`);
  }
  parts.push(`Ground-truth concerns:`);
  for (const c of fixture.groundTruth.expectedConcerns) parts.push(`  - ${c}`);
  return parts.join('\n');
}

function tryParseJson<T>(text: string): T | null {
  const trimmed = text.trim();
  let s = trimmed;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export async function scoreNarrative(
  narrative: NarrativeResponse,
  fixture: EvalFixture,
  config: DiffDadConfig,
): Promise<{ scores: RubricScores; notes: string }> {
  const user = [
    'Fixture summary:',
    summarizeFixture(fixture),
    '',
    'Narrative under evaluation:',
    summarizeNarrative(narrative),
  ].join('\n');

  const result = await callAi(config, JUDGE_SYSTEM, user, 1024);
  const parsed = tryParseJson<{
    comprehensiveness: number;
    rationality: number;
    conciseness: number;
    expressiveness: number;
    notes?: string;
  }>(result.text);

  if (!parsed) {
    throw new Error(`Judge returned unparseable response: ${result.text.slice(0, 200)}`);
  }

  const clamp = (n: unknown): number => {
    const v = typeof n === 'number' ? n : Number(n);
    if (Number.isNaN(v)) return 1;
    return Math.max(1, Math.min(5, Math.round(v)));
  };

  return {
    scores: {
      comprehensiveness: clamp(parsed.comprehensiveness),
      rationality: clamp(parsed.rationality),
      conciseness: clamp(parsed.conciseness),
      expressiveness: clamp(parsed.expressiveness),
    },
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}

export async function scoreDefectDetection(
  narrative: NarrativeResponse,
  fixture: EvalFixture,
  config: DiffDadConfig,
): Promise<DefectDetectionResult> {
  if (fixture.groundTruth.expectedConcerns.length === 0) {
    return { surfaced: 0, expected: 0, detail: [] };
  }

  const expectedList = fixture.groundTruth.expectedConcerns.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const user = [
    'Expected concerns:',
    expectedList,
    '',
    'Narrative under evaluation:',
    summarizeNarrative(narrative),
  ].join('\n');

  const result = await callAi(config, DEFECT_DETECTION_SYSTEM, user, 1024);
  const parsed = tryParseJson<{ results?: { expected: string; surfaced: boolean; evidence?: string }[] }>(result.text);

  type DetailEntry = { expected: string; surfaced: boolean; evidence?: string };
  const detail: DetailEntry[] = (parsed?.results ?? []).map((r) => ({
    expected: typeof r.expected === 'string' ? r.expected : '',
    surfaced: Boolean(r.surfaced),
    evidence: typeof r.evidence === 'string' ? r.evidence : undefined,
  }));

  // If the judge omitted any expected concerns, fill them in as not-surfaced.
  const expectedSet = new Map(detail.map((d) => [d.expected, d]));
  for (const exp of fixture.groundTruth.expectedConcerns) {
    if (!expectedSet.has(exp)) detail.push({ expected: exp, surfaced: false });
  }

  return {
    surfaced: detail.filter((d) => d.surfaced).length,
    expected: fixture.groundTruth.expectedConcerns.length,
    detail,
  };
}

export function countProseWords(narrative: NarrativeResponse): number {
  const chunks: string[] = [narrative.tldr];
  for (const step of narrative.readingPlan) {
    chunks.push(step.step);
    if (step.why) chunks.push(step.why);
  }
  for (const c of narrative.concerns) chunks.push(c.question, c.why);
  for (const ch of narrative.chapters) {
    chunks.push(ch.summary, ch.whyMatters);
    for (const s of ch.sections) if (s.type === 'narrative') chunks.push(s.content);
    if (ch.callouts) for (const co of ch.callouts) chunks.push(co.message);
  }
  if (narrative.missing) chunks.push(...narrative.missing);
  return chunks
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export function chaptersOrderedByRisk(narrative: NarrativeResponse): boolean {
  const score = (r: 'low' | 'medium' | 'high') => (r === 'high' ? 3 : r === 'medium' ? 2 : 1);
  let prev = Infinity;
  for (const ch of narrative.chapters) {
    const s = score(ch.risk);
    if (s > prev) return false;
    prev = s;
  }
  return true;
}
