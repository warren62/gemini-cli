/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugConfigurationSchema } from '../../types.js';
import type { DapMessageHandler } from '../localDapTransport.js';
import type { DapEvent, DapMessage, DapRequest } from '../dapProtocol.js';
import {
  NodeInspectorRuntime,
  type RuntimeCallFrame,
  type RuntimePausedState,
} from './nodeInspectorRuntime.js';

interface VariableHandle {
  objectId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function parseSetBreakpointsArgs(args: unknown): {
  sourcePath: string;
  breakpoints: Array<{ line: number; column?: number }>;
} {
  if (!isRecord(args)) {
    throw new Error('setBreakpoints requires arguments.');
  }

  const source = isRecord(args['source']) ? args['source'] : undefined;
  const sourcePath = source?.['path'];
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
    throw new Error('setBreakpoints requires a source.path.');
  }

  const rawBreakpoints = Array.isArray(args['breakpoints'])
    ? args['breakpoints']
    : [];
  const breakpoints = rawBreakpoints.flatMap((breakpoint) => {
    if (!isRecord(breakpoint)) {
      return [];
    }

    const line = toPositiveInteger(breakpoint['line']);
    if (line === undefined) {
      return [];
    }

    const column = toPositiveInteger(breakpoint['column']);
    return [
      {
        line,
        column,
      },
    ];
  });

  return {
    sourcePath,
    breakpoints,
  };
}

function isSupportedNodeType(type: string): boolean {
  return type === 'node' || type === 'pwa-node';
}

export class NodeDebugAdapter implements DapMessageHandler {
  private sendMessage: (message: DapMessage) => void = () => {};
  private closeTransport: (error?: Error) => void = () => {};
  private seq = 1;
  private runtime?: NodeInspectorRuntime;
  private pausedState?: RuntimePausedState;
  private readonly frameHandles = new Map<number, RuntimeCallFrame>();
  private readonly variableHandles = new Map<number, VariableHandle>();
  private nextHandle = 1;

  connect(
    sendMessage: (message: DapMessage) => void,
    close: (error?: Error) => void,
  ): void {
    this.sendMessage = sendMessage;
    this.closeTransport = close;
  }

