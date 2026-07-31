import { fixture as authTokenValidation } from './auth-token-validation';
import { fixture as cacheRaceCondition } from './cache-race-condition';
import { fixture as largeRefactor } from './large-refactor';
import { fixture as migrationWithoutRollback } from './migration-without-rollback';
import { fixture as safeRename } from './safe-rename';
import type { EvalFixture } from '../types';

// Hand-maintained on purpose: a directory glob would make `bun run eval`'s cost depend on whatever
// happens to be sitting in the folder. Note that `large-refactor` is by far the most expensive entry
// (43 files, a two-pass run with one writer call per theme), so every unfiltered eval run now spends
// real provider budget on it — use `--fixture=` while iterating.
export const FIXTURES: EvalFixture[] = [
  authTokenValidation,
  cacheRaceCondition,
  largeRefactor,
  migrationWithoutRollback,
  safeRename,
];
