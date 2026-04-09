/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugPausedSnapshot } from '../types.js';
import type {
  DebugProtocolVariable,
  DebugStoppedEventBody,
  DebugThread,
} from './types.js';

const MAX_STACK_FRAMES = 5;
const MAX_LOCALS = 10;
const MAX_VALUE_LENGTH = 200;

function truncateValue(value: string): string {
  return value.length > MAX_VALUE_LENGTH
    ? `${value.slice(0, MAX_VALUE_LENGTH)}...`
    : value;
}

function normalizeVariables(
  variables: readonly DebugProtocolVariable[],
): DebugPausedSnapshot['locals'] {
  return variables.slice(0, MAX_LOCALS).map((variable) => ({
    name: variable.name,
    value: truncateValue(variable.value),
    type: variable.type,
  }));
}

export interface DebugSnapshotClient {
  threads(): Promise<DebugThread[]>;
  stackTrace(threadId: number): Promise<
    Array<{
      id: number;
      name: string;
      source?: { path?: string };
      line?: number;
      column?: number;
    }>
  >;
  scopes(frameId: number): Promise<
    Array<{
      name: string;
      variablesReference: number;
    }>
  >;
  variables(variablesReference: number): Promise<DebugProtocolVariable[]>;
}

export async function normalizePausedSnapshot(
  client: DebugSnapshotClient,
  event: DebugStoppedEventBody,
  sessionName: string,
): Promise<DebugPausedSnapshot> {
  const threads = await client.threads();
  const threadId = event.threadId ?? threads[0]?.id;
  const frames =
    threadId === undefined ? [] : await client.stackTrace(threadId);
  const topFrames = frames.slice(0, MAX_STACK_FRAMES).map((frame) => ({
    id: frame.id,
    name: frame.name,
    filePath: frame.source?.path,
    line: frame.line,
    column: frame.column,
  }));

  let locals: DebugPausedSnapshot['locals'] = [];
  if (frames[0]?.id !== undefined) {
    const scopes = await client.scopes(frames[0].id);
    const preferredScopes = scopes.filter((scope) => {
      if (scope.variablesReference <= 0) {
        return false;
      }

      const normalizedName = scope.name.toLowerCase();
      return (
        normalizedName.includes('local') ||
        normalizedName.includes('closure') ||
        normalizedName.includes('block')
      );
    });

    if (preferredScopes.length > 0) {
      const localsByName = new Map<
        string,
        {
          name: string;
          value: string;
          type?: string;
        }
      >();
      for (const scope of preferredScopes) {
        const variables =
          normalizeVariables(
            await client.variables(scope.variablesReference),
          ) ?? [];
        for (const variable of variables) {
          if (!localsByName.has(variable.name)) {
            localsByName.set(variable.name, variable);
          }
          if (localsByName.size >= MAX_LOCALS) {
            break;
          }
        }
        if (localsByName.size >= MAX_LOCALS) {
          break;
        }
      }
      locals = Array.from(localsByName.values());
    }
  }

  return {
    reason: event.reason,
    description: event.description,
    threadId,
    sessionName,
    location:
      frames[0]?.source?.path && frames[0].line
        ? {
            filePath: frames[0].source.path,
            line: frames[0].line,
            column: frames[0].column,
          }
        : undefined,
    frames: topFrames,
    locals,
    timestamp: Date.now(),
  };
}
