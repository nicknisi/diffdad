# Diff Dad eval harness

This folder contains the evaluation harness used to judge the quality of
generated narratives. It is a quality gate, not a test suite — it makes
real LLM calls and is meant to be run by hand when changing the prompt or
schema.

## Why it exists

Without measurement, prompt iteration is vibes. The harness gives us a
falsifiable answer to "did this change make Diff Dad better or worse".

## What it measures

- **4-axis rubric** (Tao 2022 / Dong 2021): Comprehensiveness, Rationality,
  Conciseness, Expressiveness. Scored 1-5 by an LLM-as-judge.
- **Defect recall**: per fixture, what fraction of `expectedConcerns` did the
  narrative actually surface (in tldr / readingPlan / concerns / missing /
  whyMatters / callouts)?
- **Latency**: time-to-first-partial-parse (streaming only) and total wall time.
- **Sanity flags**: did chapters end up ordered by risk? was the verdict
  appropriate (e.g. not 'safe' for the deliberately risky fixtures)?

## How to run

```sh
# Run all fixtures, write baseline to packages/cli/eval-baseline/baseline.json
bun run eval

# Single fixture
bun run eval -- --fixture=auth-token-validation

# Custom output path
bun run eval -- --output=/tmp/dad-baseline.json
```

By default it uses your configured `aiProvider` for both narrative generation
and judging. To break anchoring bias and use a different model for the judge,
set:

```sh
DIFFDAD_JUDGE_PROVIDER=openai DIFFDAD_JUDGE_MODEL=gpt-4o bun run eval
```

## Workflow

1. Run `bun run eval` on `main` to capture a baseline.
2. Make a prompt or schema change.
3. Run `bun run eval` again.
4. Compare `aggregate.*` between the two baselines. If the rubric scores
   regressed or `avgDefectRecall` dropped, revert and try again.

## Adding fixtures

Create a new file in `fixtures/`, export a `fixture: EvalFixture`, and add
it to `fixtures/index.ts`. Fixtures should:

- Have a clear, real-world failure mode the LLM should catch
- Provide ground-truth `expectedConcerns` written as the actual concern (not
  a paraphrase the judge has to match against by string)
- Be small enough to run cheaply (<200 lines diff is ideal)

Include at least one negative case (a clean PR where the right answer is
'safe' with no concerns) to penalize false positives — a noisy review tool
is worse than a quiet one.
