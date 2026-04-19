import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'path';

interface SkillTree {
  skill: string;
  toolUseId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  nestedCalls: CallNode[];
}

interface CallNode {
  type: 'skill' | 'tool';
  name: string;
  toolUseId?: string;
  command?: string;
  file?: string;
  pattern?: string;
  url?: string;
  query?: string;
  content?: string;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  nestedCalls?: CallNode[];
}

interface SessionResponse {
  sessionId: string;
  sourceId: string;
  skillTree: SkillTree | null;
  transcriptPath: string | null;
  createdAt: number;
  updatedAt: number;
}

const RELAY_PORT = 8080;
const RELAY_URL = `http://localhost:${RELAY_PORT}`;

let relayProcess: ReturnType<typeof spawn> | null = null;

async function startRelay() {
  // Find node executable
  const nodePath = process.execPath;
  const projectRoot = process.cwd();
  
  try { execSync('fuser -k 8080/tcp 2>/dev/null || true'); } catch {}
  await sleep(500);

  relayProcess = spawn(nodePath, ['dist/index.js', 'start'], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Wait for relay to be ready
  let retries = 10;
  while (retries > 0) {
    try {
      const response = await fetch(`${RELAY_URL}/health`);
      if (response.ok) break;
    } catch {}
    await sleep(500);
    retries--;
  }
  
  // Configure Claude Code hooks to send events to this relay
  // Find cahr executable - may be in npm global bin or local node_modules
  const npmGlobalBin = execSync('npm bin -g 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
  const pathParts = (process.env.PATH || '').split(':');
  const possiblePaths = [
    ...pathParts,
    '/usr/local/bin',
    '/usr/bin',
    npmGlobalBin,
  ].filter(Boolean);
  
  let cahrCmd = 'cahr';
  for (const p of possiblePaths) {
    try {
      const cahrPath = join(p, 'cahr');
      execSync(`test -x ${cahrPath} && echo exists`, { stdio: 'pipe' });
      cahrCmd = cahrPath;
      console.log('[Test] Found cahr at:', cahrPath);
      break;
    } catch {}
  }
  
  try {
    console.log('[Test] Running cahr init with URL:', RELAY_URL);
    const result = execSync(`${cahrCmd} init --url ${RELAY_URL} 2>&1`, { encoding: 'utf-8' });
    console.log('[Test] cahr init output:', result);
  } catch (e: unknown) {
    const err = e as {message?: string; stderr?: string};
    console.error('[Test] cahr init failed:', err.message || err.stderr);
    // Try direct npm exec
    try {
      console.log('[Test] Trying npx cahr init...');
      execSync(`npx cahr init --url ${RELAY_URL} 2>&1`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch (e2) {
      console.error('[Test] npx cahr also failed:', (e2 as Error).message);
    }
  }
  
  // Verify hook is configured
  try {
    const settings = execSync('cat ~/.claude/settings.json 2>/dev/null || echo "no settings"', { encoding: 'utf-8' });
    console.log('[Test] Current settings:', settings.slice(0, 200));
  } catch {
    console.log('[Test] Could not read settings');
  }
}

async function stopRelay() {
  if (relayProcess) {
    relayProcess.kill();
    await sleep(500);
  }
}

function runClaude(command: string): string {
  try {
    // Use npx to run claude if available, or fall back to direct command
    const claudeCmd = process.env.CLAUDE_CMD || 'claude';
    return execSync(`timeout 30 ${claudeCmd} -p "${command}" 2>&1`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    }).toString();
  } catch (e: unknown) {
    const err = e as {stdout?: string; message?: string};
    return (err.stdout || err.message || '').toString();
  }
}

async function getSessionJson(sessionId: string): Promise<SessionResponse | null> {
  try {
    const response = await fetch(`${RELAY_URL}/api/sessions/${sessionId}`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function waitForSession(timeoutMs = 15000): Promise<SessionResponse | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${RELAY_URL}/api/sessions`);
      if (response.ok) {
        const data = await response.json() as { sessions: { sessionId: string; hasSkillTree: boolean }[] };
        const sessionWithData = data.sessions.find(s => s.hasSkillTree);
        if (sessionWithData) {
          const session = await getSessionJson(sessionWithData.sessionId);
          if (session?.skillTree) {
            return session;
          }
        }
      }
    } catch {}
    await sleep(500);
  }
  return null;
}

describe('Skill Tree Output Tests', () => {
  beforeAll(async () => {
    console.log('\n=== Starting Relay ===');
    await startRelay();
  });

  afterAll(async () => {
    await stopRelay();
  });

  it('weather-checker: should have correct structure with Bash command', async () => {
    runClaude('run weather-checker');
    
    const session = await waitForSession();
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('weather-checker');
    expect(session?.skillTree?.nestedCalls).toBeDefined();
    
    const bashCalls = session?.skillTree?.nestedCalls.filter(
      (n): n is CallNode & { command: string } => n.type === 'tool' && n.name === 'Bash' && !!n.command
    );
    expect(bashCalls?.length).toBeGreaterThanOrEqual(1);
    expect(bashCalls?.[0].command).toContain('date');
  });

  it('nested-test-skill: should have nested weather-checker skill', async () => {
    runClaude('run nested-test-skill');

    const session = await waitForSession();
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('nested-test-skill');
    
    const nestedSkills = session?.skillTree?.nestedCalls.filter(n => n.type === 'skill');
    expect(nestedSkills?.length).toBeGreaterThanOrEqual(1);
    expect(nestedSkills?.[0].name).toBe('weather-checker');
    
    expect(nestedSkills?.[0].nestedCalls).toBeDefined();
    const nestedBash = nestedSkills?.[0].nestedCalls?.find(n => n.type === 'tool' && n.name === 'Bash');
    expect(nestedBash).toBeDefined();
  });

  it('level-3-skill: should have 3 levels of skill nesting', async () => {
    runClaude('run level-3-skill');

    const session = await waitForSession();
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('level-3-skill');
    
    const level2 = session?.skillTree?.nestedCalls.find(n => n.type === 'skill' && n.name === 'level-2-skill');
    expect(level2).toBeDefined();
    
    const level1 = level2?.nestedCalls?.find(n => n.type === 'skill' && n.name === 'level-1-skill');
    expect(level1).toBeDefined();
    
    const level1Bash = level1?.nestedCalls?.find(n => n.type === 'tool' && n.name === 'Bash');
    expect(level1Bash).toBeDefined();
    expect((level1Bash as CallNode & {command?: string})?.command).toContain('date');
  });

  it('sequential-skill: should call weather-checker twice as sibling skills', async () => {
    runClaude('run sequential-skill');

    const session = await waitForSession();
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('sequential-skill');
    
    // Should have at least 2 skill calls (weather-checker called twice)
    const skillCalls = session?.skillTree?.nestedCalls.filter(n => n.type === 'skill');
    expect(skillCalls?.length).toBeGreaterThanOrEqual(2);
    
    // Check for weather-checker
    const weatherCheckerCalls = skillCalls?.filter(n => n.name === 'weather-checker');
    expect(weatherCheckerCalls?.length).toBeGreaterThanOrEqual(1);
    
    // Last call should be echo "done"
    const lastCall = session?.skillTree?.nestedCalls[session?.skillTree?.nestedCalls.length - 1];
    expect(lastCall?.type).toBe('tool');
    expect(lastCall?.name).toBe('Bash');
    expect((lastCall as CallNode & {command?: string})?.command).toContain('done');
  });
});
