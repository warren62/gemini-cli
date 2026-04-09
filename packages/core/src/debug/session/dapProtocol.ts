/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DapRequest<T = unknown> {
  seq: number;
  type: 'request';
  command: string;
  arguments?: T;
}

export interface DapSuccessResponse<T = unknown> {
  seq: number;
  type: 'response';
  request_seq: number;
  command: string;
  success: true;
  body?: T;
}

export interface DapErrorResponse {
  seq: number;
  type: 'response';
  request_seq: number;
  command: string;
  success: false;
  message: string;
}

export type DapResponse<T = unknown> = DapSuccessResponse<T> | DapErrorResponse;

export interface DapEvent<T = unknown> {
  seq: number;
  type: 'event';
  event: string;
  body?: T;
}

export type DapMessage = DapResponse | DapEvent;
