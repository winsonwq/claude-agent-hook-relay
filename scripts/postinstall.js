#!/usr/bin/env node
// postinstall script - runs after npm install -g
// Auto-installs Claude Code hooks pointing to relay URL

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const RELAY_URL = process.env.RELAY_URL || 'http://localhost:8080';

const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied', 'UserPromptSubmit',
  'Stop', 'StopFailure', 'SessionStart', 'SessionEnd',
  'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
  'PreCompact', 'PostCompact', 'Notification', 'TeammateIdle',
  'InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'FileChanged',
  'WorktreeCreate', 'WorktreeRemove', 'Elicitation', 'ElicitationResult',
];

function isClaudeCodeInstalled() {
  try {
    execSync('which claude', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

function readSettings() {
  const path = getSettingsPath();
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  const path = getSettingsPath();
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function makeHookUrl(event) {
  const route = '/hook/' + event.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
  return RELAY_URL + route;
}

async function main() {
  if (!isClaudeCodeInstalled()) {
    console.log('\n Claude Code not detected - skipping auto-install.');
    console.log('  After installing Claude Code, run: relay init\n');
    return;
  }

  const settings = readSettings();
  settings.hooks = settings.hooks || {};

  let addedCount = 0;
  for (const event of HOOK_EVENTS) {
    const hookUrl = makeHookUrl(event);
    const existing = settings.hooks[event];
    const alreadySet = existing?.some(
      (h) => h.hooks?.some((hook) => hook.type === 'http' && hook.url === hookUrl)
    );
    if (!alreadySet) {
      settings.hooks[event] = [{
        matcher: '*',
        hooks: [{ type: 'http', url: hookUrl, timeout: 10 }],
      }];
      addedCount++;
    }
  }

  if (addedCount > 0) {
    writeSettings(settings);
    try {
      execSync('claude config reload', { stdio: 'pipe' });
    } catch {
      // ignore
    }
    console.log(`\n Claude Code hooks auto-installed (${addedCount} events) -> ${RELAY_URL}`);
    console.log('  Start relay: relay start\n');
  } else {
    console.log('\n Claude Code hooks already configured.\n');
  }
}

main().catch((err) => {
  console.error('postinstall error:', err);
  process.exit(0);
});
