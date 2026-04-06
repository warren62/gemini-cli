/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ideContextStore,
  type MessageActionReturn,
} from '@google/gemini-cli-core';
import {
  discoverDebugConfiguration,
  loadDebugConfiguration,
} from '@google/gemini-cli-core/src/debug/debugConfig.js';
import { parseDebugBreakpointTarget } from '@google/gemini-cli-core/src/debug/debugTarget.js';
import type {
  IdeBreakpoint,
  IdeDebugStop,
} from '@google/gemini-cli-core/src/debug/types.js';
import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';

function formatBreakpoint(breakpoint: IdeBreakpoint): string {
  const suffix = breakpoint.column ? `:${breakpoint.column}` : '';
  return `${breakpoint.filePath}:${breakpoint.line}${suffix}`;
}

function formatStop(stop: IdeDebugStop): string {
  const location = stop.location ? formatBreakpoint(stop.location) : 'unknown';
  const topFrame = stop.frames?.[0];
  const locals = (stop.locals ?? [])
    .slice(0, 5)
    .map((variable) => `${variable.name}=${variable.value}`)
    .join(', ');

  return [
    `Last stop reason: ${stop.reason}`,
    stop.description ? `Description: ${stop.description}` : undefined,
    `Session: ${stop.sessionName ?? 'unknown'}`,
    `Thread: ${stop.threadId ?? 'unknown'}`,
    `Location: ${location}`,
    topFrame
      ? `Top frame: ${topFrame.name}${topFrame.filePath ? ` (${topFrame.filePath}:${topFrame.line ?? '?'})` : ''}`
      : undefined,
    locals ? `Locals: ${locals}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

async function handleBreakCommand(
  args: string,
  addInfo: (message: string) => void,
): Promise<SlashCommandActionReturn> {
  const parsed = parseDebugBreakpointTarget(args.trim());
  addInfo(`Parsed breakpoint target: ${parsed.normalized}`);

  return {
    type: 'submit_prompt',
    content: [
      {
        text: `Focus on debug breakpoint target ${parsed.normalized}. Treat this as the primary paused-code location. File: ${parsed.filePath}. Line: ${parsed.line}.${parsed.column ? ` Column: ${parsed.column}.` : ''}`,
      },
    ],
  };
}

async function handleConfigShowCommand(): Promise<MessageActionReturn> {
  const discovered = await discoverDebugConfiguration(process.cwd());
  if (!discovered) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No debug config found. Looked for .gemini/debug.json and .gemini/debug.config.json.',
    };
  }

  return {
    type: 'message',
    messageType: 'info',
    content: `Debug config: ${discovered.path}\n\n${discovered.raw}`,
  };
}

async function handleConfigValidateCommand(): Promise<MessageActionReturn> {
  const discovered = await discoverDebugConfiguration(process.cwd());
  if (!discovered) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No debug config found. Looked for .gemini/debug.json and .gemini/debug.config.json.',
    };
  }

  await loadDebugConfiguration(discovered.path);
  return {
    type: 'message',
    messageType: 'info',
    content: `Debug config is valid: ${discovered.path} (${discovered.config.configurations.length} configuration(s))`,
  };
}

async function handleStatusCommand(): Promise<MessageActionReturn> {
  const workspaceState = ideContextStore.get()?.workspaceState;
  const breakpoints = workspaceState?.breakpoints ?? [];
  const lastStop = workspaceState?.lastDebugStop;

  const lines = [
    `Breakpoints: ${breakpoints.length}`,
    ...breakpoints.slice(0, 5).map((breakpoint) => `- ${formatBreakpoint(breakpoint)}`),
    lastStop ? formatStop(lastStop) : 'Last stop reason: none',
  ];

  return {
    type: 'message',
    messageType: 'info',
    content: lines.join('\n'),
  };
}

const breakCommand: SlashCommand = {
  name: 'break',
  description: 'Parse and normalize a breakpoint target such as @src/foo.ts:87',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args) => {
    if (!args.trim()) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing breakpoint target. Usage: /debug break @src/foo.ts:87',
      };
    }

    return handleBreakCommand(args, (message) => {
      context.ui.addItem(
        {
          type: 'info',
          text: message,
        },
        Date.now(),
      );
    });
  },
};

const configShowCommand: SlashCommand = {
  name: 'show',
  description: 'Show the discovered project debug config',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async () => handleConfigShowCommand(),
};

const configValidateCommand: SlashCommand = {
  name: 'validate',
  description: 'Validate the discovered project debug config',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async () => handleConfigValidateCommand(),
};

const configCommand: SlashCommand = {
  name: 'config',
  description: 'Inspect launch-style Gemini debug config',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [configShowCommand, configValidateCommand],
};

const statusCommand: SlashCommand = {
  name: 'status',
  description: 'Show the current IDE-fed breakpoint and paused debug state',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async () => handleStatusCommand(),
};

export const debugCommand: SlashCommand = {
  name: 'debug',
  description: 'Inspect breakpoint targets, debug config, and IDE debug state',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [breakCommand, configCommand, statusCommand],
  action: async () => ({
    type: 'message',
    messageType: 'info',
    content:
      'Usage: /debug break <target>, /debug config show, /debug config validate, or /debug status',
  }),
};
