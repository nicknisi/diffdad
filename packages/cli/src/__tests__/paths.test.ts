import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dataDir, legacyDir, migrateLegacyData } from '../paths';

describe('data paths', () => {
  it('puts durable data in a real app-data location, distinct from the cache dir', () => {
    expect(dataDir()).not.toBe(legacyDir());
    expect(dataDir()).toContain('diffdad');
    expect(legacyDir()).toContain('.cache');
    if (process.platform === 'darwin') expect(dataDir()).toContain('Application Support');
    else expect(dataDir()).not.toContain('.cache');
  });
});

describe('migrateLegacyData', () => {
  let from: string;
  let to: string;
  beforeEach(async () => {
    from = await mkdtemp(join(tmpdir(), 'diffdad-legacy-'));
    to = await mkdtemp(join(tmpdir(), 'diffdad-data-'));
    await rm(to, { recursive: true, force: true }); // exercise the fresh-install path: `to` absent
  });
  afterEach(async () => {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  });

  it('moves durable subdirs (units, agent-comments) from the legacy dir into the data dir', async () => {
    await mkdir(join(from, 'units'), { recursive: true });
    await writeFile(join(from, 'units', 'u1.json'), '{"unitId":"u1"}');
    await mkdir(join(from, 'agent-comments'), { recursive: true });
    await writeFile(join(from, 'agent-comments', 'unit-u1.json'), '[]');

    await migrateLegacyData({ from, to });

    expect(await readFile(join(to, 'units', 'u1.json'), 'utf-8')).toContain('u1');
    expect(await readFile(join(to, 'agent-comments', 'unit-u1.json'), 'utf-8')).toBe('[]');
  });

  it('leaves regenerable caches behind — only durable data moves', async () => {
    await writeFile(join(from, 'owner-repo-1-abc.json'), '{}'); // a narrative cache file
    await mkdir(join(from, 'units'), { recursive: true });
    await writeFile(join(from, 'units', 'u1.json'), '{}');

    await migrateLegacyData({ from, to });

    expect(await readFile(join(from, 'owner-repo-1-abc.json'), 'utf-8')).toBe('{}'); // still in cache
    await expect(access(join(to, 'owner-repo-1-abc.json'))).rejects.toThrow(); // not copied to data
  });

  it('never clobbers data already present in the destination', async () => {
    await mkdir(join(from, 'units'), { recursive: true });
    await writeFile(join(from, 'units', 'u1.json'), 'LEGACY');
    await mkdir(join(to, 'units'), { recursive: true });
    await writeFile(join(to, 'units', 'u1.json'), 'CURRENT');

    await migrateLegacyData({ from, to });

    expect(await readFile(join(to, 'units', 'u1.json'), 'utf-8')).toBe('CURRENT');
  });

  it('is a no-op when there is nothing to migrate', async () => {
    await migrateLegacyData({ from, to }); // `from` is empty
    await expect(access(join(to, 'units'))).rejects.toThrow();
  });
});
