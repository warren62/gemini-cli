/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseDebugBreakpointTarget } from '../debugTarget.js';
import { DebugBreakpointStore } from './breakpointStore.js';

describe('DebugBreakpointStore', () => {
  it('stores and deduplicates normalized breakpoints', () => {
    const store = new DebugBreakpointStore();

    const first = store.add(
      parseDebugBreakpointTarget('@src/index.ts:10'),
      'cli',
    );
    const duplicate = store.add(
      parseDebugBreakpointTarget('src/index.ts:10'),
      'cli',
    );

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.id).toBe('bp-1');
  });

  it('removes breakpoints by id or normalized target', () => {
    const store = new DebugBreakpointStore();
    const added = store.add(
      parseDebugBreakpointTarget('@src/index.ts:10'),
      'cli',
    );

    expect(store.remove(added.breakpoint.id)?.id).toBe(added.breakpoint.id);
    expect(store.list()).toHaveLength(0);

    store.add(parseDebugBreakpointTarget('@src/index.ts:11'), 'cli');
    expect(store.remove('src/index.ts:11')?.target.normalized).toBe(
      '@src/index.ts:11',
    );
    expect(store.list()).toHaveLength(0);
  });
});
