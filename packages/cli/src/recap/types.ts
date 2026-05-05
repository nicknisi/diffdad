export type RecapResponse = {
  /** 1-sentence statement of the goal of this work. */
  goal: string;
  stateOfPlay: {
    done: string[];
    wip: string[];
    notStarted: string[];
  };
  decisions: Decision[];
  blockers: Blocker[];
  mentalModel: {
    /** New files that constitute the feature. */
    coreFiles: string[];
    /** Existing files modified to integrate the feature. */
    touchpoints: string[];
    /** Plain-text labeled box-and-arrow sketch (multi-line). */
    sketch: string;
  };
  howToHelp: HelpSuggestion[];
};

export type DecisionSourceType = 'commit' | 'thread' | 'pr-body' | 'force-push' | 'issue';

export type Decision = {
  /** Short imperative summary of the decision made. */
  decision: string;
  /** 1 sentence on why. */
  reason: string;
  source: { type: DecisionSourceType; ref: string };
  alternativesRuledOut?: string[];
};

export type BlockerType = 'ci' | 'review-question' | 'thrash' | 'todo';

export type Blocker = {
  /** Short statement of the blocker. */
  issue: string;
  /** Concrete pointer: file:line, check name, comment author, etc. */
  evidence: string;
  type: BlockerType;
};

export type HelpSuggestion = {
  suggestion: string;
  why: string;
};

const DECISION_SOURCE_TYPES: DecisionSourceType[] = ['commit', 'thread', 'pr-body', 'force-push', 'issue'];
const BLOCKER_TYPES: BlockerType[] = ['ci', 'review-question', 'thrash', 'todo'];

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function normalizeDecision(input: unknown): Decision | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const decision = asString(obj.decision);
  if (decision.length === 0) return null;
  const src = (obj.source ?? {}) as Record<string, unknown>;
  const type = DECISION_SOURCE_TYPES.includes(src.type as DecisionSourceType)
    ? (src.type as DecisionSourceType)
    : 'commit';
  return {
    decision,
    reason: asString(obj.reason),
    source: { type, ref: asString(src.ref) },
    alternativesRuledOut: asStringArray(obj.alternativesRuledOut),
  };
}

function normalizeBlocker(input: unknown): Blocker | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const issue = asString(obj.issue);
  if (issue.length === 0) return null;
  const type = BLOCKER_TYPES.includes(obj.type as BlockerType) ? (obj.type as BlockerType) : 'todo';
  return {
    issue,
    evidence: asString(obj.evidence),
    type,
  };
}

function normalizeHelp(input: unknown): HelpSuggestion | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const suggestion = asString(obj.suggestion);
  if (suggestion.length === 0) return null;
  return { suggestion, why: asString(obj.why) };
}

export function normalizeRecap(input: unknown): RecapResponse {
  const obj = (input ?? {}) as Record<string, unknown>;
  const sop = (obj.stateOfPlay ?? {}) as Record<string, unknown>;
  const mm = (obj.mentalModel ?? {}) as Record<string, unknown>;
  return {
    goal: asString(obj.goal),
    stateOfPlay: {
      done: asStringArray(sop.done),
      wip: asStringArray(sop.wip),
      notStarted: asStringArray(sop.notStarted),
    },
    decisions: Array.isArray(obj.decisions)
      ? obj.decisions.map(normalizeDecision).filter((d): d is Decision => d !== null)
      : [],
    blockers: Array.isArray(obj.blockers)
      ? obj.blockers.map(normalizeBlocker).filter((b): b is Blocker => b !== null)
      : [],
    mentalModel: {
      coreFiles: asStringArray(mm.coreFiles),
      touchpoints: asStringArray(mm.touchpoints),
      sketch: asString(mm.sketch),
    },
    howToHelp: Array.isArray(obj.howToHelp)
      ? obj.howToHelp.map(normalizeHelp).filter((h): h is HelpSuggestion => h !== null)
      : [],
  };
}
