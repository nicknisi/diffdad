// `callersOf` is a value import; `import-index.ts` pulls in nothing from this module, so there is no
// cycle to worry about here. `RepoContext` stays type-only for the same reason `risk.ts` keeps it
// type-only: `snapshot.ts` imports `import-index.ts`, so a value import would close a runtime cycle.
import type { DiffFile } from '../github/types';
import { callersOf, type ImportIndex } from '../repo/import-index';
import type { RepoContext } from '../repo/snapshot';
import { classifyPath } from './diff-filter';
import { computeRisk, type FileRisk } from './risk';
import type { NarrativeChapter } from './types';

/**
 * Why a chapter is safe to hide by default. A closed union on purpose: every collapse traces to one
 * checkable fact about the files the chapter touches, never to a model-authored justification string.
 *
 * All three members carry a *set* of files rather than one, because the claim has to be true of the
 * whole chapter — a chapter is a set of files, and evidence describing one of thirty of them would be
 * a reason line that reads true and is not. `knownCallers` is spelled "known" deliberately: the import
 * index misses dynamic imports and re-export barrels, so zero is an absence of evidence, not evidence
 * of absence.
 */
export type CollapseEvidence =
  | { kind: 'no-external-callers'; files: string[]; knownCallers: 0 }
  | { kind: 'test-only'; files: string[] }
  | { kind: 'generated'; files: string[] };

export type CollapseDecision = {
  /** Index into narrative.chapters. */
  chapterIndex: number;
  /** One line, shown on the collapsed row. States the fact, not a judgment. */
  reason: string;
  evidence: CollapseEvidence;
};

/**
 * Mirrored from {@link RepoContext} rather than restated, so a fifth unavailable reason added to the
 * snapshot layer becomes a type error here instead of a silently unrenderable value. Phase 1 already
 * shipped a fourth (`empty-tree`: a successful fetch whose tree indexed zero source files) for exactly
 * the case where `filesScanned === 0`.
 */
export type CollapseUnavailableReason = Extract<RepoContext, { available: false }>['reason'];

export type CollapseResult =
  | { available: true; decisions: CollapseDecision[]; dividerBefore: number | null }
  | { available: false; reason: CollapseUnavailableReason };

// Third module-private copy, matching `risk.ts:62` and `hints.ts:24`. House style here is a local copy
// over an export the pure modules would then share by accident.
const TEST_PATTERNS = [/\.test\.[a-z]+$/i, /\.spec\.[a-z]+$/i, /\/__tests__\//, /\/tests?\//];

function isTestPath(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}

function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

/** Distinct normalized file paths a chapter's diff sections point at, in first-appearance order. */
function chapterFiles(chapter: NarrativeChapter): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const section of chapter.sections) {
    if (section.type !== 'diff') continue;
    const file = normalizePath(section.file);
    if (file === '' || seen.has(file)) continue;
    seen.add(file);
    files.push(file);
  }
  return files;
}

/**
 * Signals that disqualify a file from being collapse evidence no matter what the evidence checks say.
 *
 * Evidence answers "why is this boring". The veto answers "is anything here shouting". Both have to
 * hold, and the veto runs first, because the two questions are independent: a brand-new auth module
 * has zero known callers for the trivial reason that it did not exist on the base branch, and reading
 * that as low blast radius hides the single most important file in the PR.
 *
 * - **Criticality keywords** — `risk.ts` already tags auth, crypto, payment, migration, permission,
 *   token, session, database, config and infra paths. A file in one of those areas is never quiet.
 * - **A test gap** — a substantive change with no test following it is the opposite of "safe to skim",
 *   and it is also the signal that catches the new-file tautology above (a new module of real size has
 *   no adjacent test in the same PR).
 * - **No risk entry at all** — the caller computed risks over a different file set than the narrative
 *   covers. Unknown is not quiet.
 *
 * Applied uniformly to all three evidence kinds rather than only to the caller check. The asymmetry
 * the whole feature rests on is that leaving something expanded costs attention while hiding something
 * costs correctness, and one uniform rule is verifiable in a way three rules with exceptions are not.
 */
