import type { NarrativeResponse } from './types';

/** The reviewer-facing inputs that shape a review-summary draft (mirrors the dialog's payload). */
export type ReviewSummaryInput = {
  resolution?: 'comment' | 'approve' | 'request_changes';
  reviewedChapters?: number[];
  pendingComments?: { path?: string; line?: number; body?: string }[];
  /** When present, we polish the reviewer's own draft instead of generating from scratch. */
  userDraft?: string;
};

/**
 * Build the system + user prompts for an AI review-summary draft from a narrative and the reviewer's
 * progress. Pure (no I/O) so it's identical for PR mode (`server.ts`) and the daemon's unit-scoped
 * route — the one prompt definition both share, so a tweak can't drift between the two surfaces.
 */
export function buildReviewSummaryPrompt(
  narrative: NarrativeResponse,
  input: ReviewSummaryInput,
): { systemPrompt: string; userPrompt: string } {
  const resolution = input.resolution ?? 'comment';
  const reviewed = Array.isArray(input.reviewedChapters)
    ? input.reviewedChapters.filter((i): i is number => typeof i === 'number')
    : [];
  const drafts = Array.isArray(input.pendingComments) ? input.pendingComments : [];

  const reviewedSection =
    reviewed.length > 0
      ? reviewed
          .map((idx) => {
            const ch = narrative.chapters[idx];
            if (!ch) return '';
            return `- Chapter ${idx + 1} — ${ch.title}: ${ch.summary}`;
          })
          .filter(Boolean)
          .join('\n')
      : '(no chapters explicitly marked reviewed)';

  const draftSection =
    drafts.length > 0
      ? drafts
          .filter((d) => d.body)
          .map((d) => `- ${d.path ?? 'general'}${d.line ? `:L${d.line}` : ''} — ${(d.body ?? '').slice(0, 240)}`)
          .join('\n')
      : '(no inline comments drafted)';

  const tldr = narrative.tldr ?? '';
  const concerns = (narrative.concerns ?? [])
    .map((cn) => `- ${cn.category}: ${cn.question} (${cn.file}:${cn.line})`)
    .join('\n');

  const stance =
    resolution === 'approve'
      ? 'You are approving this PR. Open with confident endorsement, then briefly highlight the strengths the reviewer noted. If there are any minor comments, frame them as nits, not blockers.'
      : resolution === 'request_changes'
        ? 'You are requesting changes. Lead with the specific blockers the reviewer raised (drawn from inline comments). Be direct but constructive.'
        : 'You are leaving general feedback without a verdict. Summarize what was reviewed and the open questions the reviewer raised.';

  const userDraft = typeof input.userDraft === 'string' ? input.userDraft.trim() : '';
  const polishing = userDraft.length > 0;

  // When the reviewer has already typed something, preserve their voice and points; we polish their
  // draft. Otherwise, generate from scratch.
  const systemPrompt = polishing
    ? `You are polishing a reviewer's draft of a GitHub PR review summary. ${stance} Keep the reviewer's voice, structure, and any specific points they made. Tighten prose, fix grammar, and fold in 1–2 supporting details from the review context only if they directly reinforce what the reviewer wrote — do not introduce unrelated topics. Return only the polished text. 2–4 sentences. First-person ("I"). Plain markdown. No headings. No bullet lists. No greetings or sign-offs.`
    : `You are drafting the summary comment for a GitHub PR review. ${stance} Write 2–4 sentences. First-person ("I"). Plain markdown. No headings. No bullet lists. No greetings or sign-offs.`;
  const userPrompt = polishing
    ? `Reviewer's draft (polish this — preserve their voice and points):\n"""\n${userDraft}\n"""\n\nReview context (use only for grammar/wording cues; do not introduce new topics):\n\nPR TLDR:\n${tldr}\n\nReviewed chapters:\n${reviewedSection}\n\nDrafted inline comments:\n${draftSection}\n\nConcerns the narrative raised:\n${concerns || '(none)'}`
    : `PR TLDR:\n${tldr}\n\nReviewed chapters:\n${reviewedSection}\n\nDrafted inline comments:\n${draftSection}\n\nConcerns the narrative raised:\n${concerns || '(none)'}`;

  return { systemPrompt, userPrompt };
}
