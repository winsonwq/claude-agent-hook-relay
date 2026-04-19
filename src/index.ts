#!/usr/bin/env node

import express from 'express';
import { parseArgs } from 'util';
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { SessionManager } from './session.js';
import { HookCollector } from './collector.js';
import { ConsoleForwarder, HttpForwarder, CompositeForwarder, OtelForwarder } from './forwarder.js';
import { findAvailablePort } from './utils/port.js';
import {
  installHooks,
  uninstallHooks,
  getHookStatus,
  isClaudeCodeInstalled,
  type InstallOptions,
} from './utils/install.js';

// ─── CLI argument parsing ────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

// Handle --version and -v before parseArgs to avoid "Unknown option" errors
if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  process.stdout.write(pkg.version + '\n');
  process.exit(0);
}

const { values: args, positionals } = parseArgs({
  args: rawArgs,
  options: {
    url: { type: 'string', short: 'u', default: 'http://localhost:8080' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
  allowUnknownOptions: true,
});

const isHelp = args.help || ['help', '--help', '-h'].includes(positionals[0] ?? '');
const command = isHelp ? 'help' : (positionals[0] ?? 'start');
const portArg = positionals[1];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  return pkg.version as string;
}

// ─── CLI commands ────────────────────────────────────────────────────────────

async function cmdStart(): Promise<void> {
  const requestedPort = portArg ? parseInt(portArg, 10) : 8080;
  const port = await findAvailablePort(requestedPort);
  const usedDefault = !portArg && port !== 8080;

  const httpUrl = process.env.RELAY_HTTP_URL;
  const otelUrl = process.env.RELAY_OTEL_URL;
  const forwarders: (ConsoleForwarder | HttpForwarder | OtelForwarder)[] = [new ConsoleForwarder()];

  if (httpUrl) {
    const authHeader = process.env.RELAY_AUTH_HEADER;
    const headers: Record<string, string> = authHeader ? { Authorization: authHeader } : {};
    forwarders.push(new HttpForwarder(httpUrl, headers));
  }

  if (otelUrl) {
    const authHeader = process.env.RELAY_OTEL_AUTH_HEADER;
    const headers: Record<string, string> = authHeader ? { Authorization: authHeader } : {};
    forwarders.push(new OtelForwarder(otelUrl, headers));
  }

  const sessionManager = new SessionManager();
  const collector = new HookCollector(sessionManager, new CompositeForwarder(forwarders));

  const app = express();
  app.use(express.json());

  const hookEvents = [
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'PermissionRequest', 'PermissionDenied', 'UserPromptSubmit',
    'Stop', 'StopFailure', 'SessionStart', 'SessionEnd',
    'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
    'PreCompact', 'PostCompact', 'Notification', 'TeammateIdle',
    'InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'FileChanged',
    'WorktreeCreate', 'WorktreeRemove', 'Elicitation', 'ElicitationResult',
  ];

  for (const event of hookEvents) {
    const route = '/hook/' + event.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    app.post(route, collector.collect(event));
  }

  app.get('/health', (_req, res) => { res.json({ status: 'ok', port }); });

  // API endpoint to get session data
  app.get('/api/sessions/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({
      sessionId: session.sessionId,
      sourceId: session.sourceId,
      skillTree: session.skillTree,
      transcriptPath: session.transcriptPath,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  });

  // API endpoint to list recent sessions
  app.get('/api/sessions', (_req, res) => {
    const sessions = sessionManager.getAll();
    // Sort by updatedAt descending, take most recent 10
    const recent = sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10)
      .map(s => ({
        sessionId: s.sessionId,
        sourceId: s.sourceId,
        hasSkillTree: !!s.skillTree,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));
    res.json({ sessions: recent });
  });

  app.listen(port, () => {
    process.stdout.write(`claude-agent-hook-relay v${getVersion()} listening on http://localhost:${port}\n`);
    if (usedDefault) {
      process.stdout.write(`Port 8080 was in use, using ${port}\n`);
    }
    process.stdout.write(`Hook events registered: ${hookEvents.length}\n`);
    if (httpUrl) {
      process.stdout.write(`HTTP forwarder: ${httpUrl}\n`);
    }
    if (otelUrl) {
      process.stdout.write(`OTel forwarder: ${otelUrl}\n`);
    }
  });
}

