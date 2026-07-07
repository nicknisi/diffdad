import { useState } from 'react';
import { useReviewStore } from '../../state/review-store';
import { isSaveError, saveConfig } from '../../lib/config-client';
import { Field, SaveBar, Section, TextInput } from './controls';

const DEFAULT_POLL_SECONDS = 60; // mirrors DEFAULT_POLL_INTERVAL_MS (60_000ms) in config.ts

/**
 * Daemon-only settings — rendered solely in command-center mode (a PR-mode process has no poller, so
 * a poll-interval control there would edit a key nothing reads). The UI is in seconds; the wire is
 * `pollIntervalMs`. The server enforces the 10s–60min bounds and returns a 400 we render inline.
 */
export function DaemonSection() {
  const serverConfig = useReviewStore((s) => s.serverConfig);
  const applyConfigResponse = useReviewStore((s) => s.applyConfigResponse);

  const savedSeconds = serverConfig?.pollIntervalMs ? String(Math.round(serverConfig.pollIntervalMs / 1000)) : '';
  const [seconds, setSeconds] = useState(savedSeconds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = seconds.trim().length > 0 && seconds.trim() !== savedSeconds;

  async function save() {
    if (saving || !dirty) return;
    const parsed = Number(seconds.trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      setError('Enter a whole number of seconds.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      applyConfigResponse(await saveConfig({ pollIntervalMs: parsed * 1000 }));
    } catch (e) {
      setError(
        isSaveError(e)
          ? (e.fields.pollIntervalMs ?? e.fields._ ?? 'Save failed')
          : 'Save failed — check your connection.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Daemon" description="Background review agent settings.">
      <Field
        label="Poll interval (seconds)"
        htmlFor="daemon-poll"
        hint="How often the daemon checks GitHub for new review requests. Minimum 10 seconds."
        error={error}
      >
        <TextInput
          id="daemon-poll"
          type="number"
          value={seconds}
          onChange={(v) => setSeconds(v)}
          placeholder={String(DEFAULT_POLL_SECONDS)}
          disabled={saving}
          ariaLabel="Poll interval in seconds"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
      </Field>

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onCancel={() => setSeconds(savedSeconds)} />
    </Section>
  );
}
