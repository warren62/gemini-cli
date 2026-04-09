/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetch, WebSocket } from 'undici';
import type { DebugConfiguration } from '../../types.js';

interface RuntimeScope {
  type: string;
  name: string;
  objectId?: string;
}

export interface RuntimeCallFrame {
  callFrameId: string;
  functionName: string;
  filePath?: string;
  line?: number;
  column?: number;
  scopes: RuntimeScope[];
}

export interface RuntimePausedState {
  reason: string;
  description?: string;
  callFrames: RuntimeCallFrame[];
}

interface RemoteObjectDescriptor {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
}

interface RuntimeProperty {
  name?: string;
  value?: RemoteObjectDescriptor;
  enumerable?: boolean;
}

interface RuntimeScriptMetadata {
  scriptId: string;
  url?: string;
}

interface ParsedInspectorMessage {
  id?: number;
  errorMessage?: string;
  result?: unknown;
  method?: string;
  params?: Record<string, unknown>;
}

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

function getBooleanProperty(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  if (!record) {
    return undefined;
  }

  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
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

function getRecordProperty(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!record) {
    return undefined;
  }

  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function parseInspectorMessage(rawMessage: string): ParsedInspectorMessage {
  const parsed: unknown = JSON.parse(rawMessage);
  if (!isRecord(parsed)) {
    return {};
  }

  const error = getRecordProperty(parsed, 'error');
  const id = parsed['id'];

  return {
    id: typeof id === 'number' ? id : undefined,
    errorMessage: getStringProperty(error, 'message'),
    result: parsed['result'],
    method: getStringProperty(parsed, 'method'),
    params: getRecordProperty(parsed, 'params'),
  };
}

function toRemoteObjectDescriptor(
  value: unknown,
): RemoteObjectDescriptor | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    type: getStringProperty(value, 'type'),
    subtype: getStringProperty(value, 'subtype'),
    value: value['value'],
    description: getStringProperty(value, 'description'),
    objectId: getStringProperty(value, 'objectId'),
  };
}