async function cmdInit(): Promise<void> {
  const url = (args.url as string) || 'http://localhost:8080';
  const sourceId = process.env.RELAY_SOURCE_ID;

  process.stdout.write(`Installing hooks pointing to: ${url}\n`);

  const installOptions: InstallOptions = { url };
  if (sourceId) {
    installOptions.sourceId = sourceId;
  }

  try {
    const result = await installHooks(installOptions);
    process.stdout.write(`Added hooks for ${result.added.length} events\n`);
    if (result.alreadyConfigured.length > 0) {
      process.stdout.write(`Already configured: ${result.alreadyConfigured.length} events\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

async function cmdUninstall(): Promise<void> {
  try {
    const result = uninstallHooks();
    if (result.removed.length > 0) {
      process.stdout.write(`Removed hooks for ${result.removed.length} events\n`);
    } else {
      process.stdout.write('No hooks found to remove\n');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

async function cmdStatus(): Promise<void> {
  const installed = isClaudeCodeInstalled();
  if (!installed) {
    process.stdout.write('Claude Code: not installed\n');
    return;
  }
  process.stdout.write('Claude Code: installed\n');

  const status = getHookStatus();
  process.stdout.write(`Hooks installed: ${status.installed.length}/${status.total}\n`);
  if (status.installed.length > 0) {
    process.stdout.write(`Events: ${status.installed.join(', ')}\n`);
  }
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

async function cmdInstallTestSkill(): Promise<void> {
  const relayDir = dirname(fileURLToPath(import.meta.url));
  const skillsDir = join(homedir(), '.claude', 'skills');

  // Install both skills: nested-test-skill and weather-checker
  const skillsToInstall = ['nested-test-skill', 'weather-checker'];

  try {
    mkdirSync(skillsDir, { recursive: true });

    for (const skillName of skillsToInstall) {
      const skillSrc = join(relayDir, '..', 'skills', skillName);
      if (!existsSync(skillSrc)) {
        process.stderr.write(`Error: skill '${skillName}' not found in package\n`);
        process.exit(1);
      }
      const skillDest = join(skillsDir, skillName);
      copyDir(skillSrc, skillDest);
      process.stdout.write(`Installed: ${skillDest}\n`);
    }

    process.stdout.write('\nUsage:\n');
    process.stdout.write('  1. Start cahr: cahr start\n');
    process.stdout.write('  2. Run: claude -p "run nested-test-skill"\n');
    process.stdout.write('  3. Check cahr output for nested skill tracking\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error installing skill: ${msg}\n`);
    process.exit(1);
  }
}

async function cmdHelp(): Promise<void> {
  process.stdout.write(`Usage: cahr <command> [options]
   (or: claude-agent-hook-relay <command> [options])

Commands:
  cahr start [port]          Start the relay server (default port: 8080)
  cahr init [--url]          Install Claude Code hooks pointing to relay URL
  cahr uninstall              Remove Claude Code hooks
  cahr status                 Show hook installation status
  cahr install-test-skill    Install test skills (nested-test-skill + weather-checker)

Options:
  --url, -u <url>       Relay URL for init command (default: http://localhost:8080)
  --help, -h            Show this help message

Environment variables:
  RELAY_HTTP_URL        HTTP endpoint to forward events to
  RELAY_AUTH_HEADER     Authorization header value for HTTP forwarder
  RELAY_OTEL_URL        OTel endpoint to forward skill spans to
  RELAY_OTEL_AUTH_HEADER Authorization header for OTel forwarder
  RELAY_SOURCE_ID       Source identifier sent with events
`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

switch (command) {
  case 'start':
    await cmdStart();
    break;
  case 'init':
    await cmdInit();
    break;
  case 'uninstall':
    await cmdUninstall();
    break;
  case 'status':
    await cmdStatus();
    break;
  case 'install-test-skill':
    await cmdInstallTestSkill();
    break;
  case 'version':
  case '--version':
  case '-v':
    process.stdout.write(getVersion() + '\n');
    break;
  case 'help':
  case '--help':
  case '-h':
    await cmdHelp();
    break;
  default:
    process.stderr.write(`Unknown command: ${command}\n`);
    process.stderr.write(`Run 'cahr --help' for usage\n`);
    process.exit(1);
}
