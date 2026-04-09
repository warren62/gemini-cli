/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debugSessionManager, ideContextStore } from '@google/gemini-cli-core';
import { debugCommand } from './debugCommand.js';
import type { SlashCommand } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

const tempDirs: string[] = [];
const originalCwd = process.cwd();

async function makeTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gcli-debug-command-'),
  );
  tempDirs.push(tempDir);
  return tempDir;
}

type ExecutableSlashCommand = SlashCommand & {
  action: NonNullable<SlashCommand['action']>;
};

function getSubCommand(name: string): ExecutableSlashCommand {
  const command = debugCommand.subCommands?.find(
    (candidate) => candidate.name === name,
  );
  if (!command?.action) {
    throw new Error(`Missing /debug ${name} action`);
  }
  return command as ExecutableSlashCommand;
}

function getBreakSubCommand(name: string): ExecutableSlashCommand {
  const breakCommand = debugCommand.subCommands?.find(
    (candidate) => candidate.name === 'break',
  );
  const command = breakCommand?.subCommands?.find(
    (candidate) => candidate.name === name,
  );
  if (!command?.action) {
    throw new Error(`Missing /debug break ${name} action`);
  }
  return command as ExecutableSlashCommand;
}

describe('debugCommand', () => {
  beforeEach(async () => {
    ideContextStore.clear();
    await debugSessionManager.reset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    ideContextStore.clear();
    vi.restoreAllMocks();
    await debugSessionManager.reset();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })),
    );
  });

  it('stores real CLI-owned breakpoints via /debug break', async () => {
    const breakCommand = getSubCommand('break');

    const result = await breakCommand.action(
      createMockCommandContext(),
      '@src/foo.ts:87',
    );

    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
      }),
    );
    expect(debugSessionManager.listBreakpoints()).toHaveLength(1);
    expect(debugSessionManager.listBreakpoints()[0]?.target.normalized).toBe(
      '@src/foo.ts:87',
    );
  });

  it('lists and removes CLI-owned breakpoints', async () => {
    const breakCommand = getSubCommand('break');
    const listCommand = getBreakSubCommand('list');
    const removeCommand = getBreakSubCommand('remove');

    await breakCommand.action(createMockCommandContext(), '@src/foo.ts:87');

    const listResult = await listCommand.action(createMockCommandContext(), '');
    expect((listResult as { content: string }).content).toContain(
      'CLI-owned breakpoints: 1',
    );

    const removeResult = await removeCommand.action(
      createMockCommandContext(),
      '@src/foo.ts:87',
    );
    expect((removeResult as { content: string }).content).toContain(
      'Removed breakpoint',
    );
    expect(debugSessionManager.listBreakpoints()).toHaveLength(0);
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
            program: 'dist/index.js',
          },
        ],
      }),
    );
    process.chdir(tempDir);

    const configCommand = debugCommand.subCommands?.find(
      (command) => command.name === 'config',
    );
    const validateCommand = configCommand?.subCommands?.find(
      (command) => command.name === 'validate',
    );
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

  it('renders CLI-owned status before IDE mirror context', async () => {
    await debugSessionManager.addBreakpoint('@src/foo.ts:87');
    ideContextStore.set({
      workspaceState: {
        breakpoints: [
          {
            filePath: 'src/from-ide.ts',
            line: 90,
          },
        ],
        lastDebugStop: {
          reason: 'breakpoint',
          threadId: 1,
          sessionName: 'ide app',
          timestamp: Date.now(),
        },
      },
    });

    const statusCommand = getSubCommand('status');
    const result = await statusCommand.action(createMockCommandContext(), '');
    const content = (result as { content: string }).content;

    expect(content).toContain('CLI session state: idle');
    expect(content).toContain('CLI breakpoints: 1');
    expect(content).toContain('IDE mirror context:');
  });

  it('delegates /debug start to the CLI-owned session manager', async () => {
    const startCommand = getSubCommand('start');
    const startSpy = vi
      .spyOn(debugSessionManager, 'startSession')
      .mockResolvedValue({
        sessionId: 'session-1',
        configName: 'app',
        adapterType: 'node',
        requestType: 'launch',
        status: 'running',
        activeBreakpoints: [],
        startedAt: Date.now(),
      });

    const result = await startCommand.action(createMockCommandContext(), 'app');
    expect(startSpy).toHaveBeenCalledWith('app');
    expect((result as { content: string }).content).toContain(
      'Debug session app (launch) is running.',
    );
  });
});
