/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import type {
  IdeBreakpoint,
  IdeDebugFrame,
  IdeDebugStop,
  IdeDebugVariable,
} from '@google/gemini-cli-core/src/debug/types.js';

const MAX_BREAKPOINTS = 50;
const MAX_STACK_FRAMES = 5;
const MAX_LOCALS = 10;
const MAX_VALUE_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStringProperty(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!record) {
    return undefined;
  }

  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getArrayProperty(
  record: Record<string, unknown> | undefined,
  key: string,
): unknown[] {
  if (!record) {
    return [];
  }

  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function truncateValue(value: unknown): string {
  const stringValue = String(value ?? '');
  return stringValue.length > MAX_VALUE_LENGTH
    ? `${stringValue.slice(0, MAX_VALUE_LENGTH)}…`
    : stringValue;
}

function toPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function frameToBreakpoint(
  frame: Record<string, unknown> | undefined,
): IdeBreakpoint | undefined {
  const source = isRecord(frame?.['source']) ? frame['source'] : undefined;
  const filePath = getStringProperty(source, 'path');
  const line = toPositiveInt(frame?.['line']);
  const column = toPositiveInt(frame?.['column']);

  if (!filePath || !line) {
    return undefined;
  }

  return {
    filePath,
    line,
    column,
  };
}

function frameToIdeFrame(frame: Record<string, unknown>): IdeDebugFrame {
  const source = isRecord(frame['source']) ? frame['source'] : undefined;
  return {
    id: toPositiveInt(frame['id']),
    name: getStringProperty(frame, 'name') ?? 'unknown',
    filePath: getStringProperty(source, 'path'),
    line: toPositiveInt(frame['line']),
    column: toPositiveInt(frame['column']),
  };
}

export function serializeBreakpoints(
  breakpoints: readonly vscode.Breakpoint[],
): IdeBreakpoint[] {
  return breakpoints
    .flatMap((breakpoint) => {
      if (
        !(breakpoint instanceof vscode.SourceBreakpoint) ||
        breakpoint.location.uri.scheme !== 'file'
      ) {
        return [];
      }

      return [
        {
          filePath: breakpoint.location.uri.fsPath,
          line: breakpoint.location.range.start.line + 1,
          column: breakpoint.location.range.start.character + 1,
          enabled: breakpoint.enabled,
          condition: breakpoint.condition,
          hitCondition: breakpoint.hitCondition,
          logMessage: breakpoint.logMessage,
        } satisfies IdeBreakpoint,
      ];
    })
    .slice(0, MAX_BREAKPOINTS);
}

export async function captureDebugStop(
  session: vscode.DebugSession,
  body: { reason?: string; description?: string; threadId?: number },
): Promise<IdeDebugStop> {
  const threadId = toPositiveInt(body.threadId);
  let frames: IdeDebugFrame[] = [];
  let locals: IdeDebugVariable[] = [];
  let location: IdeBreakpoint | undefined;

  if (threadId !== undefined) {
    const stackTraceResponse: unknown = await session
      .customRequest('stackTrace', {
        threadId,
        startFrame: 0,
        levels: MAX_STACK_FRAMES,
      })
      .catch(() => undefined);
    const stackTraceRecord = isRecord(stackTraceResponse)
      ? stackTraceResponse
      : undefined;

    const rawFrames = getArrayProperty(stackTraceRecord, 'stackFrames').flatMap(
      (frame) => (isRecord(frame) ? [frame] : []),
    );
    frames = rawFrames.slice(0, MAX_STACK_FRAMES).map(frameToIdeFrame);
    const firstFrame = rawFrames[0];
    location = frameToBreakpoint(firstFrame);

    const topFrameId = toPositiveInt(firstFrame?.['id']);
    if (topFrameId !== undefined) {
      const scopesResponse: unknown = await session
        .customRequest('scopes', {
          frameId: topFrameId,
        })
        .catch(() => undefined);
      const scopesRecord = isRecord(scopesResponse)
        ? scopesResponse
        : undefined;

      const scopes = getArrayProperty(scopesRecord, 'scopes').flatMap(
        (scope) => (isRecord(scope) ? [scope] : []),
      );
      const localsScope = scopes.find((scope) => {
        const name = getStringProperty(scope, 'name') ?? '';
        return (
          name.toLowerCase().includes('local') &&
          toPositiveInt(scope['variablesReference']) !== undefined
        );
      });

      const variablesReference = toPositiveInt(
        localsScope?.['variablesReference'],
      );
      if (variablesReference !== undefined) {
        const variablesResponse: unknown = await session
          .customRequest('variables', {
            variablesReference,
            count: MAX_LOCALS,
          })
          .catch(() => undefined);
        const variablesRecord = isRecord(variablesResponse)
          ? variablesResponse
          : undefined;

        locals = getArrayProperty(variablesRecord, 'variables')
          .flatMap((variable) => (isRecord(variable) ? [variable] : []))
          .slice(0, MAX_LOCALS)
          .map((variable) => ({
            name: getStringProperty(variable, 'name') ?? 'unknown',
            value: truncateValue(variable['value']),
            type: getStringProperty(variable, 'type') ?? undefined,
          }));
      }
    }
  }

  return {
    reason: body.reason ?? 'stopped',
    description: body.description,
    threadId,
    sessionName: session.name,
    location,
    frames,
    locals,
    timestamp: Date.now(),
  };
}