function toRuntimeProperty(value: unknown): RuntimeProperty | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = getStringProperty(value, 'name');
  return {
    name,
    value: toRemoteObjectDescriptor(value['value']),
    enumerable: getBooleanProperty(value, 'enumerable'),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toFilePath(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  if (url.startsWith('file://')) {
    return fileURLToPath(url);
  }

  return url;
}

function toNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function formatRemoteValue(object: RemoteObjectDescriptor | undefined): string {
  if (!object) {
    return 'undefined';
  }

  if (object.subtype === 'null') {
    return 'null';
  }

  if (object.value !== undefined) {
    return String(object.value);
  }

  if (object.description) {
    return object.description;
  }

  return object.type ?? 'unknown';
}

function createUrlRegex(sourcePath: string): string {
  const asFileUrl = pathToFileURL(sourcePath).href;
  const normalizedForwardSlash = sourcePath.replace(/\\/g, '/');
  return `^(?:${escapeRegExp(asFileUrl)}|${escapeRegExp(normalizedForwardSlash)}|${escapeRegExp(sourcePath)})$`;
}

export function resolveRuntimeScriptPath(
  directUrl: string | undefined,
  scriptId: string | undefined,
  scriptsById: ReadonlyMap<string, RuntimeScriptMetadata>,
): string | undefined {
  if (directUrl) {
    return toFilePath(directUrl);
  }

  if (!scriptId) {
    return undefined;
  }

  return toFilePath(scriptsById.get(scriptId)?.url);
}

export function normalizeRuntimeCallFrame(
  callFrame: unknown,
  scriptsById: ReadonlyMap<string, RuntimeScriptMetadata>,
): RuntimeCallFrame {
  const typedCallFrame = isRecord(callFrame) ? callFrame : undefined;
  const location = getRecordProperty(typedCallFrame, 'location');
  const scopes = getArrayProperty(typedCallFrame, 'scopeChain');
  const scriptId = getStringProperty(location, 'scriptId');
  const directUrl = getStringProperty(typedCallFrame, 'url');
  const lineNumber = toNonNegativeInteger(location?.['lineNumber']);
  const columnNumber = toNonNegativeInteger(location?.['columnNumber']);
  const callFrameId = getStringProperty(typedCallFrame, 'callFrameId');
  const functionName = getStringProperty(typedCallFrame, 'functionName');

  return {
    callFrameId: callFrameId ?? 'frame',
    functionName:
      functionName && functionName.length > 0 ? functionName : '(anonymous)',
    filePath: resolveRuntimeScriptPath(directUrl, scriptId, scriptsById),
    line: lineNumber !== undefined ? lineNumber + 1 : undefined,
    column: columnNumber !== undefined ? columnNumber + 1 : undefined,
    scopes: scopes.map((scope) => {
      const typedScope = isRecord(scope) ? scope : undefined;
      const object = getRecordProperty(typedScope, 'object');
      const type = getStringProperty(typedScope, 'type') ?? 'local';
      return {
        type,
        name:
          getStringProperty(typedScope, 'name') ??
          (type === 'local' ? 'Locals' : type),
        objectId: getStringProperty(object, 'objectId'),
      };
    }),
  };
}

async function waitForWebSocketUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const onData = (chunk: Buffer | string) => {
      stderr += chunk.toString();
      const match = stderr.match(/ws:\/\/[^\s]+/);
      if (match?.[0]) {
        cleanup();
        resolve(match[0]);
      }
    };
    const onExit = () => {
      cleanup();
      reject(
        new Error(
          stderr
            ? `Node process exited before debugger startup: ${stderr.trim()}`
            : 'Node process exited before debugger startup.',
        ),
      );
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    };

    child.stderr?.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function discoverWebSocketUrl(
  host: string,
  port: number,
): Promise<string> {
  const versionResponse = await fetch(`http://${host}:${port}/json/version`);
  if (versionResponse.ok) {
    const body = await versionResponse.json();
    if (isRecord(body)) {
      const socketUrl = getStringProperty(body, 'webSocketDebuggerUrl');
      if (socketUrl) {
        return socketUrl;
      }
    }
  }

  const listResponse = await fetch(`http://${host}:${port}/json/list`);
  if (!listResponse.ok) {
    throw new Error(
      `Unable to discover Node debugger at ${host}:${port} (${listResponse.status}).`,
    );
  }

  const body = await listResponse.json();
  const entries = Array.isArray(body) ? body : [];
  const socketUrl = entries
    .flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }
      const value = getStringProperty(entry, 'webSocketDebuggerUrl');
      return value ? [value] : [];
    })
    .at(0);
  if (!socketUrl) {
    throw new Error(`No websocket debugger URL found at ${host}:${port}.`);
  }
  return socketUrl;
}

export class NodeInspectorRuntime extends EventEmitter {
  private websocket?: WebSocket;
  private childProcess?: ChildProcess;
  private readonly pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private readonly requestedBreakpoints = new Map<
    string,
    Array<{ line: number; column?: number }>
  >();
  private readonly activeBreakpointIds = new Map<string, string[]>();
  private readonly scriptsById = new Map<string, RuntimeScriptMetadata>();
  private nextRequestId = 1;
  private disposed = false;
  private emittedTermination = false;
  private waitingForConfiguration = false;
  private awaitingInitialPause = false;
  private attachMayBeWaitingForDebugger = false;
  private stopOnEntry = false;
  private pauseRequested = false;
  private pausedState?: RuntimePausedState;

  constructor(private readonly sessionName: string) {
    super();
  }

