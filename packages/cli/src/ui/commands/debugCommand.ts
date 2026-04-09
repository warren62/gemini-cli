/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  debugSessionManager,
  ideContextStore,
  type MessageActionReturn,
  discoverDebugConfiguration,
  loadDebugConfiguration,
  type DebugPausedSnapshot,
  type DebugStoredBreakpoint,
  type IdeBreakpoint,
  type IdeDebugStop,
} from '@google/gemini-cli-core';
import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';

function formatBreakpoint(breakpoint: IdeBreakpoint): string {
  const suffix = breakpoint.column ? `:${breakpoint.column}` : '';
  return `${breakpoint.filePath}:${breakpoint.line}${suffix}`;
}

function formatStoredBreakpoint(breakpoint: DebugStoredBreakpoint): string {
  const source =
    breakpoint.source === 'cli'
      ? 'cli'
      : breakpoint.source === 'config'
        ? 'config'
        : 'ide';
  return `${breakpoint.id} ${breakpoint.target.normalized} (${source})`;
}

function formatPausedSnapshot(
  heading: string,
  snapshot: DebugPausedSnapshot | IdeDebugStop,
): string[] {
  const location = snapshot.location
    ? formatBreakpoint(snapshot.location)
    : 'unknown';
  const topFrame = snapshot.frames?.[0];
  const locals = (snapshot.locals ?? [])
    .slice(0, 5)
    .map(
      (variable: { name: string; value: string }) =>
        `${variable.name}=${variable.value}`,
    )
    .join(', ');

  return [
    heading,
    `Reason: ${snapshot.reason}`,
    snapshot.description ? `Description: ${snapshot.description}` : undefined,
    `Session: ${snapshot.sessionName ?? 'unknown'}`,
    `Thread: ${snapshot.threadId ?? 'unknown'}`,
    `Location: ${location}`,
    topFrame
      ? `Top frame: ${topFrame.name}${topFrame.filePath ? ` (${topFrame.filePath}:${topFrame.line ?? '?'})` : ''}`
      : undefined,
    locals ? `Locals: ${locals}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

async function handleBreakAddCommand(
  args: string,
): Promise<MessageActionReturn> {
  const result = await debugSessionManager.addBreakpoint(args.trim());
  const session = debugSessionManager.getStatus().session;
  const summary = result.created ? 'Added' : 'Reused';
  return {
    type: 'message',
    messageType: 'info',
    content: `${summary} breakpoint ${result.breakpoint.id} at ${result.breakpoint.target.normalized}${session ? ` for session ${session.configName}.` : '.'}`,
  };
}

async function handleBreakListCommand(): Promise<MessageActionReturn> {
  const breakpoints = debugSessionManager.listBreakpoints();
  return {
    type: 'message',
    messageType: 'info',
    content:
      breakpoints.length === 0
        ? 'No CLI-owned breakpoints are stored.'
        : [
            `CLI-owned breakpoints: ${breakpoints.length}`,
            ...breakpoints.map(formatStoredBreakpoint),
          ].join('\n'),
  };
}

async function handleBreakRemoveCommand(
  args: string,
): Promise<MessageActionReturn> {
  if (!args.trim()) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Missing breakpoint id or target. Usage: /debug break remove <bp-id|@file:line>',
    };
  }

  const removed = await debugSessionManager.removeBreakpoint(args.trim());
  return {
    type: 'message',
    messageType: 'info',
    content: `Removed breakpoint ${removed.id} at ${removed.target.normalized}.`,
  };
}

async function handleConfigShowCommand(): Promise<MessageActionReturn> {
  const discovered = await discoverDebugConfiguration(process.cwd());
  if (!discovered) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'No debug config found. Looked for .gemini/debug.json and .gemini/debug.config.json.',
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
      content:
        'No debug config found. Looked for .gemini/debug.json and .gemini/debug.config.json.',
    };
  }

  await loadDebugConfiguration(discovered.path);
  return {
    type: 'message',
    messageType: 'info',
    content: `Debug config is valid: ${discovered.path} (${discovered.config.configurations.length} configuration(s))`,
  };
}

async function handleStartCommand(
  configName: string,
  mode: 'start' | 'attach',
): Promise<MessageActionReturn> {
  if (!configName.trim()) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Missing configuration name. Usage: /debug ${mode} <config-name>`,
    };
  }

  const session =
    mode === 'attach'
      ? await debugSessionManager.attachSession(configName.trim())
      : await debugSessionManager.startSession(configName.trim());
  return {
    type: 'message',
    messageType: 'info',
    content: `Debug session ${session.configName} (${session.requestType}) is ${session.status}.`,
  };
}

async function handleContinueCommand(): Promise<MessageActionReturn> {
  const session = await debugSessionManager.continueSession();
  return {
    type: 'message',
    messageType: 'info',
    content: `Continued debug session ${session.configName}.`,
  };
}

