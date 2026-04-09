/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DebugStoredBreakpointSchema,
  type DebugBreakpointTarget,
  type DebugStoredBreakpoint,
} from '../types.js';
import { parseDebugBreakpointTarget } from '../debugTarget.js';

export class DebugBreakpointStore {
  private readonly breakpointsById = new Map<string, DebugStoredBreakpoint>();
  private readonly breakpointIdsByTarget = new Map<string, string>();
  private nextId = 1;

  list(): DebugStoredBreakpoint[] {
    return Array.from(this.breakpointsById.values());
  }

  clear(): void {
    this.breakpointsById.clear();
    this.breakpointIdsByTarget.clear();
    this.nextId = 1;
  }

  add(
    target: DebugBreakpointTarget,
    source: DebugStoredBreakpoint['source'] = 'cli',
  ): { breakpoint: DebugStoredBreakpoint; created: boolean } {
    const existingId = this.breakpointIdsByTarget.get(target.normalized);
    if (existingId) {
      const existing = this.breakpointsById.get(existingId);
      if (!existing) {
        throw new Error(
          `Breakpoint store is inconsistent for target ${target.normalized}.`,
        );
      }

      return {
        breakpoint: existing,
        created: false,
      };
    }

    const breakpoint = DebugStoredBreakpointSchema.parse({
      id: `bp-${this.nextId++}`,
      target,
      source,
      enabled: true,
    });

    this.breakpointsById.set(breakpoint.id, breakpoint);
    this.breakpointIdsByTarget.set(target.normalized, breakpoint.id);

    return {
      breakpoint,
      created: true,
    };
  }

  addMany(
    targets: readonly DebugBreakpointTarget[],
    source: DebugStoredBreakpoint['source'],
  ): DebugStoredBreakpoint[] {
    return targets.map((target) => this.add(target, source).breakpoint);
  }

  remove(targetOrId: string): DebugStoredBreakpoint | undefined {
    const byId = this.breakpointsById.get(targetOrId);
    if (byId) {
      this.breakpointsById.delete(targetOrId);
      this.breakpointIdsByTarget.delete(byId.target.normalized);
      return byId;
    }

    const normalized = parseDebugBreakpointTarget(targetOrId).normalized;
    const id = this.breakpointIdsByTarget.get(normalized);
    if (!id) {
      return undefined;
    }

    const breakpoint = this.breakpointsById.get(id);
    if (!breakpoint) {
      throw new Error(`Breakpoint store is inconsistent for id ${id}.`);
    }

    this.breakpointsById.delete(id);
    this.breakpointIdsByTarget.delete(normalized);
    return breakpoint;
  }
}