  async launch(config: DebugConfiguration): Promise<void> {
    const cwd = path.resolve(config.cwd ?? process.cwd());
    const program = config.program
      ? path.isAbsolute(config.program)
        ? config.program
        : path.resolve(cwd, config.program)
      : undefined;
    if (!program) {
      throw new Error(
        `Debug configuration "${config.name}" requires a program for launch requests.`,
      );
    }

    const runtimeExecutable = config.runtimeExecutable ?? process.execPath;
    const runtimeArgs = config.runtimeArgs ?? [];
    const args = config.args ?? [];
    const child = spawn(
      runtimeExecutable,
      [...runtimeArgs, '--inspect-brk=0', program, ...args],
      {
        cwd,
        env: {
          ...process.env,
          ...config.env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    this.childProcess = child;
    child.once('exit', (code) => {
      this.emitTermination(code ?? undefined);
    });
    child.once('error', (error) => {
      this.emit('error', error);
      this.emitTermination();
    });

    const websocketUrl = await waitForWebSocketUrl(child);
    await this.connect(websocketUrl);

    this.waitingForConfiguration = true;
    this.awaitingInitialPause = true;
    this.attachMayBeWaitingForDebugger = false;
    this.stopOnEntry = config.stopOnEntry ?? false;
  }

  async attach(config: DebugConfiguration): Promise<void> {
    const host = config.host ?? '127.0.0.1';
    if (!config.port) {
      throw new Error(
        `Debug configuration "${config.name}" requires a port for attach requests.`,
      );
    }

    const websocketUrl = await discoverWebSocketUrl(host, config.port);
    await this.connect(websocketUrl);
    this.waitingForConfiguration = false;
    this.awaitingInitialPause = false;
    this.attachMayBeWaitingForDebugger = true;
    this.stopOnEntry = false;
  }

  async configurationDone(): Promise<void> {
    if (!this.waitingForConfiguration) {
      return;
    }

    this.waitingForConfiguration = false;
    await this.sendCommand('Runtime.runIfWaitingForDebugger');
  }

  async setBreakpoints(
    sourcePath: string,
    breakpoints: Array<{ line: number; column?: number }>,
  ): Promise<void> {
    this.requestedBreakpoints.set(sourcePath, breakpoints);
    if (this.websocket) {
      await this.applySourceBreakpoints(sourcePath);
    }
  }

  async continue(): Promise<void> {
    const wasPaused = this.pausedState !== undefined;
    this.pausedState = undefined;
    if (!wasPaused && this.attachMayBeWaitingForDebugger) {
      this.attachMayBeWaitingForDebugger = false;
      try {
        await this.sendCommand('Runtime.runIfWaitingForDebugger');
        return;
      } catch {
        // Fall through to a normal resume if the target was not actually
        // blocked on the initial inspector startup gate.
      }
    }

    await this.sendCommand('Debugger.resume');
  }

  async pause(): Promise<void> {
    this.pauseRequested = true;
    await this.sendCommand('Debugger.pause');
  }

  async disconnect(terminateDebuggee: boolean): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('Debug runtime disconnected.'));
    }
    this.pendingRequests.clear();

    if (terminateDebuggee) {
      this.childProcess?.kill();
    }
    this.websocket?.close();
    this.websocket = undefined;

    if (!this.childProcess) {
      this.emitTermination();
    }
  }

  getPausedState(): RuntimePausedState | undefined {
    return this.pausedState;
  }

  async getObjectProperties(objectId: string): Promise<
    Array<{
      name: string;
      value: string;
      type?: string;
      objectId?: string;
    }>
  > {
    const response = await this.sendCommand('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: false,
    });
    const result =
      isRecord(response) && Array.isArray(response['result'])
        ? response['result']
        : [];
    const properties = result.flatMap((property) => {
      const parsed = toRuntimeProperty(property);
      return parsed ? [parsed] : [];
    });

