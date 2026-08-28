/**
 * Type-level drift guards. Each assertion fails `tsc` if a contracts z.infer type stops matching the
 * canonical CLI type it mirrors. Imports are `import type` only — no runtime coupling, no dependency
 * from contracts onto @diffdad/cli.
 *
 * Where the contracts type is intentionally wider than the CLI type (the `chapterIndices` fix), mutual
 * equality is impossible, so a one-way / mutual-assignability check is used with a note.
 */
import type {
  Callout as CCallout,
  Concern as CConcern,
  ConcernCategory as CConcernCategory,
  NarrativeChapter as CNarrativeChapter,
  NarrativeResponse as CNarrativeResponse,
  NarrativeSection as CNarrativeSection,
  ReadingPlanStep as CReadingPlanStep,
  ReshowEntry as CReshowEntry,
} from '../../cli/src/narrative/types';
import type {
  CheckRun as CCheckRun,
  DiffFile as CDiffFile,
  DiffHunk as CDiffHunk,
  DiffLine as CDiffLine,
  PRComment as CPRComment,
  PRMetadata as CPRMetadata,
  PRReview as CPRReview,
} from '../../cli/src/github/types';
import type { HunkRef as CHunkRef, Plan as CPlan, PlanTheme as CPlanTheme } from '../../cli/src/narrative/plan-types';
import type {
  Blocker as CBlocker,
  Decision as CDecision,
  HelpSuggestion as CHelpSuggestion,
  RecapResponse as CRecapResponse,
} from '../../cli/src/recap/types';
import type {
  Blocker,
  Callout,
  CheckRun,
  Concern,
  ConcernCategory,
  Decision,
  DiffFile,
  DiffHunk,
  DiffLine,
  HelpSuggestion,
  HunkRef,
  NarrativeChapter,
  NarrativeResponse,
  NarrativeSection,
  Plan,
  PlanTheme,
  PRComment,
  PRCommentBase,
  PRMetadata,
  PRReview,
  ReadingPlanStep,
  RecapResponse,
  ReshowEntry,
} from './index';

/** True only when A and B are structurally identical. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** True when A and B are mutually assignable (looser than {@link Equal}). */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

// narrative/types.ts — exact equality
type _Narrative = Expect<Equal<NarrativeResponse, CNarrativeResponse>>;
type _ReadingPlanStep = Expect<Equal<ReadingPlanStep, CReadingPlanStep>>;
type _Concern = Expect<Equal<Concern, CConcern>>;
type _ConcernCategory = Expect<Equal<ConcernCategory, CConcernCategory>>;
type _Callout = Expect<Equal<Callout, CCallout>>;
type _NarrativeChapter = Expect<Equal<NarrativeChapter, CNarrativeChapter>>;
type _ReshowEntry = Expect<Equal<ReshowEntry, CReshowEntry>>;
type _NarrativeSection = Expect<Equal<NarrativeSection, CNarrativeSection>>;

// github/types.ts — exact equality
type _PRMetadata = Expect<Equal<PRMetadata, CPRMetadata>>;
type _DiffFile = Expect<Equal<DiffFile, CDiffFile>>;
type _DiffHunk = Expect<Equal<DiffHunk, CDiffHunk>>;
type _DiffLine = Expect<Equal<DiffLine, CDiffLine>>;
type _PRReview = Expect<Equal<PRReview, CPRReview>>;
type _CheckRun = Expect<Equal<CheckRun, CCheckRun>>;

// PRComment: the base shape equals the CLI type exactly...
type _PRCommentBase = Expect<Equal<PRCommentBase, CPRComment>>;
// ...but the exported PRComment intentionally adds `chapterIndices?: number[]` (the server appends it in
// mapCommentsToChapters, yet the CLI's PRComment never declared it — the documented drift bug). Exact
// equality is therefore impossible; assert mutual assignability instead. The CLI comment is a valid
// contracts comment (extra field optional) and vice versa, so no consumer breaks either direction.
type _PRComment = Expect<MutuallyAssignable<PRComment, CPRComment>>;

// narrative/plan-types.ts — exact equality
type _Plan = Expect<Equal<Plan, CPlan>>;
type _PlanTheme = Expect<Equal<PlanTheme, CPlanTheme>>;
type _HunkRef = Expect<Equal<HunkRef, CHunkRef>>;

// recap/types.ts — exact equality
type _Recap = Expect<Equal<RecapResponse, CRecapResponse>>;
type _Decision = Expect<Equal<Decision, CDecision>>;
type _Blocker = Expect<Equal<Blocker, CBlocker>>;
type _HelpSuggestion = Expect<Equal<HelpSuggestion, CHelpSuggestion>>;
