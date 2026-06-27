# Implementation Spec: Diff Dad Review Loop - Phase 3

**Contract**: ./contract.md
**Estimated Effort**: M

## Technical Approach

Phase 3 replaces the same-model triage pass with an independent, **cross-family skeptic**: a reviewer pass over a unit's diff slice run on a _non-author_ model. Default is `--with codex` (the local Codex CLI — GPT-class, no API key, reuses your existing setup); the alternative is a configured OpenAI API provider. It emits a structured verdict (`safe | caution | risky`) plus cited, **confidence-scored** concerns. Those concerns become the walkthrough's resolve items and rail flags (Phase 1's `buildWalkthrough` already consumes a `concerns` shape) and drive the command-center recommended action (Phase 2).

The existing triage pass (`triage/triage.ts`) is ~80% of this already — the same diff-render-and-tolerant-parse discipline — so Phase 3 evolves it rather than starting over: add a cross-model provider, a verdict, and per-concern confidence, and feed the agent's stated `intent`/`uncertainties` (from `submit_for_review`) so the skeptic reviews _against stated intent_, not in a vacuum.

Key decisions: the skeptic MUST run on a different family than the author (author = `claude -p` by default; skeptic = `codex` via the existing `callCodex` in `ai-runtime.ts`) — record both provider strings and assert they differ; reuse triage's `renderDiffForTriage` + tolerant JSON parse + hallucinated-path drop; keep it a single bounded call (cost/latency) with the same diff cap as triage.

## Feedback Strategy

**Inner-loop command**: `cd packages/cli && npx vitest run src/skeptic/__tests__/skeptic.test.ts`

**Playground**: Vitest over fixture model outputs (parse → validate → verdict derivation; provider-family assertion).

**Why this approach**: The skeptic is a parse-and-validate pass; like triage, its logic is pure-function testable against captured model output, no live model needed in the loop.

## File Changes

### New Files

| File Path                                            | Purpose                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/cli/src/skeptic/skeptic.ts`                | `runSkeptic(files, unitContext, config)` → forced non-author provider → `{ verdict, concerns[] }`. |
| `packages/cli/src/skeptic/prompt.ts`                 | The skeptic system prompt (independent-reviewer framing; reviews against stated intent).           |
| `packages/cli/src/skeptic/__tests__/skeptic.test.ts` | Parse, validate, verdict derivation, provider-family assertion, confidence gating.                 |

### Modified Files

| File Path                                  | Changes                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/narrative/ai-runtime.ts` | Add a forced-provider path for the skeptic: `--with codex` already routes to `callCodex`; add a config-provider override so an OpenAI **API** skeptic is reachable (it is _not_ via `--with`). |
| `packages/web/src/lib/walkthrough.ts` (P1) | Source resolve items + rail flags from the skeptic's concerns, replacing the same-model triage flags.                                                                                          |
| `packages/cli/src/daemon/daemon.ts` (P2)   | Run the skeptic in the review worker; attach `{ verdict, concerns }` to the unit's brief; derive `toResolve` + recommended action.                                                             |
| `packages/cli/src/triage/triage.ts`        | Either generalize into the skeptic, or retire as the _unit_ flag source while keeping it for watch mode's continuous cheap pass (decision in Open Items).                                      |

## Implementation Details

### 1. The skeptic pass

**Pattern to follow**: `packages/cli/src/triage/triage.ts` (`renderDiffForTriage`, `parseTriageFlags`, bounded `callAi`, `resolveFile` for hallucinated paths).

```typescript
type SkepticConcern = {
  severity: 'risk' | 'warn' | 'info';
  message: string;
  file: string;
  line?: number;
  confidence: number; // 0..1
};
type SkepticResult = { verdict: 'safe' | 'caution' | 'risky'; concerns: SkepticConcern[]; provider: string };

function runSkeptic(
  files: DiffFile[],
  unit: { intent: string; uncertainties: string[] },
  config: DiffDadConfig,
): Promise<SkepticResult>;
```

**Key decisions**:

- Prompt = diff (capped, like triage's 24k) + the agent's stated `intent` and `uncertainties` as review context → the skeptic checks whether the change _does what the agent claimed_ and probes the uncertainties it flagged.
- Verdict derivation: `risky` if any high-confidence `risk`; `caution` if any `warn`/low-confidence risk; `safe` if none. Confidence gates noise (drop low-confidence `info`).
- Validate like `parseTriageFlags`: drop malformed items + hallucinated file paths (`resolveFile`).

**Feedback loop**:

- **Playground**: `skeptic.test.ts` over captured fixture outputs.
- **Experiment**: a clean diff → `safe`, 0 concerns; a planted risk → `risky` with a high-confidence concern; a hallucinated path → dropped; assert recorded `provider` family != author.
- **Check command**: `cd packages/cli && npx vitest run src/skeptic/__tests__/skeptic.test.ts`.

### 2. Cross-family provider selection

**Pattern to follow**: `ai-runtime.ts` `callCodex` (exists), `resolveAiPath`, the `--with` override.

**Key decisions**:

- The skeptic resolves a provider **independent of the author**: default `codex` (local, GPT-class) via the local-CLI path; or a config API provider (`aiProvider`/`aiApiKey`) for OpenAI.
- **Critic-caught constraint**: `--with` resolves only to local CLIs (`claude`/`codex`/`pi`) — to use the OpenAI _API_, use a config provider override, **not** `--with`.
- Record the provider string (`callAi` already returns `provider`) and assert its family differs from the author's.

### 3. Wire into the walkthrough + recommended action

**Key decisions**:

- The skeptic's `concerns` become `buildWalkthrough`'s `ResolveItem`s (Phase 1) and the rail flags — **replacing** the same-model triage as the flag source.
- `verdict` + `toResolve` derive the recommended action (`APPROVE` if `safe` + 0 to resolve; `FIX` if `risky`/high-confidence; `LOOK` between) in one shared place, consumed by both the rail (P1) and the command-center row (P2).

## Testing Requirements

### Unit Tests

| Test File                                            | Coverage                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/skeptic/__tests__/skeptic.test.ts` | Parse, validate, verdict derivation, confidence gating, hallucinated-path drop, provider-family assertion. |

**Key cases**: clean diff → safe/0; planted high-confidence risk → risky; low-confidence info → dropped; author family == skeptic family → loud warning.

### Manual

- [ ] Submit a unit with a planted issue → the skeptic (codex) flags it with a confidence-scored concern; verdict `caution`/`risky`; the rail shows the flag and the row shows `FIX`.

## Error Handling

| Error Scenario                                    | Handling Strategy                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Skeptic provider unavailable (no `codex`, no key) | Fall back to same-model triage with a "not cross-model" note on the brief; never block the review. |
| Malformed skeptic JSON                            | Tolerant parse (like `parseTriageFlags`); drop bad items; empty → `safe` with a note.              |
| Hallucinated file path                            | Dropped via `resolveFile`.                                                                         |
| Author family == skeptic family (misconfig)       | Warn loudly on the brief; the independence guarantee is void.                                      |

## Failure Modes

| Component          | Failure Mode       | Trigger                        | Impact                  | Mitigation                                                                                                           |
| ------------------ | ------------------ | ------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Skeptic pass       | False `safe`       | Model misses a real risk       | Unsafe unit looks clean | Confidence + verdict are advisory; Phase 4's objective checks must _also_ be green to auto-clear (defense in depth). |
| Provider selection | Silent same-family | Author and skeptic both Claude | No real independence    | Record + assert provider family; warn on the brief.                                                                  |
| Cost/latency       | Slow review        | Huge diff                      | Queue backs up          | Single bounded call + the 24k diff cap from triage.                                                                  |

## Validation Commands

```bash
bun run typecheck
bun run lint
cd packages/cli && npx vitest run
bun run build
```

## Open Items

- [ ] Default skeptic model: `codex` (local, no key) vs an OpenAI API provider — `codex` recommended; confirm the `codex` CLI is present in your environment.
- [ ] Retire `triage.ts` entirely, or keep it for watch mode's _continuous_ cheap pass (the skeptic is per-unit/event-driven; triage was continuous-on-a-moving-tree).
- [ ] Confidence threshold for verdict derivation — tune empirically against a few planted-issue fixtures.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
