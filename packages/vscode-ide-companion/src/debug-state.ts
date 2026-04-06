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
  const source = frame?.['source'] as Record<string, unknown> | undefined;
  const filePath = typeof source?.['path'] === 'string' ? source['path'] : undefined;
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
  const source = frame['source'] as Record<string, unknown> | undefined;
  return {
    id: toPositiveInt(frame['id']),
    name: typeof frame['name'] === 'string' ? frame['name'] : 'unknown',
    filePath: typeof source?.['path'] === 'string' ? source['path'] : undefined,
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
    const stackTraceResponse = (await session
      .customRequest('stackTrace', {
        threadId,
        startFrame: 0,
        levels: MAX_STACK_FRAMES,
      })
      .catch(() => undefined)) as
      | { stackFrames?: Array<Record<string, unknown>> }
      | undefined;

    const rawFrames = Array.isArray(stackTraceResponse?.stackFrames)
      ? stackTraceResponse.stackFrames
      : [];
    frames = rawFrames.slice(0, MAX_STACK_FRAMES).map(frameToIdeFrame);
    location = frameToBreakpoint(rawFrames[0]);

    const topFrameId = toPositiveInt(rawFrames[0]?.['id']);
    if (topFrameId !== undefined) {
      const scopesResponse = (await session
        .customRequest('scopes', {
          frameId: topFrameId,
        })
        .catch(() => undefined)) as
        | { scopes?: Array<Record<string, unknown>> }
        | undefined;

      const scopes = Array.isArray(scopesResponse?.scopes)
        ? scopesResponse.scopes
        : [];
      const localsScope = scopes.find((scope) => {
        const name = typeof scope['name'] === 'string' ? scope['name'] : '';
        return (
          name.toLowerCase().includes('local') &&
          toPositiveInt(scope['variablesReference']) !== undefined
        );
      });

      const variablesReference = toPositiveInt(localsScope?.['variablesReference']);
      if (variablesReference !== undefined) {
        const variablesResponse = (await session
          .customRequest('variables', {
            variablesReference,
            count: MAX_LOCALS,
          })
          .catch(() => undefined)) as
          | { variables?: Array<Record<string, unknown>> }
          | undefined;

        locals = (Array.isArray(variablesResponse?.variables)
          ? variablesResponse.variables
          : [])
          .slice(0, MAX_LOCALS)
          .map((variable) => ({
            name:
              typeof variable['name'] === 'string' ? variable['name'] : 'unknown',
            value: truncateValue(variable['value']),
            type:
              typeof variable['type'] === 'string'
                ? variable['type']
                : undefined,
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
