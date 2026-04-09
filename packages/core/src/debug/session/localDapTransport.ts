/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import type { DapMessage, DapRequest } from './dapProtocol.js';

type MessageListener = (message: DapMessage) => void;
type CloseListener = (error?: Error) => void;

export interface DapMessageHandler {
  connect(
    sendMessage: (message: DapMessage) => void,
    close: (error?: Error) => void,
  ): void;
  handleRequest(message: DapRequest): Promise<void>;
  dispose(): Promise<void>;
}

export interface DapTransport {
  start(): Promise<void>;
  send(message: DapRequest): Promise<void>;
  close(): Promise<void>;
  onMessage(listener: MessageListener): () => void;
  onClose(listener: CloseListener): () => void;
}

export class LocalDapTransport implements DapTransport {
  private readonly emitter = new EventEmitter();

  constructor(private readonly handler: DapMessageHandler) {}

  async start(): Promise<void> {
    this.handler.connect(
      (message) => {
        this.emitter.emit('message', message);
      },
      (error) => {
        this.emitter.emit('close', error);
      },
    );
  }

  async send(message: DapRequest): Promise<void> {
    await this.handler.handleRequest(message);
  }

  async close(): Promise<void> {
    await this.handler.dispose();
    this.emitter.emit('close');
  }

  onMessage(listener: MessageListener): () => void {
    this.emitter.on('message', listener);
    return () => {
      this.emitter.off('message', listener);
    };
  }

  onClose(listener: CloseListener): () => void {
    this.emitter.on('close', listener);
    return () => {
      this.emitter.off('close', listener);
    };
  }
}
