/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  NodeInspectorRuntime,
  normalizeRuntimeCallFrame,
  resolveRuntimeScriptPath,
} from './nodeInspectorRuntime.js';

describe('nodeInspectorRuntime helpers', () => {
  it('resolves a file path from script metadata when the frame has only a scriptId', () => {
    const scriptsById = new Map([
      [
        '17',
        {
          scriptId: '17',
          url: 'file:///workspace/scripts/debug-smoke.js',
        },
      ],
    ]);

    expect(resolveRuntimeScriptPath(undefined, '17', scriptsById)).toBe(
      '/workspace/scripts/debug-smoke.js',
    );
  });

  it('normalizes paused frames using scriptParsed metadata', () => {
    const scriptsById = new Map([
      [
        '17',
        {
          scriptId: '17',
          url: 'file:///workspace/scripts/debug-smoke.js',
        },
      ],
    ]);

    const frame = normalizeRuntimeCallFrame(
      {
        callFrameId: 'frame-1',
        functionName: 'tick',
        location: {
          scriptId: '17',
          lineNumber: 3,
          columnNumber: 2,
        },
        scopeChain: [
          {
            type: 'local',
            object: {
              objectId: 'scope-1',
            },
          },
        ],
      },
      scriptsById,
    );

    expect(frame.filePath).toBe('/workspace/scripts/debug-smoke.js');
    expect(frame.line).toBe(4);
    expect(frame.column).toBe(3);
    expect(frame.functionName).toBe('tick');
    expect(frame.scopes[0]?.objectId).toBe('scope-1');
  });

  it('uses Runtime.runIfWaitingForDebugger for the first continue after attach startup', async () => {
    const runtime = new NodeInspectorRuntime('attach-test');
    const sentCommands: string[] = [];

    (
      runtime as unknown as {
        attachMayBeWaitingForDebugger: boolean;
        pausedState?: unknown;
        sendCommand: (method: string) => Promise<Record<string, never>>;
      }
    ).attachMayBeWaitingForDebugger = true;
    (
      runtime as unknown as {
        sendCommand: (method: string) => Promise<Record<string, never>>;
      }
    ).sendCommand = async (method: string) => {
      sentCommands.push(method);
      return {};
    };

    await runtime.continue();

    expect(sentCommands).toEqual(['Runtime.runIfWaitingForDebugger']);
  });
});
