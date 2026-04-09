/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  DebugConfigurationFileSchema,
  type DebugConfiguration,
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

export interface ResolvedDebugConfiguration
  extends DebugConfigurationDiscovery {
  configuration: DebugConfiguration;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
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
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function resolveDebugConfiguration(
  configName: string,
  startDir = process.cwd(),
): Promise<ResolvedDebugConfiguration> {
  const discovered = await discoverDebugConfiguration(startDir);
  if (!discovered) {
    throw new Error(
      'No debug config found. Looked for .gemini/debug.json and .gemini/debug.config.json.',
    );
  }

  const configuration = discovered.config.configurations.find(
    (candidate) => candidate.name === configName,
  );
  if (!configuration) {
    throw new Error(
      `Debug configuration "${configName}" was not found in ${discovered.path}.`,
    );
  }

  return {
    ...discovered,
    configuration,
  };
}
