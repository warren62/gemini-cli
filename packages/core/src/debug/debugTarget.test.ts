/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  isDebugBreakpointTarget,
  normalizeDebugBreakpointTarget,
  parseDebugBreakpointTarget,
} from './debugTarget.js';

describe('debugTarget', () => {
  it('parses @path:line targets', () => {
    expect(parseDebugBreakpointTarget('@src/foo.ts:10')).toEqual({
      raw: '@src/foo.ts:10',
      filePath: 'src/foo.ts',
      line: 10,
      normalized: '@src/foo.ts:10',
    });
  });

  it('parses path:line:column targets', () => {
    expect(parseDebugBreakpointTarget('src/foo.ts:10:4')).toEqual({
      raw: 'src/foo.ts:10:4',
      filePath: 'src/foo.ts',
      line: 10,
      column: 4,
      normalized: '@src/foo.ts:10:4',
    });
  });

  it('supports windows-style paths', () => {
    expect(parseDebugBreakpointTarget('@C:\\repo\\foo.ts:8').normalized).toBe(
      '@C:\\repo\\foo.ts:8',
    );
  });

  it('validates the target shape', () => {
    expect(isDebugBreakpointTarget('@src/foo.ts:12')).toBe(true);
    expect(isDebugBreakpointTarget('@src/foo.ts')).toBe(false);
  });

  it('normalizes parsed values', () => {
    expect(
      normalizeDebugBreakpointTarget({
        filePath: 'src/foo.ts',
        line: 10,
        column: 4,
      }),
    ).toBe('@src/foo.ts:10:4');
  });

  it('rejects invalid targets', () => {
    expect(() => parseDebugBreakpointTarget('@src/foo.ts')).toThrow();
    expect(() => parseDebugBreakpointTarget('@src/foo.ts:0')).toThrow();
    expect(() => parseDebugBreakpointTarget('@src/foo.ts:2:0')).toThrow();
  });
});
