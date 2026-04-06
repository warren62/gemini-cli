/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  DebugConfigurationFileSchema,
  type DebugConfigurationFile,
} from './types.js';

export const DEBUG_CONFIG_FILENAMES = [
  '.gemini/debug.json',
  '.gemini/debug.config.json',
] as const;

export interface DebugConfigurationDiscovery {
  path: string;
  config: DebugConfigurationFile;
  raw: string;
}

export async function discoverDebugConfiguration(
  startDir = process.cwd(),
): Promise<DebugConfigurationDiscovery | null> {
  let currentDir = path.resolve(startDir);

  while (true) {
    for (const relativeFilename of DEBUG_CONFIG_FILENAMES) {
      const configPath = path.join(currentDir, relativeFilename);
      const loaded = await loadDebugConfiguration(configPath);
      if (loaded) {
        return loaded;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

export async function loadDebugConfiguration(
  configPath: string,
): Promise<DebugConfigurationDiscovery | null> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const config = DebugConfigurationFileSchema.parse(parsed);
    return {
      path: configPath,
      config,
      raw,
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