function isVetoed(file: string, riskByFile: Map<string, FileRisk>): boolean {
  const risk = riskByFile.get(file);
  if (!risk) return true;
  if (risk.criticality.length > 0) return true;
  if (risk.testGap) return true;
  return false;
}

function evidenceFor(files: string[], index: ImportIndex, changedFiles: Set<string>): CollapseEvidence | null {
  if (files.every(isTestPath)) return { kind: 'test-only', files };
  if (files.every((f) => classifyPath(f) !== null)) return { kind: 'generated', files };
  // `changedFiles` as the exclude set is what turns total centrality into *unchanged* callers, which is
  // the number a "nothing else depends on this" claim actually rests on. `risk.ts` deliberately passes
  // an empty set for its centrality score; that number is not usable here.
  if (files.every((f) => callersOf(index, f, changedFiles).length === 0)) {
    return { kind: 'no-external-callers', files, knownCallers: 0 };
  }
  return null;
}

function describeEvidence(evidence: CollapseEvidence): string {
  const count = evidence.files.length;
  switch (evidence.kind) {
    case 'no-external-callers':
      return count === 1
        ? `${evidence.files[0]} has 0 known callers outside this PR`
        : `${count} files, 0 known callers outside this PR`;
    case 'test-only':
      return count === 1 ? `${evidence.files[0]} is a test file` : `${count} test files, no source files`;
    case 'generated':
      return count === 1 ? `${evidence.files[0]} is generated or vendored` : `${count} generated or vendored files`;
  }
}

/**
 * Where the single collapse divider goes, or `null` for no divider and no chrome at all.
 *
 * The spec's rule is "the lowest collapsed index", which assumes the collapsed chapters form a run at
 * the end of the list. Nothing enforces that: risk-descending chapter order is a prompt instruction
 * (`prompt.ts`) that `eval/judge.ts` records rather than asserts, and collapse evidence is orthogonal
 * to the model's risk label anyway — a caller-free chapter can land at index 1 with a high-risk chapter
 * at index 3. Drawing one divider at index 1 would then render an expanded chapter below the collapsed
 * boundary, which is worse than drawing nothing.
 *
 * So: the lowest collapsed index when the collapsed set is a contiguous suffix, `null` otherwise.
 * `decisions` remains authoritative for *which* chapters collapse; this is only the rendering hint,
 * and it exists only when one line can honestly represent the boundary.
 */
function resolveDivider(decisions: CollapseDecision[], chapterCount: number): number | null {
  if (decisions.length === 0) return null;
  const collapsed = new Set(decisions.map((d) => d.chapterIndex));
  const lowest = Math.min(...collapsed);
  for (let i = lowest; i < chapterCount; i++) {
    if (!collapsed.has(i)) return null;
  }
  return lowest;
}

/**
 * Which chapters are safe to hide by default, and why.
 *
 * Pure and synchronous by design. Everything it reads is already computed by the time a narrative is
 * served, so the decision is made per request and never persisted — `narrativeCachePath()` carries no
 * repo-state component, so a narrative generated while the snapshot was cold would otherwise keep
 * collapsing nothing at that SHA forever.
 *
 * A chapter collapses only when *every* file it touches supports the same piece of evidence. Mixed
 * chapters stay open.
 */
