export const copy = {
  tagline: 'Measure twice, merge once.',
  altTagline: "I'm not mad, just diff-appointed.",
  valueProp: 'diff.dad keeps PRs on the happy path with simple, semantic reviews that cut through noise.',

  // Loading — rotate through these
  loadingMessages: [
    "Reading the diff so you don't have to...",
    'Putting on my reading glasses...',
    'Asking the code what it means...',
    'Organizing the chapters...',
    'Finding the story in the diff...',
    'Measure twice, merge once...',
  ],

  emptyState: 'Go make a diff-erence.',
  inlineHint: 'Use your comment sense.',
  commentPlaceholder: 'Use your comment sense... (Cmd/Ctrl+Enter to submit)',
  askAiPlaceholder: 'Ask dad anything about this code...',
  approvalToast: 'Proud of you, champ. Approved.',
  commentToast: 'Review submitted to GitHub.',
  requestChangesToast: "Changes requested. You'll get 'em next time.",
  warning: 'Not on my branch.',
  blocker: 'Grounded until tests pass.',
  nudge: 'Measure twice, commit once.',
  errorGeneric: 'Something went sideways. Try again?',
  offline: 'Not on my branch. Check your connection.',
  allReviewed: 'Every chapter reviewed. Proud of you, champ.',
  noDrafts: 'No pending comments. Clean slate.',
  shortcutsFooter: 'Measure twice, commit once.',
  brandTooltip: "I'm not mad, just diff-appointed.",
} as const;
