import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DiffDadConfig, getConfigPath, readConfig, writeConfig } from '../config';

// Isolate config on disk: point XDG_CONFIG_HOME at a fresh mkdtemp dir so readConfig/writeConfig
// touch a throwaway file instead of the developer's real ~/.config/diffdad/config.json.
let dir: string;
let prevXdg: string | undefined;
beforeEach(async () => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  dir = await mkdtemp(join(tmpdir(), 'diffdad-config-'));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  await rm(dir, { recursive: true, force: true });
});

describe('getConfigPath', () => {
  it('honors XDG_CONFIG_HOME', () => {
    expect(getConfigPath()).toBe(join(dir, 'diffdad', 'config.json'));
  });
});

describe('readConfig', () => {
  it('returns an empty object when no config file exists', async () => {
    expect(await readConfig()).toEqual({});
  });

  it('returns an empty object when the config file is malformed JSON', async () => {
    const path = getConfigPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'not valid json {');
    expect(await readConfig()).toEqual({});
  });
});

describe('writeConfig / readConfig round-trip', () => {
  it('persists a config and reads back the same values', async () => {
    const config: DiffDadConfig = {
      theme: 'dark',
      accent: 'forest',
      pollIntervalMs: 30_000,
      defaultCli: 'claude',
    };
    await writeConfig(config);
    expect(await readConfig()).toEqual(config);
  });

  it('creates the parent directory when it does not exist', async () => {
    // mkdtemp dir exists, but the diffdad/ subdir does not until writeConfig makes it.
    await writeConfig({ theme: 'light' });
    expect(await readConfig()).toEqual({ theme: 'light' });
  });
});
