import { fixture as authTokenValidation } from './auth-token-validation';
import { fixture as cacheRaceCondition } from './cache-race-condition';
import { fixture as migrationWithoutRollback } from './migration-without-rollback';
import { fixture as safeRename } from './safe-rename';
import type { EvalFixture } from '../types';

export const FIXTURES: EvalFixture[] = [authTokenValidation, cacheRaceCondition, migrationWithoutRollback, safeRename];