export function selectCollapsible(chapters: NarrativeChapter[], risks: FileRisk[], repo: RepoContext): CollapseResult {
  // Unavailable short-circuits before any evidence is considered. Collapse is never a guess.
  if (!repo.available) return { available: false, reason: repo.reason };
  // An index that scanned nothing means the walk failed, not that nothing imports anything. Phase 1
  // maps that to `available: false` upstream; if it arrives here anyway, produce no decisions rather
  // than reading an empty map as universal certainty. It disables the other two evidence kinds too:
  // answering some of a narrative's chapters from a broken index is how a partial failure reads as a
  // complete answer.
  if (repo.index.filesScanned === 0) return { available: true, decisions: [], dividerBefore: null };

  const riskByFile = new Map(risks.map((r) => [normalizePath(r.file), r]));
  const changedFiles = new Set(risks.map((r) => normalizePath(r.file)));

  const decisions: CollapseDecision[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    const files = chapterFiles(chapter);
    // A chapter with no diff sections (a placeholder, or prose only) would satisfy "every file agrees"
    // vacuously, and no member of `CollapseEvidence` is constructible from zero files.
    if (files.length === 0) return;
    if (files.some((f) => isVetoed(f, riskByFile))) return;
    const evidence = evidenceFor(files, repo.index, changedFiles);
    if (!evidence) return;
    decisions.push({ chapterIndex, reason: describeEvidence(evidence), evidence });
  });

  return { available: true, decisions, dividerBefore: resolveDivider(decisions, chapters.length) };
}

/**
 * What both servers call per request: risks and collapse in one step.
 *
 * `selectCollapsible` takes `risks` because it is pure and testable that way, but no caller has a
 * `FileRisk[]` lying around — `NarrativePrompt.risks` is returned and never read, and the two serve
 * paths (`/api/narrative`, `GET /api/units/:id`) hold only the diff. Deriving risks here rather than at
 * each call site is what keeps the CLI review and the daemon drill-in from collapsing differently for
 * the same PR.
 */
export function resolveCollapse(chapters: NarrativeChapter[], files: DiffFile[], repo: RepoContext): CollapseResult {
  return selectCollapsible(chapters, computeRisk(files, repo), repo);
}

/** How many caller paths ride along per chapter before the rest become a count. */
export const CALLER_LIST_CAP = 6;

/**
 * Unchanged repository files that import a chapter's files — the blast radius as an argument for
 * *reading* a chapter, the mirror image of the collapse evidence.
 *
 * Same index and same exclude set as `evidenceFor`, so the two can never disagree: a chapter with
 * `no-external-callers` evidence necessarily reports `total: 0` here and renders nothing. Capped at
 * {@link CALLER_LIST_CAP} with `total` kept whole, because a module with 200 importers must state the
 * number without pasting 200 paths into a chapter.
 */
export type ChapterCallers = {
  chapterIndex: number;
  /** Up to {@link CALLER_LIST_CAP} caller paths, in index order. */
  callers: string[];
  /** How many unchanged callers exist in total (`callers.length` is a capped view of this). */
  total: number;
};

export function chapterCallers(chapters: NarrativeChapter[], files: DiffFile[], repo: RepoContext): ChapterCallers[] {
  if (!repo.available || repo.index.filesScanned === 0) return [];
  const changedFiles = new Set(files.map((f) => normalizePath(f.file)));
  const out: ChapterCallers[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    const seen = new Set<string>();
    for (const file of chapterFiles(chapter)) {
      for (const caller of callersOf(repo.index, file, changedFiles)) seen.add(caller);
    }
    if (seen.size === 0) return;
    const all = [...seen];
    out.push({ chapterIndex, callers: all.slice(0, CALLER_LIST_CAP), total: all.length });
  });
  return out;
}

/**
 * Total diff lines the narrative puts in front of a reader, summed over diff sections.
 *
 * The unit compression is measured in, because chapter counts are gameable — collapsing many tiny
 * chapters while the two open ones still hold most of the code would score well and save nobody any
 * reading. Ranges are clamped at zero: section line numbers are model-authored and validated only as
 * numbers, never for ordering, so one reversed range must not subtract from the total.
 */
export function narratedDiffLines(chapters: NarrativeChapter[]): number {
  let total = 0;
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      if (section.type !== 'diff') continue;
      total += Math.max(0, section.endLine - section.startLine + 1);
    }
  }
  return total;
}
