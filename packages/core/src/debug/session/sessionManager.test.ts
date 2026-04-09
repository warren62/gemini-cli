/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DebugConfiguration } from '../types.js';
import { DapClient } from './dapClient.js';
import type { DapMessage, DapRequest } from './dapProtocol.js';
import type { DapTransport } from './localDapTransport.js';
import {
  DebugSessionManager,
  type DebugAdapterClientFactory,
} from './sessionManager.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gcli-debug-session-'),
  );
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })),
  );
});

class FakeDapTransport implements DapTransport {
  private readonly messageListeners = new Set<(message: DapMessage) => void>();
  private readonly closeListeners = new Set<(error?: Error) => void>();
  readonly requests: Array<{ command: string; arguments: unknown }> = [];

  async start(): Promise<void> {}

  async send(message: DapRequest): Promise<void> {
    this.requests.push({
      command: message.command,
      arguments: message.arguments,
    });

    const responseBody = this.getResponseBody(message.command);
    const response: DapMessage = {
      seq: message.seq,
      type: 'response',
      request_seq: message.seq,
      command: message.command,
      success: true,
      body: responseBody,
    };
    this.emitMessage(response);
  }

  async close(): Promise<void> {
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  onMessage(listener: (message: DapMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  emitStopped(): void {
    this.emitMessage({
      seq: 999,
      type: 'event',
      event: 'stopped',
      body: {
        reason: 'breakpoint',
        threadId: 1,
      },
    });
  }

  private emitMessage(message: DapMessage): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private getResponseBody(command: string): unknown {
    switch (command) {
      case 'threads':
        return {
          threads: [{ id: 1, name: 'main' }],
        };
      case 'stackTrace':
        return {
          stackFrames: [
            {
              id: 101,
              name: 'main',
              source: { path: '/workspace/src/index.ts' },
              line: 10,
              column: 4,
            },
          ],
        };
      case 'scopes':
        return {
          scopes: [
            {
              name: 'Locals',
              variablesReference: 501,
            },
          ],
        };
      case 'variables':
        return {
          variables: [
            {
              name: 'count',
              value: '3',
              type: 'number',
              variablesReference: 0,
            },
          ],
        };
      default:
        return {};
    }
  }
}

class FakeAdapterFactory implements DebugAdapterClientFactory {
  readonly transports: FakeDapTransport[] = [];

  create(_config: DebugConfiguration): DapClient {
    const transport = new FakeDapTransport();
    this.transports.push(transport);
    return new DapClient(transport);
  }
}

async function writeDebugConfig(
  rootDir: string,
  configuration: DebugConfiguration,
): Promise<void> {
  await fs.mkdir(path.join(rootDir, '.gemini'), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, '.gemini', 'debug.json'),
    JSON.stringify({
      configurations: [configuration],
    }),
  );
}

describe('DebugSessionManager', () => {
  it('starts a config-backed session and transitions to paused on stop events', async () => {
    const rootDir = await makeTempDir();
    await writeDebugConfig(rootDir, {
      name: 'app',
      type: 'node',
      request: 'launch',
      program: 'dist/index.js',
    });

    const factory = new FakeAdapterFactory();
    const manager = new DebugSessionManager(factory, () => rootDir);
    await manager.addBreakpoint('@src/index.ts:10');

    await manager.startSession('app', { startDir: rootDir });
    expect(manager.getStatus().lifecycleStatus).toBe('running');

    factory.transports[0]?.emitStopped();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const status = manager.getStatus();
    expect(status.lifecycleStatus).toBe('paused');
    expect(status.session?.latestPausedSnapshot?.reason).toBe('breakpoint');
    expect(status.session?.latestPausedSnapshot?.locals?.[0]?.name).toBe(
      'count',
    );
  });

  it('applies config breakpoints and syncs breakpoint updates to the adapter', async () => {
    const rootDir = await makeTempDir();
    await writeDebugConfig(rootDir, {
      name: 'app',
      type: 'node',
      request: 'launch',
      program: 'dist/index.js',
      breakpoints: [
        {
          raw: '@src/from-config.ts:12',
          filePath: 'src/from-config.ts',
          line: 12,
          normalized: '@src/from-config.ts:12',
        },
      ],
    });

    const factory = new FakeAdapterFactory();
    const manager = new DebugSessionManager(factory, () => rootDir);

    await manager.startSession('app', { startDir: rootDir });
    await manager.addBreakpoint('@src/runtime.ts:20');
    await manager.removeBreakpoint('@src/runtime.ts:20');

    const requests = factory.transports[0]?.requests ?? [];
    expect(manager.listBreakpoints()).toHaveLength(1);
    expect(
      requests.filter((request) => request.command === 'setBreakpoints').length,
    ).toBeGreaterThan(0);
  });

  it('marks startup failures as errored', async () => {
    const rootDir = await makeTempDir();
    await writeDebugConfig(rootDir, {
      name: 'bad',
      type: 'python',
      request: 'launch',
      program: 'main.py',
    });

    const manager = new DebugSessionManager(
      new FakeAdapterFactory(),
      () => rootDir,
    );
    await expect(
      manager.startSession('bad', { startDir: rootDir }),
    ).rejects.toThrow('Unsupported debug runtime type "python"');
    expect(manager.getStatus().lifecycleStatus).toBe('errored');
  });
});
