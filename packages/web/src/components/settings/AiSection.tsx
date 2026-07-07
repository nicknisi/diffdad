import { useState } from 'react';
import { useReviewStore } from '../../state/review-store';
import {
  type AiProvider,
  type ConfigPatch,
  isSaveError,
  type LocalCli,
  saveConfig,
  testConnection,
  type TestResult,
} from '../../lib/config-client';
import { Field, GhostButton, SaveBar, Section, Select, TestResultLine, TextInput } from './controls';

/** The wizard's provider decision tree (`config.ts`), rendered. `local` maps to "no aiProvider". */
type ProviderChoice = 'local' | 'anthropic' | 'openai' | 'ollama';

// Mirror of PROVIDER_DEFAULTS (config.ts) — shown as placeholders so the user sees the effective model.
const PROVIDER_DEFAULT_MODEL: Record<'anthropic' | 'openai' | 'ollama', string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  ollama: 'llama3.1',
};
const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';
// Mirror of DEFAULT_CLI_MODELS (config.ts).
const CLI_DEFAULT_MODEL: Record<LocalCli, string> = { claude: 'sonnet', codex: '', pi: '' };

function providerChoiceOf(aiProvider: AiProvider | undefined): ProviderChoice {
  if (aiProvider === 'anthropic' || aiProvider === 'openai' || aiProvider === 'ollama') return aiProvider;
  return 'local';
}

export function AiSection() {
  const serverConfig = useReviewStore((s) => s.serverConfig);
  const applyConfigResponse = useReviewStore((s) => s.applyConfigResponse);
  const current = providerChoiceOf(serverConfig?.aiProvider);
  const [switchNote, setSwitchNote] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);

  async function pickProvider(choice: ProviderChoice) {
    setSwitchNote(null);
    setProviderError(null);
    if (choice === 'local') {
      // Phase 1's PUT schema can't unset `aiProvider`, so an API→local switch can't be done from here.
      if (current !== 'local') {
        setSwitchNote(
          'To switch back to the local CLI, run `dad config` in a terminal — the daemon API can’t clear a saved provider yet.',
        );
      }
      return;
    }
    try {
      applyConfigResponse(await saveConfig({ aiProvider: choice }));
    } catch (e) {
      setProviderError(
        isSaveError(e) ? (Object.values(e.fields)[0] ?? 'Save failed') : 'Save failed — check your connection.',
      );
    }
  }

  return (
    <Section title="AI" description="How Dad thinks — a local CLI (uses your existing login) or a hosted API.">
      <Field label="How should Dad think?" htmlFor="ai-provider" error={providerError}>
        <Select<ProviderChoice>
          id="ai-provider"
          value={current}
          onChange={(v) => void pickProvider(v)}
          options={[
            { value: 'local', label: 'Local CLI (claude / codex / pi)' },
            { value: 'anthropic', label: 'Anthropic (Claude)' },
            { value: 'openai', label: 'OpenAI' },
            { value: 'ollama', label: 'Ollama (local)' },
          ]}
        />
      </Field>

      {switchNote && (
        <p className="text-[12px] leading-snug" style={{ color: 'var(--amber-11)' }}>
          {switchNote}
        </p>
      )}

      {current === 'local' ? <LocalCliForm /> : <ApiProviderForm key={current} provider={current} />}
    </Section>
  );
}

