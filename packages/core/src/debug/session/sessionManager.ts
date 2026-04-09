/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { DebugConfiguration, DebugStoredBreakpoint } from '../types.js';
import { parseDebugBreakpointTarget } from '../debugTarget.js';
import { resolveDebugConfiguration } from '../debugConfig.js';
import { DebugBreakpointStore } from './breakpointStore.js';
import { DapClient, isStoppedEvent } from './dapClient.js';
import { normalizePausedSnapshot } from './pausedSnapshot.js';
import type { DapEvent } from './dapProtocol.js';
import type {
  DebugSessionManagerOptions,
  DebugSessionState,
  DebugStatusSnapshot,
} from './types.js';
import { LocalDapTransport } from './localDapTransport.js';
import { NodeDebugAdapter } from './node/nodeDebugAdapter.js';

export interface DebugAdapterClientFactory {
  create(config: DebugConfiguration): DapClient;
}

export class DefaultDebugAdapterClientFactory
  implements DebugAdapterClientFactory
{
  create(config: DebugConfiguration): DapClient {
    if (config.type !== 'node' && config.type !== 'pwa-node') {
      throw new Error(
        `Unsupported debug runtime type "${config.type}". Phase 2 currently supports Node.js only.`,
      );
    }

    return new DapClient(new LocalDapTransport(new NodeDebugAdapter()));
  }
}

export class DebugSessionManager {
  private readonly breakpointStore = new DebugBreakpointStore();
  private readonly subscribers = new Set<
    (status: DebugStatusSnapshot) => void
  >();
  private readonly adapterFactory: DebugAdapterClientFactory;
  private readonly cwdProvider: () => string;
  private status: DebugStatusSnapshot = {
    lifecycleStatus: 'idle',
  };
  private activeClient?: DapClient;
  private removeClientListener?: () => void;

  constructor(
    adapterFactory: DebugAdapterClientFactory = new DefaultDebugAdapterClientFactory(),
    cwdProvider: () => string = () => process.cwd(),
  ) {
    this.adapterFactory = adapterFactory;
    this.cwdProvider = cwdProvider;
  }

