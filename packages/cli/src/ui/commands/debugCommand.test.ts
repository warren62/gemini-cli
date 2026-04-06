/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ideContextStore } from '@google/gemini-cli-core';
import { debugCommand } from './debugCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

const tempDirs: string[] = [];
const originalCwd = process.cwd();

async function makeTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcli-debug-command-'));
  tempDirs.push(tempDir);
  return tempDir;
}

describe('debugCommand', () => {
  beforeEach(() => {
    ideContextStore.clear();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    ideContextStore.clear();
    await Promise.all(
      tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })),
    );
  });

  it('returns a submit prompt for parsed breakpoint targets', async () => {
    const context = createMockCommandContext();
    const breakCommand = debugCommand.subCommands?.find((command) => command.name === 'break');
    if (!breakCommand?.action) {
      throw new Error('Missing /debug break action');
    }

    const result = await breakCommand.action(context, '@src/foo.ts:87');
    expect(result?.type).toBe('submit_prompt');
    expect(context.ui.addItem).toHaveBeenCalled();
  });

  it('validates discovered debug config', async () => {
    const tempDir = await makeTempDir();
    await fs.mkdir(path.join(tempDir, '.gemini'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, '.gemini', 'debug.json'),
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
    process.chdir(tempDir);

    const configCommand = debugCommand.subCommands?.find((command) => command.name === 'config');
    const validateCommand = configCommand?.subCommands?.find((command) => command.name === 'validate');
    if (!validateCommand?.action) {
      throw new Error('Missing /debug config validate action');
    }

    const result = await validateCommand.action(createMockCommandContext(), '');
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
      }),
    );
  });

  it('renders IDE debug status', async () => {
    ideContextStore.set({
      workspaceState: {
        breakpoints: [
          {
            filePath: 'src/foo.ts',
            line: 87,
          },
        ],
        lastDebugStop: {
          reason: 'breakpoint',
          threadId: 1,
          sessionName: 'node app',
          timestamp: Date.now(),
          frames: [
            {
              name: 'main',
              filePath: 'src/foo.ts',
              line: 87,
            },
          ],
          locals: [
            {
              name: 'count',
              value: '3',
            },
          ],
        },
      },
    });

    const statusCommand = debugCommand.subCommands?.find((command) => command.name === 'status');
    if (!statusCommand?.action) {
      throw new Error('Missing /debug status action');
    }

    const result = await statusCommand.action(createMockCommandContext(), '');
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Breakpoints: 1'),
      }),
    );
    expect((result as { content: string }).content).toContain('Last stop reason: breakpoint');
  });
});