    return properties
      .filter(
        (property) =>
          property.enumerable !== false && typeof property.name === 'string',
      )
      .map((property) => ({
        name: property.name ?? 'unknown',
        value: formatRemoteValue(property.value),
        type: property.value?.type,
        objectId: property.value?.objectId,
      }));
  }

  private async connect(websocketUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const websocket = new WebSocket(websocketUrl);
      this.websocket = websocket;

      websocket.onopen = () => {
        resolve();
      };
      websocket.onerror = (event) => {
        reject(
          new Error(
            event.error instanceof Error
              ? event.error.message
              : 'Failed to connect to the Node inspector.',
          ),
        );
      };
      websocket.onclose = () => {
        this.emitTermination();
      };
      websocket.onmessage = (event) => {
        this.handleProtocolMessage(String(event.data));
      };
    });

    await this.sendCommand('Runtime.enable');
    await this.sendCommand('Debugger.enable');
    await this.applyAllBreakpoints();
  }

  private handleProtocolMessage(rawMessage: string): void {
    const message = parseInspectorMessage(rawMessage);
    const id = message.id;
    if (id !== undefined) {
      const pending = this.pendingRequests.get(id);
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(id);
      if (message.errorMessage) {
        pending.reject(new Error(message.errorMessage));
        return;
      }

      pending.resolve(message.result);
      return;
    }

    const method = message.method;
    if (!method) {
      return;
    }

    if (method === 'Debugger.paused') {
      void this.handlePausedMessage(message.params);
      return;
    }

    if (method === 'Debugger.scriptParsed') {
      this.handleScriptParsed(message.params);
      return;
    }

    if (method === 'Debugger.resumed') {
      this.emit('resumed');
    }
  }

  private handleScriptParsed(
    params: Record<string, unknown> | undefined,
  ): void {
    const scriptId = getStringProperty(params, 'scriptId');
    if (!scriptId) {
      return;
    }

    this.scriptsById.set(scriptId, {
      scriptId,
      url: getStringProperty(params, 'url'),
    });
  }

  private async handlePausedMessage(
    params: Record<string, unknown> | undefined,
  ): Promise<void> {
    const pausedState = this.toPausedState(params);
    const hitBreakpoints = getArrayProperty(params, 'hitBreakpoints');

    if (this.awaitingInitialPause && hitBreakpoints.length === 0) {
      this.awaitingInitialPause = false;
      if (!this.stopOnEntry) {
        await this.continue();
        return;
      }
      pausedState.reason = 'entry';
    } else if (this.pauseRequested) {
      this.pauseRequested = false;
      pausedState.reason = 'pause';
    } else if (hitBreakpoints.length > 0) {
      pausedState.reason = 'breakpoint';
    }

    this.pausedState = pausedState;
    this.attachMayBeWaitingForDebugger = false;
    this.emit('paused', pausedState);
  }

  private toPausedState(
    params: Record<string, unknown> | undefined,
  ): RuntimePausedState {
    const rawFrames = getArrayProperty(params, 'callFrames');

    return {
      reason: getStringProperty(params, 'reason') ?? 'stopped',
      description:
        getStringProperty(params, 'data') ??
        getStringProperty(params, 'description'),
      callFrames: rawFrames.map((frame) =>
        normalizeRuntimeCallFrame(frame, this.scriptsById),
      ),
    };
  }

  private async applyAllBreakpoints(): Promise<void> {
    for (const sourcePath of this.requestedBreakpoints.keys()) {
      await this.applySourceBreakpoints(sourcePath);
    }
  }

  private async applySourceBreakpoints(sourcePath: string): Promise<void> {
    const previousIds = this.activeBreakpointIds.get(sourcePath) ?? [];
    for (const breakpointId of previousIds) {
      await this.sendCommand('Debugger.removeBreakpoint', {
        breakpointId,
      }).catch(() => undefined);
    }

    const requested = this.requestedBreakpoints.get(sourcePath) ?? [];
    const newIds: string[] = [];
    for (const breakpoint of requested) {
      const response = await this.sendCommand('Debugger.setBreakpointByUrl', {
        lineNumber: breakpoint.line - 1,
        columnNumber: (breakpoint.column ?? 1) - 1,
        urlRegex: createUrlRegex(sourcePath),
      });
      if (isRecord(response)) {
        const breakpointId = getStringProperty(response, 'breakpointId');
        if (breakpointId) {
          newIds.push(breakpointId);
        }
      }
    }

    this.activeBreakpointIds.set(sourcePath, newIds);
  }

  private async sendCommand(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const websocket = this.websocket;
    if (!websocket) {
      throw new Error(
        `Debug runtime for "${this.sessionName}" is not connected.`,
      );
    }

    const id = this.nextRequestId++;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject,
      });
    });

    websocket.send(
      JSON.stringify({
        id,
        method,
        params,
      }),
    );

    return response;
  }

  private emitTermination(exitCode?: number): void {
    if (this.emittedTermination) {
      return;
    }

    this.emittedTermination = true;
    this.emit('terminated', exitCode);
  }
}