  async handleRequest(message: DapRequest): Promise<void> {
    try {
      const body = await this.dispatchRequest(
        message.command,
        message.arguments,
      );
      this.sendMessage({
        seq: this.seq++,
        type: 'response',
        request_seq: message.seq,
        command: message.command,
        success: true,
        body,
      });
    } catch (error) {
      this.sendMessage({
        seq: this.seq++,
        type: 'response',
        request_seq: message.seq,
        command: message.command,
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async dispose(): Promise<void> {
    await this.runtime?.disconnect(false);
  }

  private async dispatchRequest(
    command: string,
    args: unknown,
  ): Promise<unknown> {
    switch (command) {
      case 'initialize':
        return {
          supportsConfigurationDoneRequest: true,
          supportsPauseContinue: true,
          supportTerminateDebuggee: true,
        };
      case 'launch':
        return this.handleLaunch(args);
      case 'attach':
        return this.handleAttach(args);
      case 'configurationDone':
        await this.runtime?.configurationDone();
        return {};
      case 'setBreakpoints':
        return this.handleSetBreakpoints(args);
      case 'threads':
        return {
          threads: this.runtime
            ? [
                {
                  id: 1,
                  name: 'main',
                },
              ]
            : [],
        };
      case 'stackTrace':
        return this.handleStackTrace();
      case 'scopes':
        return this.handleScopes(args);
      case 'variables':
        return this.handleVariables(args);
      case 'continue':
        await this.requireRuntime().continue();
        return {
          allThreadsContinued: true,
        };
      case 'pause':
        await this.requireRuntime().pause();
        return {};
      case 'disconnect': {
        const terminateDebuggee = isRecord(args)
          ? (toBoolean(args['terminateDebuggee']) ?? false)
          : false;
        await this.requireRuntime().disconnect(terminateDebuggee);
        return {};
      }
      default:
        throw new Error(`Unsupported debug adapter command "${command}".`);
    }
  }

  private async handleLaunch(args: unknown): Promise<Record<string, never>> {
    const config = DebugConfigurationSchema.parse(args);
    if (!isSupportedNodeType(config.type)) {
      throw new Error(
        `Unsupported debug runtime type "${config.type}". Phase 2 currently supports Node.js only.`,
      );
    }

    const runtime = new NodeInspectorRuntime(config.name);
    this.bindRuntime(runtime);
    await runtime.launch(config);
    this.runtime = runtime;
    return {};
  }

  private async handleAttach(args: unknown): Promise<Record<string, never>> {
    const config = DebugConfigurationSchema.parse(args);
    if (!isSupportedNodeType(config.type)) {
      throw new Error(
        `Unsupported debug runtime type "${config.type}". Phase 2 currently supports Node.js only.`,
      );
    }

    const runtime = new NodeInspectorRuntime(config.name);
    this.bindRuntime(runtime);
    await runtime.attach(config);
    this.runtime = runtime;
    return {};
  }

  private async handleSetBreakpoints(args: unknown): Promise<{
    breakpoints: Array<{ verified: boolean; line: number; column?: number }>;
  }> {
    const { sourcePath, breakpoints: normalizedBreakpoints } =
      parseSetBreakpointsArgs(args);

    await this.requireRuntime().setBreakpoints(
      sourcePath,
      normalizedBreakpoints,
    );

    return {
      breakpoints: normalizedBreakpoints.map((breakpoint) => ({
        verified: true,
        line: breakpoint.line,
        column: breakpoint.column,
      })),
    };
  }

  private handleStackTrace(): {
    stackFrames: Array<{
      id: number;
      name: string;
      source?: { path: string };
      line?: number;
      column?: number;
    }>;
  } {
    if (!this.pausedState) {
      return {
        stackFrames: [],
      };
    }

    this.frameHandles.clear();
    this.variableHandles.clear();
    this.nextHandle = 1;

    const stackFrames = this.pausedState.callFrames.map((frame) => {
      const frameId = this.nextHandle++;
      this.frameHandles.set(frameId, frame);
      return {
        id: frameId,
        name: frame.functionName,
        source: frame.filePath ? { path: frame.filePath } : undefined,
        line: frame.line,
        column: frame.column,
      };
    });

    return {
      stackFrames,
    };
  }

  private handleScopes(args: unknown): {
    scopes: Array<{ name: string; variablesReference: number }>;
  } {
    const frameId = isRecord(args)
      ? toPositiveInteger(args['frameId'])
      : undefined;
    if (frameId === undefined) {
      throw new Error('scopes requires a frameId.');
    }

    const frame = this.frameHandles.get(frameId);
    if (!frame) {
      return {
        scopes: [],
      };
    }

    return {
      scopes: frame.scopes
        .filter(
          (scope): scope is typeof scope & { objectId: string } =>
            typeof scope.objectId === 'string',
        )
        .map((scope) => ({
          name: scope.name,
          variablesReference: this.allocateVariableHandle(scope.objectId),
        })),
    };
  }

  private async handleVariables(args: unknown): Promise<{
    variables: Array<{
      name: string;
      value: string;
      type?: string;
      variablesReference: number;
    }>;
  }> {
    const variablesReference = isRecord(args)
      ? toPositiveInteger(args['variablesReference'])
      : undefined;
    if (variablesReference === undefined) {
      throw new Error('variables requires a variablesReference.');
    }

    const handle = this.variableHandles.get(variablesReference);
    if (!handle) {
      return {
        variables: [],
      };
    }

    const properties = await this.requireRuntime().getObjectProperties(
      handle.objectId,
    );
    return {
      variables: properties.map((property) => ({
        name: property.name,
        value: property.value,
        type: property.type,
        variablesReference: property.objectId
          ? this.allocateVariableHandle(property.objectId)
          : 0,
      })),
    };
  }

  private bindRuntime(runtime: NodeInspectorRuntime): void {
    runtime.on('paused', (pausedState: RuntimePausedState) => {
      this.pausedState = pausedState;
      this.publishEvent('stopped', {
        reason: pausedState.reason,
        description: pausedState.description,
        threadId: 1,
      });
    });
    runtime.on('resumed', () => {
      this.publishEvent('continued', {
        threadId: 1,
        allThreadsContinued: true,
      });
    });
    runtime.on('terminated', (exitCode?: number) => {
      this.publishEvent('terminated', {});
      if (exitCode !== undefined) {
        this.publishEvent('exited', {
          exitCode,
        });
      }
    });
    runtime.on('error', (error: Error) => {
      this.publishEvent('output', {
        category: 'stderr',
        output: `${error.message}\n`,
      });
      this.closeTransport(error);
    });
  }

  private publishEvent(event: string, body: Record<string, unknown>): void {
    const message: DapEvent<Record<string, unknown>> = {
      seq: this.seq++,
      type: 'event',
      event,
      body,
    };
    this.sendMessage(message);
  }

  private requireRuntime(): NodeInspectorRuntime {
    if (!this.runtime) {
      throw new Error('No active debug runtime.');
    }
    return this.runtime;
  }

  private allocateVariableHandle(objectId: string): number {
    const handleId = this.nextHandle++;
    this.variableHandles.set(handleId, {
      objectId,
    });
    return handleId;
  }
}
