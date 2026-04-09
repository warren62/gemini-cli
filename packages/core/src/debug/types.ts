/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

export const DebugBreakpointTargetSchema = z.object({
  raw: z.string(),
  filePath: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  normalized: z.string(),
});
export type DebugBreakpointTarget = z.infer<typeof DebugBreakpointTargetSchema>;

export const DebugConfigurationSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  request: z.enum(['launch', 'attach']),
  cwd: z.string().optional(),
  program: z.string().optional(),
  runtimeExecutable: z.string().optional(),
  runtimeArgs: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  stopOnEntry: z.boolean().optional(),
  breakpoints: z.array(DebugBreakpointTargetSchema).optional(),
  adapterOptions: z.record(z.unknown()).optional(),
});
export type DebugConfiguration = z.infer<typeof DebugConfigurationSchema>;

export const DebugConfigurationFileSchema = z.object({
  configurations: z.array(DebugConfigurationSchema).default([]),
});
export type DebugConfigurationFile = z.infer<
  typeof DebugConfigurationFileSchema
>;

export const IdeBreakpointSchema = z.object({
  filePath: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  condition: z.string().optional(),
  hitCondition: z.string().optional(),
  logMessage: z.string().optional(),
});
export type IdeBreakpoint = z.infer<typeof IdeBreakpointSchema>;

export const DebugVariableSchema = z.object({
  name: z.string(),
  value: z.string(),
  type: z.string().optional(),
});
export type DebugVariable = z.infer<typeof DebugVariableSchema>;

export const IdeDebugVariableSchema = DebugVariableSchema;
export type IdeDebugVariable = z.infer<typeof IdeDebugVariableSchema>;

export const DebugFrameSchema = z.object({
  id: z.number().int().optional(),
  name: z.string(),
  filePath: z.string().optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});
export type DebugFrame = z.infer<typeof DebugFrameSchema>;

export const IdeDebugFrameSchema = DebugFrameSchema;
export type IdeDebugFrame = z.infer<typeof IdeDebugFrameSchema>;

export const DebugPausedSnapshotSchema = z.object({
  reason: z.string(),
  description: z.string().optional(),
  threadId: z.number().int().optional(),
  sessionName: z.string().optional(),
  location: IdeBreakpointSchema.optional(),
  frames: z.array(DebugFrameSchema).optional(),
  locals: z.array(DebugVariableSchema).optional(),
  timestamp: z.number(),
});
export type DebugPausedSnapshot = z.infer<typeof DebugPausedSnapshotSchema>;

export const IdeDebugStopSchema = DebugPausedSnapshotSchema;
export type IdeDebugStop = z.infer<typeof IdeDebugStopSchema>;

export const DebugStoredBreakpointSchema = z.object({
  id: z.string().min(1),
  target: DebugBreakpointTargetSchema,
  enabled: z.boolean().default(true),
  source: z.enum(['cli', 'config', 'ide']).default('cli'),
  verified: z.boolean().optional(),
});
export type DebugStoredBreakpoint = z.infer<typeof DebugStoredBreakpointSchema>;

export const DebugSessionLifecycleStatusSchema = z.enum([
  'idle',
  'starting',
  'running',
  'paused',
  'stopped',
  'errored',
]);
export type DebugSessionLifecycleStatus = z.infer<
  typeof DebugSessionLifecycleStatusSchema
>;
