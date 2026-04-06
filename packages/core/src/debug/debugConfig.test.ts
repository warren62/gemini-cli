/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverDebugConfiguration,
  loadDebugConfiguration,
} from './debugConfig.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcli-debug-config-'));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })),
  );
});

describe('debugConfig', () => {
  it('discovers debug config by searching upward', async () => {
    const rootDir = await makeTempDir();
    const nestedDir = path.join(rootDir, 'packages', 'cli');
    await fs.mkdir(path.join(rootDir, '.gemini'), { recursive: true });
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(
      path.join(rootDir, '.gemini', 'debug.json'),
      JSON.stringify({
        configurations: [
          {
            name: 'app',
            type: 'node',
            request: 'launch',
            program: 'src/index.ts',
          },
        ],
      }),
    );

    const discovered = await discoverDebugConfiguration(nestedDir);
    expect(discovered?.path).toBe(path.join(rootDir, '.gemini', 'debug.json'));
    expect(discovered?.config.configurations).toHaveLength(1);
  });

  it('returns null when no config exists', async () => {
    const rootDir = await makeTempDir();
    expect(await discoverDebugConfiguration(rootDir)).toBeNull();
  });

  it('validates loaded config content', async () => {
    const rootDir = await makeTempDir();
    const configPath = path.join(rootDir, 'debug.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        configurations: [
          {
            name: 'attach',
            type: 'node',
            request: 'attach',
            port: 9229,
          },
        ],
      }),
    );

    const loaded = await loadDebugConfiguration(configPath);
    expect(loaded?.config.configurations[0]?.request).toBe('attach');
  });

  it('throws for invalid configs', async () => {
    const rootDir = await makeTempDir();
    const configPath = path.join(rootDir, 'debug.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        configurations: [
          {
            name: 'broken',
          },
        ],
      }),
    );

    await expect(loadDebugConfiguration(configPath)).rejects.toThrow();
  });
});
