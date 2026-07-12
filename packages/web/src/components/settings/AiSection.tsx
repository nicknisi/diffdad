import { useEffect, useState } from 'react';
import { useReviewStore } from '../../state/review-store';
import {
  type AiProvider,
  type AwsProfile,
  type BedrockModelOption,
  type ConfigPatch,
  isSaveError,
  listAwsProfiles,
  listBedrockModels,
  type LocalCli,
  saveConfig,
  testConnection,
  type TestResult,
} from '../../lib/config-client';
import { Field, GhostButton, SaveBar, Section, Select, TestResultLine, TextInput } from './controls';

/** The wizard's provider decision tree (`config.ts`), rendered. `local` maps to "no aiProvider". */
type ProviderChoice = 'local' | 'anthropic' | 'openai' | 'ollama' | 'amazon-bedrock';

// Mirror of PROVIDER_DEFAULTS (config.ts) — shown as placeholders so the user sees the effective model.
const PROVIDER_DEFAULT_MODEL: Record<'anthropic' | 'openai' | 'ollama' | 'amazon-bedrock', string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  ollama: 'llama3.1',
  // Mirror of DEFAULT_BEDROCK_MODEL (ai-runtime.ts).
  'amazon-bedrock': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
};
const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';
// Mirror of DEFAULT_CLI_MODELS (config.ts).
const CLI_DEFAULT_MODEL: Record<LocalCli, string> = {
  claude: 'sonnet',
  codex: '',
  pi: '',
};

function providerChoiceOf(aiProvider: AiProvider | undefined): ProviderChoice {
  if (
    aiProvider === 'anthropic' ||
    aiProvider === 'openai' ||
    aiProvider === 'ollama' ||
    aiProvider === 'amazon-bedrock'
  ) {
    return aiProvider;
  }
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
          'To switch back to the local CLI, remove the `aiProvider` key from your config file (run `dad config` to print its path) — the daemon API can’t clear a saved provider yet.',
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
            { value: 'amazon-bedrock', label: 'Amazon Bedrock' },
          ]}
        />
      </Field>

      {switchNote && (
        <p className="text-[12px] leading-snug" style={{ color: 'var(--amber-11)' }}>
          {switchNote}
        </p>
      )}

      {current === 'local' ? (
        <LocalCliForm />
      ) : current === 'amazon-bedrock' ? (
        <BedrockProviderForm />
      ) : (
        <ApiProviderForm key={current} provider={current} />
      )}
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

/**
 * A write-only secret input with the "•••••••• set ✓ / Replace… / Clear" affordance (mirrors the
 * original API-key block). When a secret is already saved and not being replaced, it shows the masked
 * state; otherwise it renders a password field. The raw value never leaves the browser except on save.
 */
function SecretField({
  label,
  htmlFor,
  hint,
  error,
  set,
  value,
  onChange,
  onReplace,
  onClear,
  replacing,
  saving,
  placeholder,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  set: boolean;
  value: string;
  onChange: (value: string) => void;
  onReplace: () => void;
  onClear: () => void;
  replacing: boolean;
  saving: boolean;
  placeholder?: string;
}) {
  return replacing || !set ? (
    <Field label={label} htmlFor={htmlFor} hint={hint} error={error}>
      <TextInput
        id={htmlFor}
        type="password"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={saving}
        ariaLabel={label}
      />
    </Field>
  ) : (
    <Field label={label}>
      <span className="font-mono text-[13px] text-[var(--fg-2)]">•••••••• set ✓</span>
      <GhostButton onClick={onReplace} disabled={saving}>
        Replace…
      </GhostButton>
      <GhostButton onClick={onClear} disabled={saving}>
        Clear
      </GhostButton>
    </Field>
  );
}

/**
 * API-provider config: a write-only key + model (anthropic/openai) or a base URL (ollama).
 * Amazon Bedrock has its own form ({@link BedrockProviderForm}) — its auth modes and model listing
 * don't fit the simple key+model shape.
 */
