/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { normalizePausedSnapshot } from './pausedSnapshot.js';

describe('normalizePausedSnapshot', () => {
  it('normalizes stack frames and locals from protocol responses', async () => {
    const snapshot = await normalizePausedSnapshot(
      {
        threads: async () => [{ id: 7, name: 'main' }],
        stackTrace: async () => [
          {
            id: 101,
            name: 'main',
            source: { path: '/workspace/src/index.ts' },
            line: 10,
            column: 4,
          },
        ],
        scopes: async () => [
          {
            name: 'Locals',
            variablesReference: 2001,
          },
        ],
        variables: async () => [
          {
            name: 'count',
            value: '3',
            type: 'number',
          },
          {
            name: 'message',
            value: 'x'.repeat(240),
            type: 'string',
          },
        ],
      },
      {
        reason: 'breakpoint',
        threadId: 7,
      },
      'app',
    );

    expect(snapshot.reason).toBe('breakpoint');
    expect(snapshot.location).toEqual({
      filePath: '/workspace/src/index.ts',
      line: 10,
      column: 4,
    });
    expect(snapshot.frames?.[0]?.name).toBe('main');
    expect(snapshot.locals?.[0]).toEqual({
      name: 'count',
      value: '3',
      type: 'number',
    });
    expect(snapshot.locals?.[1]?.value.endsWith('...')).toBe(true);
  });

  it('collects closure variables when useful locals are not in the first scope', async () => {
    const snapshot = await normalizePausedSnapshot(
      {
        threads: async () => [{ id: 7, name: 'main' }],
        stackTrace: async () => [
          {
            id: 101,
            name: 'tick',
            source: { path: '/workspace/scripts/debug-smoke.js' },
            line: 4,
            column: 1,
          },
        ],
        scopes: async () => [
          {
            name: 'Global',
            variablesReference: 0,
          },
          {
            name: 'Closure',
            variablesReference: 3001,
          },
          {
            name: 'Locals',
            variablesReference: 3002,
          },
        ],
        variables: async (variablesReference) =>
          variablesReference === 3002
            ? []
            : [
                {
                  name: 'count',
                  value: '1',
                  type: 'number',
                },
                {
                  name: 'next',
                  value: '2',
                  type: 'number',
                },
              ],
      },
      {
        reason: 'breakpoint',
        threadId: 7,
      },
      'app',
    );

    expect(snapshot.locals).toEqual([
      {
        name: 'count',
        value: '1',
        type: 'number',
      },
      {
        name: 'next',
        value: '2',
        type: 'number',
      },
    ]);
  });
});
