export type DecisionSourceType = 'commit' | 'thread' | 'pr-body' | 'force-push' | 'issue';

export type Decision = {
  decision: string;
  reason: string;
  source: { type: DecisionSourceType; ref: string };
  alternativesRuledOut?: string[];
};

export type BlockerType = 'ci' | 'review-question' | 'thrash' | 'todo';

export type Blocker = {
  issue: string;
  evidence: string;
  type: BlockerType;
};

export type HelpSuggestion = {
  suggestion: string;
  why: string;
};

export type RecapResponse = {
  goal: string;
  stateOfPlay: {
    done: string[];
    wip: string[];
    notStarted: string[];
  };
  decisions: Decision[];
  blockers: Blocker[];
  mentalModel: {
    coreFiles: string[];
    touchpoints: string[];
    sketch: string;
  };
  howToHelp: HelpSuggestion[];
};