function ApiProviderForm({ provider }: { provider: 'anthropic' | 'openai' | 'ollama' }) {
  const serverConfig = useReviewStore((s) => s.serverConfig);
  const applyConfigResponse = useReviewStore((s) => s.applyConfigResponse);
  const usesKey = provider === 'anthropic' || provider === 'openai';
  const usesBaseUrl = provider === 'ollama';
  const keySet = serverConfig?.aiApiKeySet ?? false;

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
      {usesKey && (
        <SecretField
          label="API key"
          htmlFor="ai-key"
          hint="Stored write-only. Leave blank to use the provider's environment variable."
          error={editingKey ? error : undefined}
          set={keySet}
          value={apiKey}
          onChange={setApiKey}
          onReplace={() => setReplacingKey(true)}
          onClear={() => void clearKey()}
          replacing={replacingKey}
          saving={saving}
          placeholder="sk-…"
        />
      )}

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

type BedrockAuthMode = 'profile' | 'keys' | 'api-key';

/** Which auth mode a saved config represents — same precedence as `resolveBedrockCreds` (CLI side). */
function bedrockAuthModeOf(config: { aiBedrockApiKeySet?: boolean; aiAccessKeyId?: string } | null): BedrockAuthMode {
  if (config?.aiBedrockApiKeySet) return 'api-key';
  return config?.aiAccessKeyId ? 'keys' : 'profile';
}

/**
 * Amazon Bedrock config: three auth modes (AWS profile / access key & secret / Bedrock API key), a
 * model picker fed by a live "Load models" call with a free-text fallback (invoke and list are two
 * distinct IAM permissions, so listing can fail for accounts that can still invoke), and load/test
 * requests that mirror save()'s clearing semantics so they can never silently run against another
 * mode's saved credentials.
 */
function BedrockProviderForm() {
  const serverConfig = useReviewStore((s) => s.serverConfig);
  const applyConfigResponse = useReviewStore((s) => s.applyConfigResponse);
  const secretKeySet = serverConfig?.aiSecretAccessKeySet ?? false;
  const bedrockKeySet = serverConfig?.aiBedrockApiKeySet ?? false;

  // Auth mode is derived from the saved config; secrets start blank and are write-only.
  const [authMode, setAuthMode] = useState<BedrockAuthMode>(bedrockAuthModeOf(serverConfig));
  const [region, setRegion] = useState(serverConfig?.aiRegion ?? '');
  const [profile, setProfile] = useState(serverConfig?.aiProfile ?? '');
  const [accessKeyId, setAccessKeyId] = useState(serverConfig?.aiAccessKeyId ?? '');
  const [secretKey, setSecretKey] = useState('');
  const [replacingSecret, setReplacingSecret] = useState(false);
  const [bedrockKey, setBedrockKey] = useState('');
  const [replacingBedrockKey, setReplacingBedrockKey] = useState(false);
  const [profiles, setProfiles] = useState<AwsProfile[] | null>(null);
  const [model, setModel] = useState(serverConfig?.aiModel ?? '');
  const [modelOptions, setModelOptions] = useState<BedrockModelOption[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Enumerate the machine's AWS profiles once, for the profile dropdown. Never throws (empty on failure).
  useEffect(() => {
    let live = true;
    void listAwsProfiles().then((p) => {
      if (live) setProfiles(p);
    });
    return () => {
      live = false;
    };
  }, []);

  const savedModel = serverConfig?.aiModel ?? '';
  const savedRegion = serverConfig?.aiRegion ?? '';
  const savedProfile = serverConfig?.aiProfile ?? '';
  const savedAccessKeyId = serverConfig?.aiAccessKeyId ?? '';

  // Profile mode can only save with a usable profile: picked, present on this machine, and carrying
  // a region. A blank profile would wipe working key-mode creds and save nothing in their place; a
  // not-found or region-less one (e.g. a config synced from another machine) would save fine and
  // then fail every generation.
  const selectedProfile = profiles?.find((p) => p.name === profile);
  const profileIssue =
    authMode !== 'profile' || profile.length === 0 || profiles === null
      ? null
      : !selectedProfile
        ? 'This profile wasn’t found on this machine — pick one from the list.'
        : !selectedProfile.region
          ? 'This profile has no region. Add a region to it in ~/.aws/config, or use access key & secret.'
          : null;
  const profileBlocked =
    authMode === 'profile' &&
    (profile.length === 0 || profiles === null || !selectedProfile || !selectedProfile.region);

  // API-key mode with no key saved and none typed: saving would clear the other modes' creds and
  // put nothing in their place. Same shape as profileBlocked.
  const apiKeyBlocked = authMode === 'api-key' && !bedrockKeySet && bedrockKey.length === 0;

  const credsDirty =
    authMode === 'profile'
      ? profile !== savedProfile
      : authMode === 'api-key'
        ? region !== savedRegion || bedrockKey.length > 0
        : region !== savedRegion || accessKeyId !== savedAccessKeyId || secretKey.length > 0;
  const hasEdits = credsDirty || model !== savedModel;
  const dirty = hasEdits && !profileBlocked && !apiKeyBlocked;

  /**
   * The full candidate credential state for the selected mode, mirroring save()'s clears: the other
   * modes' fields ride along as '' so the server overlay can't fall back to saved creds from those
   * modes. An API key outranks explicit keys, which outrank a profile, in resolveBedrockCreds — so
   * any lingering saved credential from another mode would otherwise silently hijack loads and tests.
   */
  function credOverlay() {
    if (authMode === 'profile') {
      return { aiProfile: profile, aiRegion: '', aiAccessKeyId: '', aiSecretAccessKey: '', aiBedrockApiKey: '' };
    }
    if (authMode === 'api-key') {
      return {
        aiRegion: region,
        // Omitted (not cleared) when blank: the saved write-only key stays in play, like save().
        ...(bedrockKey.length > 0 ? { aiBedrockApiKey: bedrockKey } : {}),
        aiProfile: '',
        aiAccessKeyId: '',
        aiSecretAccessKey: '',
      };
    }
    return {
      aiRegion: region,
      aiAccessKeyId: accessKeyId,
      // Omitted (not cleared) when blank: the saved write-only secret stays in play, like save().
      ...(secretKey.length > 0 ? { aiSecretAccessKey: secretKey } : {}),
      aiProfile: '',
      aiBedrockApiKey: '',
    };
  }

  // Changing creds/region (or the auth mode) invalidates a loaded model list, and a model picked
  // from that list may not exist under the new creds — drop it back to the saved one. A free-typed
  // id (no list loaded) is kept; it was never tied to a listing.
  function invalidateModelList() {
    if (modelOptions !== null && model !== savedModel) setModel(savedModel);
    setModelOptions(null);
    setLoadError(null);
  }

  function changeCred(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      invalidateModelList();
    };
  }

  function changeAuthMode(mode: BedrockAuthMode) {
    setAuthMode(mode);
    invalidateModelList();
  }

  async function loadModels() {
    setLoadingModels(true);
    setLoadError(null);
    setModelOptions(null);
    try {
      const { models, region: resolvedRegion } = await listBedrockModels(credOverlay());
      setModelOptions(models);
      // Key / API-key modes: prefill the region the server resolved when the user left it blank.
      // Profile mode has no region field (the profile supplies it), so nothing to prefill there.
      if (authMode !== 'profile' && resolvedRegion && region.trim() === '') setRegion(resolvedRegion);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load models');
    } finally {
      setLoadingModels(false);
    }
  }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const patch: ConfigPatch = {};
      // Each mode clears the other modes' saved creds so precedence (api-key > keys > profile)
      // can't resurrect them.
      if (authMode === 'profile') {
        patch.aiProfile = profile;
        if (savedRegion) patch.aiRegion = '';
        if (savedAccessKeyId) patch.aiAccessKeyId = '';
        if (secretKeySet) patch.aiSecretAccessKey = '';
        if (bedrockKeySet) patch.aiBedrockApiKey = '';
      } else if (authMode === 'api-key') {
        if (region !== savedRegion) patch.aiRegion = region;
        if (bedrockKey.length > 0) patch.aiBedrockApiKey = bedrockKey;
        if (savedProfile) patch.aiProfile = '';
        if (savedAccessKeyId) patch.aiAccessKeyId = '';
        if (secretKeySet) patch.aiSecretAccessKey = '';
      } else {
        if (region !== savedRegion) patch.aiRegion = region;
        if (accessKeyId !== savedAccessKeyId) patch.aiAccessKeyId = accessKeyId;
        if (secretKey.length > 0) patch.aiSecretAccessKey = secretKey;
        if (savedProfile) patch.aiProfile = '';
        if (bedrockKeySet) patch.aiBedrockApiKey = '';
      }
      if (model !== savedModel) patch.aiModel = model;
      applyConfigResponse(await saveConfig(patch));
      setSecretKey('');
      setReplacingSecret(false);
      setBedrockKey('');
      setReplacingBedrockKey(false);
    } catch (e) {
      setError(isSaveError(e) ? (Object.values(e.fields)[0] ?? 'Save failed') : 'Save failed — check your connection.');
    } finally {
      setSaving(false);
    }
  }

  async function clearSecret() {
    if (!window.confirm('Remove the saved secret access key?')) return;
    setSaving(true);
    setError(null);
    try {
      applyConfigResponse(await saveConfig({ aiSecretAccessKey: '' }));
      setSecretKey('');
      setReplacingSecret(false);
    } catch (e) {
      setError(
        isSaveError(e) ? (Object.values(e.fields)[0] ?? 'Clear failed') : 'Clear failed — check your connection.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function clearBedrockKey() {
    if (!window.confirm('Remove the saved Bedrock API key?')) return;
    setSaving(true);
    setError(null);
    try {
      applyConfigResponse(await saveConfig({ aiBedrockApiKey: '' }));
      setBedrockKey('');
      setReplacingBedrockKey(false);
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
          aiProvider: 'amazon-bedrock',
          aiModel: model.length > 0 ? model : undefined,
          ...credOverlay(),
        }),
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <Field label="Credentials" htmlFor="ai-auth-mode" hint="How Dad authenticates to Bedrock.">
        <Select<BedrockAuthMode>
          id="ai-auth-mode"
          value={authMode}
          onChange={changeAuthMode}
          options={[
            { value: 'profile', label: 'AWS profile' },
            { value: 'api-key', label: 'Bedrock API key' },
            { value: 'keys', label: 'Access key & secret' },
          ]}
        />
      </Field>

      {authMode === 'profile' ? (
        profiles !== null && profiles.length === 0 ? (
          <p className="text-[12px] leading-snug text-[var(--fg-3)]">
            No AWS profiles found on this machine. Switch to “Access key & secret”, or add a profile to ~/.aws/config.
          </p>
        ) : (
          <>
            <Field
              label="Profile"
              htmlFor="ai-profile"
              hint="A named profile from ~/.aws. Dad uses it and its region."
              error={profileIssue}
            >
              <Select
                id="ai-profile"
                value={profile}
                onChange={changeCred(setProfile)}
                disabled={saving || profiles === null}
                ariaLabel="AWS profile"
                options={[
                  ...(profile === ''
                    ? [
                        {
                          value: '',
                          label: profiles === null ? 'Loading profiles…' : 'Select a profile…',
                        },
                      ]
                    : []),
                  ...(profile !== '' && profiles && !profiles.some((p) => p.name === profile)
                    ? [{ value: profile, label: `${profile} (not found)` }]
                    : []),
                  ...(profiles ?? []).map((p) => ({
                    value: p.name,
                    label: p.region ? `${p.name} (${p.region})` : `${p.name} (no region)`,
                  })),
                ]}
              />
            </Field>
            {profile.length === 0 && hasEdits && (
              <p className="text-[12px] leading-snug text-[var(--fg-3)]">Select a profile to enable Save.</p>
            )}
          </>
        )
      ) : (
        <>
          <Field label="Region" htmlFor="ai-region" hint="AWS region for Bedrock (e.g. us-east-1).">
            <TextInput
              id="ai-region"
              value={region}
              onChange={changeCred(setRegion)}
              placeholder="us-east-1"
              disabled={saving}
              ariaLabel="Region"
            />
          </Field>

          {authMode === 'api-key' ? (
            <>
              <SecretField
                label="API key"
                htmlFor="ai-bedrock-api-key"
                hint="A Bedrock API key (bearer token) from the Bedrock console. Stored write-only."
                set={bedrockKeySet}
                value={bedrockKey}
                onChange={changeCred(setBedrockKey)}
                onReplace={() => setReplacingBedrockKey(true)}
                onClear={() => void clearBedrockKey()}
                replacing={replacingBedrockKey}
                saving={saving}
                placeholder="bedrock-api-key-…"
              />
              {apiKeyBlocked && hasEdits && (
                <p className="text-[12px] leading-snug text-[var(--fg-3)]">Enter an API key to enable Save.</p>
              )}
            </>
          ) : (
            <>
              <Field label="Access key ID" htmlFor="ai-access-key-id">
                <TextInput
                  id="ai-access-key-id"
                  value={accessKeyId}
                  onChange={changeCred(setAccessKeyId)}
                  placeholder="AKIA…"
                  disabled={saving}
                  ariaLabel="Access key ID"
                />
              </Field>

              <SecretField
                label="Secret access key"
                htmlFor="ai-secret-key"
                hint="Stored write-only."
                set={secretKeySet}
                value={secretKey}
                onChange={changeCred(setSecretKey)}
                onReplace={() => setReplacingSecret(true)}
                onClear={() => void clearSecret()}
                replacing={replacingSecret}
                saving={saving}
                placeholder="••••"
              />
            </>
          )}
        </>
      )}

      <Field
        label="Model"
        htmlFor="ai-bedrock-model"
        hint={
          modelOptions
            ? 'Pick from the models available to your account.'
            : 'Load the models available to your account, or type a model id. Blank uses the default.'
        }
      >
        {modelOptions ? (
          <Select
            id="ai-bedrock-model"
            value={model}
            onChange={setModel}
            disabled={saving}
            ariaLabel="Model"
            options={[
              ...(model === '' ? [{ value: '', label: 'Select a model…' }] : []),
              ...(model !== '' && !modelOptions.some((o) => o.id === model)
                ? [{ value: model, label: `${model} (saved)` }]
                : []),
              ...modelOptions.map((o) => ({ value: o.id, label: o.label })),
            ]}
          />
        ) : (
          <>
            <TextInput
              id="ai-bedrock-model"
              value={model}
              onChange={setModel}
              placeholder={PROVIDER_DEFAULT_MODEL['amazon-bedrock']}
              disabled={saving}
              ariaLabel="Model"
            />
            <GhostButton onClick={() => void loadModels()} disabled={loadingModels || saving}>
              {loadingModels ? 'Loading…' : 'Load models'}
            </GhostButton>
          </>
        )}
      </Field>

      {modelOptions && (
        <div className="flex justify-end">
          <GhostButton onClick={() => void loadModels()} disabled={loadingModels || saving}>
            {loadingModels ? 'Loading…' : 'Reload models'}
          </GhostButton>
        </div>
      )}

      {loadError && (
        <p role="alert" className="text-[12px] font-medium" style={{ color: 'var(--red-11)' }}>
          {loadError}
        </p>
      )}

      {error && (
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
          setAuthMode(bedrockAuthModeOf(serverConfig));
          setRegion(savedRegion);
          setProfile(savedProfile);
          setAccessKeyId(savedAccessKeyId);
          setSecretKey('');
          setReplacingSecret(false);
          setBedrockKey('');
          setReplacingBedrockKey(false);
          setModel(savedModel);
          setModelOptions(null);
          setLoadError(null);
          setError(null);
        }}
      />
    </>
  );
}
