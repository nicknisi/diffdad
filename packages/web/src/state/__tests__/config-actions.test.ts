import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReviewStore } from '../review-store';
import type { ConfigResponse } from '../../lib/config-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mkConfigResponse(over: Partial<ConfigResponse> = {}): ConfigResponse {
  return {
    config: {
      githubTokenSet: false,
      aiApiKeySet: false,
      theme: 'dark',
      accent: 'forest',
      storyStructure: 'linear',
      layoutMode: 'linear',
      displayDensity: 'compact',
      defaultNarrationDensity: 'verbose',
      clusterBots: false,
      ...over.config,
    },
    github: over.github ?? { active: false, source: null },
  };
}

/** Let queued microtasks (the fire-and-forget saveConfig chain) settle. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  useReviewStore.setState({
    theme: 'auto',
    accent: 'classic',
    storyStructure: 'chapters',
    layoutMode: 'toc',
    displayDensity: 'comfortable',
    density: 'normal',
    clusterBots: true,
    serverConfig: null,
    github: null,
    configLoaded: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyConfigResponse', () => {
  it('maps the redacted config onto the display-pref state and stores github + configLoaded', () => {
    useReviewStore.getState().applyConfigResponse(mkConfigResponse({ github: { active: true, source: 'gh' } }));
    const s = useReviewStore.getState();
    expect(s.theme).toBe('dark');
    expect(s.accent).toBe('forest');
    expect(s.storyStructure).toBe('linear');
    expect(s.layoutMode).toBe('linear');
    expect(s.displayDensity).toBe('compact');
    expect(s.density).toBe('verbose'); // defaultNarrationDensity → density
    expect(s.clusterBots).toBe(false);
    expect(s.configLoaded).toBe(true);
    expect(s.serverConfig?.githubTokenSet).toBe(false);
  });

  it('flips github.active — the "saving tab comes alive" criterion', () => {
    expect(useReviewStore.getState().github).toBeNull();
    useReviewStore.getState().applyConfigResponse(mkConfigResponse({ github: { active: true, source: 'config' } }));
    expect(useReviewStore.getState().github).toEqual({ active: true, source: 'config' });
  });

  it('does not clobber a good default when a key is absent from the config', () => {
    useReviewStore.getState().applyConfigResponse({
      config: { githubTokenSet: false, aiApiKeySet: false },
      github: { active: false, source: null },
    });
    const s = useReviewStore.getState();
    expect(s.theme).toBe('auto'); // untouched
    expect(s.clusterBots).toBe(true); // untouched
    expect(s.configLoaded).toBe(true);
  });
});

describe('setTheme write-through', () => {
  it('flips the store optimistically AND issues exactly one PUT with a one-key body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(mkConfigResponse({ config: { githubTokenSet: false, aiApiKeySet: false, theme: 'dark' } })),
      );
    vi.stubGlobal('fetch', fetchMock);

    useReviewStore.getState().setTheme('dark');
    // Optimistic: the store flips before the PUT resolves.
    expect(useReviewStore.getState().theme).toBe('dark');

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/config');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ theme: 'dark' });
  });

  it('applies the PUT response — a github flip on save reaches the store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(mkConfigResponse({ github: { active: true, source: 'config' } }))),
    );
    useReviewStore.getState().setTheme('dark');
    await flush();
    expect(useReviewStore.getState().github).toEqual({ active: true, source: 'config' });
  });

  it('leaves serverConfig unchanged when the save fails (no phantom-applied state)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, 500)));
    useReviewStore.setState({ serverConfig: null });
    useReviewStore.getState().setTheme('dark');
    await flush();
    // Optimistic value stays (retry by re-toggling), but no server config was applied.
    expect(useReviewStore.getState().theme).toBe('dark');
    expect(useReviewStore.getState().serverConfig).toBeNull();
  });
});

describe('setAccent write-through', () => {
  it('flips optimistically and PUTs a one-key accent patch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mkConfigResponse()));
    vi.stubGlobal('fetch', fetchMock);
    useReviewStore.getState().setAccent('plum');
    expect(useReviewStore.getState().accent).toBe('plum');
    await flush();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ accent: 'plum' });
  });
});