  subscribe(listener: (status: DebugStatusSnapshot) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  getStatus(): DebugStatusSnapshot {
    return {
      lifecycleStatus: this.status.lifecycleStatus,
      session: this.status.session
        ? {
            ...this.status.session,
            activeBreakpoints: [...this.status.session.activeBreakpoints],
            latestPausedSnapshot: this.status.session.latestPausedSnapshot
              ? {
                  ...this.status.session.latestPausedSnapshot,
                  frames: [
                    ...(this.status.session.latestPausedSnapshot.frames ?? []),
                  ],
                  locals: [
                    ...(this.status.session.latestPausedSnapshot.locals ?? []),
                  ],
                }
              : undefined,
          }
        : undefined,
    };
  }

  listBreakpoints(): DebugStoredBreakpoint[] {
    return this.breakpointStore.list();
  }

  async addBreakpoint(target: string): Promise<{
    breakpoint: DebugStoredBreakpoint;
    created: boolean;
  }> {
    const parsed = parseDebugBreakpointTarget(target);
    const result = this.breakpointStore.add(parsed, 'cli');
    this.refreshBreakpointsOnSession();
    await this.syncBreakpointsToActiveSession();
    return result;
  }

  async removeBreakpoint(targetOrId: string): Promise<DebugStoredBreakpoint> {
    const removed = this.breakpointStore.remove(targetOrId);
    if (!removed) {
      throw new Error(`No stored breakpoint found for "${targetOrId}".`);
    }

    this.refreshBreakpointsOnSession();
    await this.syncBreakpointsToActiveSession();
    return removed;
  }

  async startSession(
    configName: string,
    options: DebugSessionManagerOptions = {},
  ): Promise<DebugSessionState> {
    return this.startInternal(configName, undefined, options);
  }

  async attachSession(
    configName: string,
    options: DebugSessionManagerOptions = {},
  ): Promise<DebugSessionState> {
    return this.startInternal(configName, 'attach', options);
  }

  async continueSession(): Promise<DebugSessionState> {
    const session = this.requireSession();
    await this.requireClient().continue(session.selectedThreadId ?? 1);
    this.updateSession({
      ...session,
      status: 'running',
    });
    return this.requireSession();
  }

  async pauseSession(): Promise<DebugSessionState> {
    const session = this.requireSession();
    await this.requireClient().pause(session.selectedThreadId ?? 1);
    return session;
  }

  async stopSession(): Promise<DebugSessionState> {
    const session = this.requireSession();
    await this.requireClient().disconnect(true);
    this.updateSession({
      ...session,
      status: 'stopped',
    });
    return this.requireSession();
  }

  async reset(): Promise<void> {
    this.breakpointStore.clear();
    this.removeClientListener?.();
    this.removeClientListener = undefined;
    if (this.activeClient) {
      await this.activeClient.close();
      this.activeClient = undefined;
    }
    this.status = {
      lifecycleStatus: 'idle',
    };
    this.notifySubscribers();
  }

  private async startInternal(
    configName: string,
    expectedRequestType: DebugConfiguration['request'] | undefined,
    options: DebugSessionManagerOptions,
  ): Promise<DebugSessionState> {
    this.ensureNoRunningSession();

    const resolved = await resolveDebugConfiguration(
      configName,
      options.startDir ?? this.cwdProvider(),
    );

    if (
      expectedRequestType &&
      resolved.configuration.request !== expectedRequestType
    ) {
      throw new Error(
        `Debug configuration "${configName}" is a ${resolved.configuration.request} configuration, not ${expectedRequestType}.`,
      );
    }

    if (resolved.configuration.breakpoints?.length) {
      this.breakpointStore.addMany(
        resolved.configuration.breakpoints,
        'config',
      );
    }

    const session: DebugSessionState = {
      sessionId: randomUUID(),
      configName: resolved.configuration.name,
      adapterType: resolved.configuration.type,
      requestType: resolved.configuration.request,
      status: 'starting',
      activeBreakpoints: this.breakpointStore.list(),
      startedAt: Date.now(),
      configPath: resolved.path,
      workingDirectory: path.resolve(
        resolved.configuration.cwd ?? this.cwdProvider(),
      ),
    };
    this.updateSession(session);

    if (this.activeClient) {
      this.removeClientListener?.();
      this.removeClientListener = undefined;
      await this.activeClient.close();
      this.activeClient = undefined;
    }

    const client = this.adapterFactory.create(resolved.configuration);
    this.activeClient = client;
    try {
      await client.start();
      this.removeClientListener?.();
      this.removeClientListener = client.onEvent((event) => {
        void this.handleClientEvent(event);
      });

      await client.initialize(resolved.configuration.type);
      if (resolved.configuration.request === 'launch') {
        await client.launch(resolved.configuration);
      } else {
        await client.attach(resolved.configuration);
      }

      await client.setBreakpoints(
        this.breakpointStore.list(),
        session.workingDirectory ?? path.resolve(this.cwdProvider()),
      );
      await client.configurationDone();

      const currentSession = this.requireSession();
      if (currentSession.status === 'starting') {
        this.updateSession({
          ...currentSession,
          status: 'running',
        });
      }
    } catch (error) {
      this.updateSession({
        ...session,
        status: 'errored',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return this.requireSession();
  }

  private async handleClientEvent(event: DapEvent): Promise<void> {
    const session = this.status.session;
    if (!session) {
      return;
    }

    if (isStoppedEvent(event)) {
      if (!event.body) {
        return;
      }
      const pausedSnapshot = await normalizePausedSnapshot(
        this.requireClient(),
        event.body,
        session.configName,
      );
      this.updateSession({
        ...session,
        status: 'paused',
        selectedThreadId: pausedSnapshot.threadId,
        selectedFrameId: pausedSnapshot.frames?.[0]?.id,
        latestPausedSnapshot: pausedSnapshot,
      });
      return;
    }

    if (event.event === 'continued') {
      this.updateSession({
        ...session,
        status: 'running',
      });
      return;
    }

    if (event.event === 'terminated' || event.event === 'exited') {
      this.updateSession({
        ...session,
        status: 'stopped',
      });
      return;
    }
  }

  private refreshBreakpointsOnSession(): void {
    const session = this.status.session;
    if (!session) {
      return;
    }

    this.updateSession({
      ...session,
      activeBreakpoints: this.breakpointStore.list(),
    });
  }

  private async syncBreakpointsToActiveSession(): Promise<void> {
    const session = this.status.session;
    if (!session || !this.activeClient) {
      return;
    }

    await this.activeClient.setBreakpoints(
      this.breakpointStore.list(),
      session.workingDirectory ?? path.resolve(this.cwdProvider()),
    );
  }

  private ensureNoRunningSession(): void {
    const lifecycleStatus = this.status.lifecycleStatus;
    if (
      lifecycleStatus === 'starting' ||
      lifecycleStatus === 'running' ||
      lifecycleStatus === 'paused'
    ) {
      throw new Error('A debug session is already active.');
    }
  }

  private requireSession(): DebugSessionState {
    if (!this.status.session) {
      throw new Error('No active debug session.');
    }
    return this.status.session;
  }

  private requireClient(): DapClient {
    if (!this.activeClient) {
      throw new Error('No active debug adapter client.');
    }
    return this.activeClient;
  }

  private updateSession(session: DebugSessionState): void {
    this.status = {
      lifecycleStatus: session.status,
      session: {
        ...session,
        activeBreakpoints: [...session.activeBreakpoints],
      },
    };
    this.notifySubscribers();
  }

  private notifySubscribers(): void {
    const status = this.getStatus();
    for (const subscriber of this.subscribers) {
      subscriber(status);
    }
  }
}

export const debugSessionManager = new DebugSessionManager();
