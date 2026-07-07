import { useState } from 'react';
import { useReviewStore } from '../../state/review-store';
import {
  isSaveError,
  saveConfig,
  testConnection,
  type GitHubTokenSource,
  type TestResult,
} from '../../lib/config-client';
import { Field, GhostButton, SaveBar, Section, TestResultLine, TextInput } from './controls';

/** Human copy for the effective GitHub state — leads the section so a `gh auth login` user is never
 * pushed to paste a redundant PAT. */
function sourceLabel(active: boolean, source: GitHubTokenSource): string {
  if (!active) return 'Not connected';
  switch (source) {
    case 'gh':
      return 'Authenticated via the gh CLI';
    case 'env':
      return 'Authenticated via environment (DIFFDAD_GITHUB_TOKEN)';
    case 'config':
      return 'Authenticated via a saved token';
    default:
      return 'Connected';
  }
}

export function GitHubSection() {
  const github = useReviewStore((s) => s.github);
  const serverConfig = useReviewStore((s) => s.serverConfig);
  const applyConfigResponse = useReviewStore((s) => s.applyConfigResponse);

  const active = github?.active ?? false;
  const tokenSet = serverConfig?.githubTokenSet ?? false;

  // Editing state for the write-only token field. `replacing` reveals an empty input over a masked
  // "set ✓" row; the input is empty by default (the client never holds the raw token).
  const [replacing, setReplacing] = useState(false);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const editing = replacing || !tokenSet;

  async function save() {
    if (saving || token.length === 0) return;
    setSaving(true);
    setFieldError(null);
    setTestResult(null);
    try {
      applyConfigResponse(await saveConfig({ githubToken: token }));
      setToken('');
      setReplacing(false);
    } catch (e) {
      setFieldError(
        isSaveError(e) ? (e.fields.githubToken ?? e.fields._ ?? 'Save failed') : 'Save failed — check your connection.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    // Clearing a token can take the daemon dark — confirm before wiping it.
    if (!window.confirm('Remove the saved GitHub token? The daemon may lose access until you add another.')) return;
    setSaving(true);
    setFieldError(null);
    setTestResult(null);
    try {
      applyConfigResponse(await saveConfig({ githubToken: '' }));
      setToken('');
      setReplacing(false);
    } catch (e) {
      setFieldError(
        isSaveError(e) ? (e.fields.githubToken ?? 'Clear failed') : 'Clear failed — check your connection.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      // Test the typed candidate if present, else the effective token (env → gh → config).
      setTestResult(await testConnection({ kind: 'github', token: token.length > 0 ? token : undefined }));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Section title="GitHub" description="How Diff Dad reaches GitHub to read PRs and post your reviews.">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: active ? 'var(--green-10)' : 'var(--amber-9)' }}
          aria-hidden
        />
        <span className="text-[13px] font-medium text-[var(--fg-1)]">
          {sourceLabel(active, github?.source ?? null)}
        </span>
      </div>

      {github?.warning && (
        <p className="text-[12px]" style={{ color: 'var(--amber-11)' }}>
          {github.warning}
        </p>
      )}

      {editing ? (
        <Field
          label="Personal access token"
          htmlFor="gh-token"
          hint="Stored write-only. A gh CLI or DIFFDAD_GITHUB_TOKEN login is used automatically — you only need this to override them."
          error={fieldError}
        >
          <TextInput
            id="gh-token"
            type="password"
            value={token}
            onChange={setToken}
            placeholder="ghp_…"
            disabled={saving}
            ariaLabel="GitHub personal access token"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
        </Field>
      ) : (
        <Field label="Personal access token" error={fieldError}>
          <span className="font-mono text-[13px] text-[var(--fg-2)]">•••••••• set ✓</span>
          <GhostButton onClick={() => setReplacing(true)} disabled={saving}>
            Replace…
          </GhostButton>
          <GhostButton onClick={() => void clear()} disabled={saving}>
            Clear
          </GhostButton>
        </Field>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <GhostButton onClick={() => void runTest()} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </GhostButton>
          {editing && replacing && (
            <button
              type="button"
              onClick={() => {
                setReplacing(false);
                setToken('');
                setFieldError(null);
              }}
              disabled={saving}
              className="text-[12.5px] font-medium text-[var(--fg-2)] hover:text-[var(--fg-1)] disabled:opacity-40"
            >
              Cancel
            </button>
          )}
        </div>
        <TestResultLine result={testResult} />
      </div>

      {editing && (
        <SaveBar
          dirty={token.length > 0}
          saving={saving}
          onSave={() => void save()}
          onCancel={() => {
            setToken('');
            setReplacing(false);
            setFieldError(null);
          }}
        />
      )}
    </Section>
  );
}
