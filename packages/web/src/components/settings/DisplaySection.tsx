import { useState } from 'react';
import { ACCENTS } from '../../lib/accents';
import { useReviewStore } from '../../state/review-store';
import {
  type ConfigPatch,
  isSaveError,
  saveConfig,
  type DisplayDensity,
  type LayoutMode,
  type NarrationDensity,
  type StoryStructure,
} from '../../lib/config-client';
import type { AccentId } from '../../lib/accents';
import type { Theme } from '../../lib/theme';
import { Field, Section, Select, Toggle } from './controls';

/**
 * Display preferences — all auto-save on change (one-key PUT patches). Theme and accent go through
 * the store's write-through setters (also used by the header controls, so they stay in lockstep);
 * the rest save here and reconcile through `applyConfigResponse`. Reading current values from the
 * store keeps this in sync with SSE `config` events from other tabs.
 */
export function DisplaySection() {
  const theme = useReviewStore((s) => s.theme);
  const accent = useReviewStore((s) => s.accent);
  const storyStructure = useReviewStore((s) => s.storyStructure);
  const layoutMode = useReviewStore((s) => s.layoutMode);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  const density = useReviewStore((s) => s.density);
  const clusterBots = useReviewStore((s) => s.clusterBots);

  const setTheme = useReviewStore((s) => s.setTheme);
  const setAccent = useReviewStore((s) => s.setAccent);
  const setStoryStructure = useReviewStore((s) => s.setStoryStructure);
  const setLayoutMode = useReviewStore((s) => s.setLayoutMode);
  const setDisplayDensity = useReviewStore((s) => s.setDisplayDensity);
  const setDensity = useReviewStore((s) => s.setDensity);
  const setClusterBots = useReviewStore((s) => s.setClusterBots);
  const applyConfigResponse = useReviewStore((s) => s.applyConfigResponse);

  const [error, setError] = useState<string | null>(null);

  // Optimistically flip the store (instant feedback), then PUT and reconcile. A failure surfaces
  // inline and the optimistic value stays — the user can re-pick to retry.
  async function autoSave(patch: ConfigPatch, optimistic: () => void) {
    optimistic();
    setError(null);
    try {
      applyConfigResponse(await saveConfig(patch));
    } catch (e) {
      setError(isSaveError(e) ? (Object.values(e.fields)[0] ?? 'Save failed') : 'Save failed — check your connection.');
    }
  }

  return (
    <Section title="Display" description="How the walkthrough looks. Changes save as you pick them.">
      <Field label="Theme" htmlFor="set-theme">
        <Select<Theme>
          id="set-theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'auto', label: 'Auto (match system)' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Field>

      <Field label="Accent" htmlFor="set-accent">
        <Select<AccentId>
          id="set-accent"
          value={accent}
          onChange={setAccent}
          options={ACCENTS.map((a) => ({ value: a.id, label: a.name }))}
        />
      </Field>

      <Field label="Story structure" htmlFor="set-story">
        <Select<StoryStructure>
          id="set-story"
          value={storyStructure}
          onChange={(v) => void autoSave({ storyStructure: v }, () => setStoryStructure(v))}
          options={[
            { value: 'chapters', label: 'Chapters' },
            { value: 'linear', label: 'Linear' },
            { value: 'outline', label: 'Outline' },
          ]}
        />
      </Field>

      <Field label="Layout" htmlFor="set-layout">
        <Select<LayoutMode>
          id="set-layout"
          value={layoutMode}
          onChange={(v) => void autoSave({ layoutMode: v }, () => setLayoutMode(v))}
          options={[
            { value: 'toc', label: 'Sidebar table of contents' },
            { value: 'linear', label: 'Linear' },
          ]}
        />
      </Field>

      <Field label="Density" htmlFor="set-density" hint="How tightly the diff and chapters pack together.">
        <Select<DisplayDensity>
          id="set-density"
          value={displayDensity}
          onChange={(v) => void autoSave({ displayDensity: v }, () => setDisplayDensity(v))}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Field>

      <Field label="Narration density" htmlFor="set-narration" hint="How much Dad says by default.">
        <Select<NarrationDensity>
          id="set-narration"
          value={density}
          onChange={(v) => void autoSave({ defaultNarrationDensity: v }, () => setDensity(v))}
          options={[
            { value: 'terse', label: 'Terse' },
            { value: 'normal', label: 'Normal' },
            { value: 'verbose', label: 'Verbose' },
          ]}
        />
      </Field>

      <Field
        label="Cluster bot comments"
        htmlFor="set-clusterbots"
        hint="Fold noisy bot threads into one collapsible group."
      >
        <Toggle
          id="set-clusterbots"
          checked={clusterBots}
          ariaLabel="Cluster bot comments"
          onChange={(v) => void autoSave({ clusterBots: v }, () => setClusterBots(v))}
        />
      </Field>

      {error && (
        <p role="alert" className="text-[12px] font-medium" style={{ color: 'var(--red-11)' }}>
          {error}
        </p>
      )}
    </Section>
  );
}
