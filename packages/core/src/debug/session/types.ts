/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DebugConfiguration,
  DebugFrame,
  DebugPausedSnapshot,
  DebugSessionLifecycleStatus,
  DebugStoredBreakpoint,
  DebugVariable,
} from '../types.js';

export interface DebugSessionState {
  sessionId: string;
  configName: string;
  adapterType: string;
  requestType: DebugConfiguration['request'];
  status: DebugSessionLifecycleStatus;
  activeBreakpoints: DebugStoredBreakpoint[];
  latestPausedSnapshot?: DebugPausedSnapshot;
  selectedThreadId?: number;
  selectedFrameId?: number;
  startedAt: number;
  configPath?: string;
  workingDirectory?: string;
  errorMessage?: string;
}

export interface DebugStatusSnapshot {
  lifecycleStatus: DebugSessionLifecycleStatus;
  session?: DebugSessionState;
}

export interface DebugStopLocation {
  filePath?: string;
  line?: number;
  column?: number;
}

export interface DebugStoppedEventBody {
  reason: string;
  description?: string;
  threadId?: number;
}

export interface DebugThread {
  id: number;
  name: string;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  source?: {
    path?: string;
  };
  line?: number;
  column?: number;
}

export interface DebugScope {
  name: string;
  variablesReference: number;
}

export interface DebugProtocolVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference?: number;
}

export interface DebugPausedSnapshotDetails {
  frames: DebugFrame[];
  locals: DebugVariable[];
  location?: DebugStopLocation;
}

export interface DebugSessionManagerOptions {
  startDir?: string;
}
