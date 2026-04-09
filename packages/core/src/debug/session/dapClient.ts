/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type { DebugConfiguration, DebugStoredBreakpoint } from '../types.js';
import type { DapEvent, DapMessage, DapRequest } from './dapProtocol.js';
import type {
  DebugProtocolVariable,
  DebugScope,
  DebugStackFrame,
  DebugStoppedEventBody,
  DebugThread,
} from './types.js';
import type { DapTransport } from './localDapTransport.js';

type DapEventListener = (event: DapEvent) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toDebugThread(value: unknown): DebugThread | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = value['id'];
  const name = value['name'];
  if (typeof id !== 'number' || typeof name !== 'string') {
    return undefined;
  }

  return { id, name };
}

function toDebugStackFrame(value: unknown): DebugStackFrame | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = value['id'];
  const name = value['name'];
  if (typeof id !== 'number' || typeof name !== 'string') {
    return undefined;
  }

  const source = isRecord(value['source']) ? value['source'] : undefined;
  const sourcePath = source?.['path'];
  const line = value['line'];
  const column = value['column'];

  return {
    id,
    name,
    source: typeof sourcePath === 'string' ? { path: sourcePath } : undefined,
    line: typeof line === 'number' ? line : undefined,
    column: typeof column === 'number' ? column : undefined,
  };
}

function toDebugScope(value: unknown): DebugScope | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = value['name'];
  const variablesReference = value['variablesReference'];
  if (typeof name !== 'string' || typeof variablesReference !== 'number') {
    return undefined;
  }

  return {
    name,
    variablesReference,
  };
}

function toDebugVariable(value: unknown): DebugProtocolVariable | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = value['name'];
  const variableValue = value['value'];
  const type = value['type'];
  const variablesReference = value['variablesReference'];
  if (typeof name !== 'string' || typeof variableValue !== 'string') {
    return undefined;
  }

  return {
    name,
    value: variableValue,
    type: typeof type === 'string' ? type : undefined,
    variablesReference:
      typeof variablesReference === 'number' ? variablesReference : undefined,
  };
}

function getArray<T>(
  value: unknown,
  key: string,
  parser: (entry: unknown) => T | undefined,
): T[] {
  if (!isRecord(value)) {
    return [];
  }

  const entries = value[key];
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.flatMap((entry) => {
    const parsed = parser(entry);
    return parsed ? [parsed] : [];
  });
}

export class DapClient {
  private nextSeq = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private readonly eventListeners = new Set<DapEventListener>();
  private readonly lastBreakpointSources = new Set<string>();
  private removeMessageListener?: () => void;
  private removeCloseListener?: () => void;
  private started = false;

  constructor(private readonly transport: DapTransport) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.removeMessageListener = this.transport.onMessage((message) => {
      this.handleMessage(message);
    });
    this.removeCloseListener = this.transport.onClose((error) => {
      const reason = error ?? new Error('Debug adapter transport closed.');
      for (const pending of this.pending.values()) {
        pending.reject(reason);
      }
      this.pending.clear();
    });
    await this.transport.start();
    this.started = true;
  }

  onEvent(listener: DapEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  async initialize(adapterId: string): Promise<void> {
    await this.request('initialize', {
      adapterID: adapterId,
      clientID: 'gemini-cli',
      clientName: 'Gemini CLI',
      linesStartAt1: true,
      columnsStartAt1: true,
      locale: 'en-US',
      pathFormat: 'path',
      supportsVariablePaging: true,
    });
  }

  async launch(config: DebugConfiguration): Promise<void> {
    await this.request('launch', config);
  }

  async attach(config: DebugConfiguration): Promise<void> {
    await this.request('attach', config);
  }

  async configurationDone(): Promise<void> {
    await this.request('configurationDone', {});
  }

  async setBreakpoints(
    breakpoints: readonly DebugStoredBreakpoint[],
    cwd: string,
  ): Promise<void> {
    const grouped = new Map<string, Array<{ line: number; column?: number }>>();

    for (const breakpoint of breakpoints) {
      const sourcePath = path.isAbsolute(breakpoint.target.filePath)
        ? breakpoint.target.filePath
        : path.resolve(cwd, breakpoint.target.filePath);
      const sourceBreakpoints = grouped.get(sourcePath) ?? [];
      sourceBreakpoints.push({
        line: breakpoint.target.line,
        column: breakpoint.target.column,
      });
      grouped.set(sourcePath, sourceBreakpoints);
    }

    const allSources = new Set([
      ...this.lastBreakpointSources,
      ...grouped.keys(),
    ]);

    for (const sourcePath of allSources) {
      await this.request('setBreakpoints', {
        source: {
          path: sourcePath,
        },
        breakpoints: grouped.get(sourcePath) ?? [],
      });
    }

    this.lastBreakpointSources.clear();
    for (const sourcePath of grouped.keys()) {
      this.lastBreakpointSources.add(sourcePath);
    }
  }

  async threads(): Promise<DebugThread[]> {
    const response = await this.request('threads', {});
    return getArray(response, 'threads', toDebugThread);
  }

  async stackTrace(threadId: number): Promise<DebugStackFrame[]> {
    const response = await this.request('stackTrace', {
      threadId,
      startFrame: 0,
      levels: 5,
    });
    return getArray(response, 'stackFrames', toDebugStackFrame);
  }

  async scopes(frameId: number): Promise<DebugScope[]> {
    const response = await this.request('scopes', {
      frameId,
    });
    return getArray(response, 'scopes', toDebugScope);
  }

  async variables(
    variablesReference: number,
  ): Promise<DebugProtocolVariable[]> {
    const response = await this.request('variables', {
      variablesReference,
      count: 10,
    });
    return getArray(response, 'variables', toDebugVariable);
  }

  async continue(threadId: number): Promise<void> {
    await this.request('continue', {
      threadId,
    });
  }

  async pause(threadId: number): Promise<void> {
    await this.request('pause', {
      threadId,
    });
  }

  async disconnect(terminateDebuggee: boolean): Promise<void> {
    await this.request('disconnect', {
      terminateDebuggee,
    });
  }

  async close(): Promise<void> {
    this.removeMessageListener?.();
    this.removeCloseListener?.();
    this.removeMessageListener = undefined;
    this.removeCloseListener = undefined;
    this.started = false;
    await this.transport.close();
  }

  private async request(command: string, args: unknown): Promise<unknown> {
    const seq = this.nextSeq++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(seq, {
        resolve,
        reject,
      });
    });

    const request: DapRequest = {
      seq,
      type: 'request',
      command,
      arguments: args,
    };

    await this.transport.send(request);
    return promise;
  }

  private handleMessage(message: DapMessage): void {
    if (message.type === 'event') {
      for (const listener of this.eventListeners) {
        listener(message);
      }
      return;
    }

    const pending = this.pending.get(message.request_seq);
    if (!pending) {
      return;
    }
    this.pending.delete(message.request_seq);

    if (message.success) {
      pending.resolve(message.body ?? {});
      return;
    }

    pending.reject(new Error(message.message));
  }
}

export function isStoppedEvent(
  event: DapEvent,
): event is DapEvent<DebugStoppedEventBody> {
  return event.event === 'stopped';
}
