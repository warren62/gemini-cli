/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugBreakpointTargetSchema, type DebugBreakpointTarget } from './types.js';

const DEBUG_TARGET_REGEX = /^@?(?<filePath>.+):(?<line>\d+)(?::(?<column>\d+))?$/;

export function isDebugBreakpointTarget(value: string): boolean {
  return DEBUG_TARGET_REGEX.test(value.trim());
}

export function normalizeDebugBreakpointTarget(
  target: Pick<DebugBreakpointTarget, 'filePath' | 'line' | 'column'>,
): string {
  const normalized = `@${target.filePath}:${target.line}`;
  return target.column ? `${normalized}:${target.column}` : normalized;
}

export function parseDebugBreakpointTarget(
  rawValue: string,
): DebugBreakpointTarget {
  const raw = rawValue.trim();
  const match = DEBUG_TARGET_REGEX.exec(raw);
  if (!match?.groups) {
    throw new Error(
      `Invalid breakpoint target "${rawValue}". Expected @file:line or @file:line:column.`,
    );
  }

  const filePath = match.groups['filePath']?.trim();
  const line = Number.parseInt(match.groups['line'] ?? '', 10);
  const columnRaw = match.groups['column'];
  const column =
    columnRaw === undefined ? undefined : Number.parseInt(columnRaw, 10);

  if (!filePath || Number.isNaN(line) || line <= 0) {
    throw new Error(
      `Invalid breakpoint target "${rawValue}". Expected a positive line number.`,
    );
  }

  if (column !== undefined && (Number.isNaN(column) || column <= 0)) {
    throw new Error(
      `Invalid breakpoint target "${rawValue}". Expected a positive column number.`,
    );
  }

  const normalized = normalizeDebugBreakpointTarget({ filePath, line, column });

  return DebugBreakpointTargetSchema.parse({
    raw,
    filePath,
    line,
    column,
    normalized,
  });
}
