import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

export interface InstallOptions {
  url: string;
  sourceId?: string;
}

export interface HookHttpConfig {
  type: 'http';
  url: string;
  timeout?: number;
}

export interface HookEntry {
  matcher: string;
  hooks: HookHttpConfig[];
}

export interface Settings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'PreCompact',
  'PostCompact',
  'Notification',
  'TeammateIdle',
  'InstructionsLoaded',
  'ConfigChange',
  'CwdChanged',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'Elicitation',
  'ElicitationResult',
];

export function getSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

export function isClaudeCodeInstalled(): boolean {
  try {
    execSync('which claude', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function readSettings(): Settings {
  const path = getSettingsPath();
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function writeSettings(settings: Settings): void {
  const path = getSettingsPath();
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function makeHookEntry(url: string): HookEntry {
  return {
    matcher: '*',
    hooks: [{ type: 'http', url, timeout: 10 }],
  };
}

async function reloadConfigBg(): Promise<void> {
  try {
    const { spawn } = await import('child_process');
    spawn('claude', ['config', 'reload'], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // ignore
  }
}

export async function installHooks(options: InstallOptions): Promise<{ added: string[]; alreadyConfigured: string[] }> {
  if (!isClaudeCodeInstalled()) {
    throw new Error('Claude Code is not installed. Run: npm install -g @anthropic-ai/claude-code');
  }

  const settings = readSettings();
  settings.hooks = settings.hooks || {};

  const added: string[] = [];
  const alreadyConfigured: string[] = [];

  for (const event of HOOK_EVENTS) {
    const route = '/hook/' + event.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    const hookUrl = `${options.url}${route}`;
    const entry = makeHookEntry(hookUrl);

    const existing = settings.hooks[event];
    const alreadySet = existing?.some(
      (h) => h.hooks?.some((hook) => hook.type === 'http' && hook.url === hookUrl)
    );

    if (alreadySet) {
      alreadyConfigured.push(event);
    } else {
      settings.hooks[event] = [entry];
      added.push(event);
    }
  }

  writeSettings(settings);
  await reloadConfigBg();

  return { added, alreadyConfigured };
}

export function uninstallHooks(): { removed: string[]; not_found: string[] } {
  if (!isClaudeCodeInstalled()) {
    throw new Error('Claude Code is not installed.');
  }

  const settings = readSettings();
  if (!settings.hooks) {
    return { removed: [], not_found: [] };
  }

  const removed: string[] = [];
  const not_found: string[] = [];

  for (const event of HOOK_EVENTS) {
    if (settings.hooks[event]) {
      delete settings.hooks[event];
      removed.push(event);
    } else {
      not_found.push(event);
    }
  }

  writeSettings(settings);

  // Background reload without await
  reloadConfigBg().catch(() => {});

  return { removed, not_found };
}

export function getHookStatus(): { installed: string[]; total: number } {
  const settings = readSettings();
  const hooks = settings.hooks || {};
  const installed: string[] = [];

  for (const event of HOOK_EVENTS) {
    if (hooks[event] && hooks[event].length > 0) {
      installed.push(event);
    }
  }

  return { installed, total: HOOK_EVENTS.length };
}