async function handlePauseCommand(): Promise<MessageActionReturn> {
  const session = await debugSessionManager.pauseSession();
  return {
    type: 'message',
    messageType: 'info',
    content: `Pause requested for debug session ${session.configName}.`,
  };
}

async function handleStopCommand(): Promise<MessageActionReturn> {
  const session = await debugSessionManager.stopSession();
  return {
    type: 'message',
    messageType: 'info',
    content: `Stopped debug session ${session.configName}.`,
  };
}

async function handleStatusCommand(): Promise<MessageActionReturn> {
  const status = debugSessionManager.getStatus();
  const breakpoints = debugSessionManager.listBreakpoints();
  const workspaceState = ideContextStore.get()?.workspaceState;
  const ideBreakpoints = workspaceState?.breakpoints ?? [];
  const ideLastStop = workspaceState?.lastDebugStop;

  const lines = [
    `CLI session state: ${status.lifecycleStatus}`,
    `CLI breakpoints: ${breakpoints.length}`,
  ];

  if (status.session) {
    lines.push(`Active config: ${status.session.configName}`);
    lines.push(`Adapter/runtime: ${status.session.adapterType}`);
    lines.push(`Request: ${status.session.requestType}`);
    if (status.session.latestPausedSnapshot) {
      lines.push(
        ...formatPausedSnapshot(
          'CLI paused snapshot:',
          status.session.latestPausedSnapshot,
        ),
      );
    } else {
      lines.push('CLI paused snapshot: none');
    }
  } else {
    lines.push('Active config: none');
    lines.push('CLI paused snapshot: none');
  }

  if (ideBreakpoints.length > 0 || ideLastStop) {
    lines.push('IDE mirror context:');
    lines.push(`IDE breakpoints: ${ideBreakpoints.length}`);
    lines.push(
      ...ideBreakpoints
        .slice(0, 5)
        .map((breakpoint) => `- ${formatBreakpoint(breakpoint)}`),
    );
    if (ideLastStop) {
      lines.push(...formatPausedSnapshot('IDE latest stop:', ideLastStop));
    }
  }

  return {
    type: 'message',
    messageType: 'info',
    content: lines.join('\n'),
  };
}

const breakListCommand: SlashCommand = {
  name: 'list',
  description: 'List CLI-owned breakpoints',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  takesArgs: false,
  action: async () => handleBreakListCommand(),
};

const breakRemoveCommand: SlashCommand = {
  name: 'remove',
  description: 'Remove a stored breakpoint by id or target',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (_context, args) => handleBreakRemoveCommand(args),
};

const breakCommand: SlashCommand = {
  name: 'break',
  description: 'Create, list, or remove real CLI-owned breakpoints',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [breakListCommand, breakRemoveCommand],
  action: async (_context, args): Promise<SlashCommandActionReturn> => {
    if (!args.trim()) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Missing breakpoint target. Usage: /debug break @src/foo.ts:87, /debug break list, or /debug break remove <bp-id|@file:line>',
      };
    }

    return handleBreakAddCommand(args);
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

const startCommand: SlashCommand = {
  name: 'start',
  description: 'Start a real debug session from project config',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (_context, args) => handleStartCommand(args, 'start'),
};

const attachCommand: SlashCommand = {
  name: 'attach',
  description: 'Attach to a real debug session from project config',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (_context, args) => handleStartCommand(args, 'attach'),
};

const continueCommand: SlashCommand = {
  name: 'continue',
  description: 'Continue the active paused debug session',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  takesArgs: false,
  action: async () => handleContinueCommand(),
};

const pauseCommand: SlashCommand = {
  name: 'pause',
  description: 'Pause the active debug session if supported',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  takesArgs: false,
  action: async () => handlePauseCommand(),
};

const stopCommand: SlashCommand = {
  name: 'stop',
  description: 'Stop the active debug session',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  takesArgs: false,
  action: async () => handleStopCommand(),
};

const statusCommand: SlashCommand = {
  name: 'status',
  description: 'Show CLI-owned debugger state and the latest IDE mirror state',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  takesArgs: false,
  action: async () => handleStatusCommand(),
};

export const debugCommand: SlashCommand = {
  name: 'debug',
  description: 'Control Gemini CLI debug sessions and breakpoint state',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [
    breakCommand,
    configCommand,
    startCommand,
    attachCommand,
    continueCommand,
    pauseCommand,
    stopCommand,
    statusCommand,
  ],
  action: async () => ({
    type: 'message',
    messageType: 'info',
    content:
      'Usage: /debug break <target>, /debug break list, /debug break remove <id>, /debug config show, /debug config validate, /debug start <config>, /debug attach <config>, /debug continue, /debug pause, /debug stop, or /debug status',
  }),
};
