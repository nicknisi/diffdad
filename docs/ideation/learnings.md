# Ideation Learnings

Generalizable spec-gap and interview patterns captured from completed ideation projects. Intake reads
this file so recurring gaps inform future questioning and spec generation. Each entry is dated and cites
its evidence; treat entries as hints, never as a substitute for gate evidence.

## 2026-07-31 — review-triage

- **Pattern**: A spec that adds tests to a package with no existing test setup must list the test
  environment/config file in its File Changes table, or the suite it writes cannot run.
  **Evidence**: Phase 3, "Web tests — a DOM, opted into per file" — the collapse render tests needed a
  jsdom environment that no phase declared; fixed after the fact in commit `cd021c3`.
  **Spec/interview implication**: When a phase introduces the first test of its kind in a package, treat
  the runner config as a deliverable file, not as ambient infrastructure. Ask during the interview which
  package the tests land in and whether that package already has a runner wired.

- **Pattern**: When a data field spans phases — declared in one, stored in another, rendered in a third —
  one phase must explicitly own wiring its _producer_, or the field ships as a type that nothing writes.
  **Evidence**: Phase 3, "capStats — nothing populated it, on either server". The type, the storage, and
  the render path all landed; no phase had assigned the code that actually assigns the value.
  **Spec/interview implication**: For any field crossing a phase boundary, name the producing phase in
  that phase's success criteria ("X is non-null after a real run"), not merely in a File Changes row.

- **Pattern**: A feature that gates a user-facing claim on evidence must enumerate what _disqualifies_,
  not only what qualifies. Positive evidence alone leaves the implementer inventing safety logic mid-build.
  **Evidence**: Phase 2, "selectCollapsible — a risk-signal veto the spec did not name" and
  "filesScanned === 0 disables every evidence kind, not just the caller check".
  **Spec/interview implication**: For evidence-gated features, interview for the veto list explicitly and
  write it into the spec beside the evidence list. Treat "what makes this evidence untrustworthy?" as a
  required question whenever a gate produces a claim a human will act on.