/** Local-CLI config: the preferred CLI (auto-save) and a per-CLI model override (explicit save). */
function LocalCliForm() {
  const serverConfig = useReviewStore((s) => s.serverConfig);
  const applyConfigResponse = useReviewStore((s) => s.applyConfigResponse);

  const [defaultCli, setDefaultCli] = useState<LocalCli>(serverConfig?.defaultCli ?? 'claude');
  const [models, setModels] = useState<Record<LocalCli, string>>({
    claude: serverConfig?.cliModels?.claude ?? '',
    codex: serverConfig?.cliModels?.codex ?? '',
    pi: serverConfig?.cliModels?.pi ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedModels: Record<LocalCli, string> = {
    claude: serverConfig?.cliModels?.claude ?? '',
    codex: serverConfig?.cliModels?.codex ?? '',
    pi: serverConfig?.cliModels?.pi ?? '',
  };
  const dirty = (['claude', 'codex', 'pi'] as LocalCli[]).some((c) => models[c] !== savedModels[c]);

  async function pickCli(cli: LocalCli) {
    setDefaultCli(cli);
    setError(null);
    try {
      applyConfigResponse(await saveConfig({ defaultCli: cli }));
    } catch (e) {
      setError(isSaveError(e) ? (Object.values(e.fields)[0] ?? 'Save failed') : 'Save failed — check your connection.');
    }
  }

  async function saveModels() {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      // Drop empty overrides so the CLI's own default is used; keep only non-empty models.
      const cliModels: Partial<Record<LocalCli, string>> = {};
      for (const c of ['claude', 'codex', 'pi'] as LocalCli[]) if (models[c].length > 0) cliModels[c] = models[c];
      applyConfigResponse(await saveConfig({ cliModels }));
    } catch (e) {
      setError(isSaveError(e) ? (Object.values(e.fields)[0] ?? 'Save failed') : 'Save failed — check your connection.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Field
        label="Preferred CLI"
        htmlFor="ai-cli"
        hint="Which CLI to try first; Dad falls back to whatever is installed."
      >
        <Select<LocalCli>
          id="ai-cli"
          value={defaultCli}
          onChange={(v) => void pickCli(v)}
          options={[
            { value: 'claude', label: 'claude' },
            { value: 'codex', label: 'codex' },
            { value: 'pi', label: 'pi' },
          ]}
        />
      </Field>

      {(['claude', 'codex', 'pi'] as LocalCli[]).map((cli) => (
        <Field key={cli} label={`${cli} model`} htmlFor={`ai-model-${cli}`}>
          <TextInput
            id={`ai-model-${cli}`}
            value={models[cli]}
            onChange={(v) => setModels((m) => ({ ...m, [cli]: v }))}
            placeholder={CLI_DEFAULT_MODEL[cli] || `${cli} default`}
            disabled={saving}
            ariaLabel={`${cli} model`}
          />
        </Field>
      ))}

      {error && (
        <p role="alert" className="text-[12px] font-medium" style={{ color: 'var(--red-11)' }}>
          {error}
        </p>
      )}

      <SaveBar dirty={dirty} saving={saving} onSave={() => void saveModels()} onCancel={() => setModels(savedModels)} />
    </>
  );
}

/** API-provider config: a write-only key (anthropic/openai), a model, and a base URL (ollama). */
function ApiProviderForm({ provider }: { provider: 'anthropic' | 'openai' | 'ollama' }) {
  const serverConfig = useReviewStore((s) => s.serverConfig);
  const applyConfigResponse = useReviewStore((s) => s.applyConfigResponse);
  const keySet = serverConfig?.aiApiKeySet ?? false;
  const usesKey = provider !== 'ollama';
  const usesBaseUrl = provider === 'ollama';

  const [model, setModel] = useState(serverConfig?.aiModel ?? '');
  const [baseUrl, setBaseUrl] = useState(serverConfig?.aiBaseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [replacingKey, setReplacingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const savedModel = serverConfig?.aiModel ?? '';
  const savedBaseUrl = serverConfig?.aiBaseUrl ?? '';
  const editingKey = usesKey && (replacingKey || !keySet);
  const dirty = model !== savedModel || (usesBaseUrl && baseUrl !== savedBaseUrl) || apiKey.length > 0;

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const patch: ConfigPatch = {};
      if (model !== savedModel) patch.aiModel = model;
      if (usesBaseUrl && baseUrl !== savedBaseUrl) patch.aiBaseUrl = baseUrl;
      if (apiKey.length > 0) patch.aiApiKey = apiKey;
      applyConfigResponse(await saveConfig(patch));
      setApiKey('');
      setReplacingKey(false);
    } catch (e) {
      setError(isSaveError(e) ? (Object.values(e.fields)[0] ?? 'Save failed') : 'Save failed — check your connection.');
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    if (!window.confirm('Remove the saved API key?')) return;
    setSaving(true);
    setError(null);
    try {
      applyConfigResponse(await saveConfig({ aiApiKey: '' }));
      setApiKey('');
      setReplacingKey(false);
    } catch (e) {
      setError(
        isSaveError(e) ? (Object.values(e.fields)[0] ?? 'Clear failed') : 'Clear failed — check your connection.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(
        await testConnection({
          kind: 'ai',
          aiProvider: provider,
          aiApiKey: apiKey.length > 0 ? apiKey : undefined,
          aiModel: model.length > 0 ? model : undefined,
          aiBaseUrl: usesBaseUrl && baseUrl.length > 0 ? baseUrl : undefined,
        }),
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      {usesKey &&
        (editingKey ? (
          <Field
            label="API key"
            htmlFor="ai-key"
            hint="Stored write-only. Leave blank to use the provider's environment variable."
            error={error}
          >
            <TextInput
              id="ai-key"
              type="password"
              value={apiKey}
              onChange={setApiKey}
              placeholder="sk-…"
              disabled={saving}
              ariaLabel="API key"
            />
          </Field>
        ) : (
          <Field label="API key">
            <span className="font-mono text-[13px] text-[var(--fg-2)]">•••••••• set ✓</span>
            <GhostButton onClick={() => setReplacingKey(true)} disabled={saving}>
              Replace…
            </GhostButton>
            <GhostButton onClick={() => void clearKey()} disabled={saving}>
              Clear
            </GhostButton>
          </Field>
        ))}

      {usesBaseUrl && (
        <Field label="Base URL" htmlFor="ai-baseurl">
          <TextInput
            id="ai-baseurl"
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder={OLLAMA_DEFAULT_BASE_URL}
            disabled={saving}
            ariaLabel="Base URL"
          />
        </Field>
      )}

      <Field label="Model" htmlFor="ai-model">
        <TextInput
          id="ai-model"
          value={model}
          onChange={setModel}
          placeholder={PROVIDER_DEFAULT_MODEL[provider]}
          disabled={saving}
          ariaLabel="Model"
        />
      </Field>

      {error && !editingKey && (
        <p role="alert" className="text-[12px] font-medium" style={{ color: 'var(--red-11)' }}>
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <GhostButton onClick={() => void runTest()} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </GhostButton>
        </div>
        <TestResultLine result={testResult} />
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onCancel={() => {
          setModel(savedModel);
          setBaseUrl(savedBaseUrl);
          setApiKey('');
          setReplacingKey(false);
          setError(null);
        }}
      />
    </>
  );
}
