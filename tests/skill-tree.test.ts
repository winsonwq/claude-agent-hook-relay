import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'path';

interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

interface SkillTree {
  skill: string;
  toolUseId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  nestedCalls: CallNode[];
  usage?: ModelUsage;
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
  usage?: ModelUsage;
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
  
  console.log('[Test] Relay ready');
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
    return execSync(`timeout 60 ${claudeCmd} -p "${command}" 2>&1`, {
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

async function waitForSession(timeoutMs = 30000): Promise<SessionResponse | null> {
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
    
    // The leaf Bash command may be from weather-checker (date) or level-N skill's echo
    const level1Bash = level1?.nestedCalls?.find(n => n.type === 'tool' && n.name === 'Bash');
    expect(level1Bash).toBeDefined();
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

  it('weather-checker: should have token usage on root skill', async () => {
    runClaude('run weather-checker');

    const session = await waitForSession();
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('weather-checker');

    // Root skill should have token usage populated
    const usage = session?.skillTree?.usage;
    expect(usage).toBeDefined();
    expect(usage?.inputTokens).toBeGreaterThan(100);   // 真实 API 调用
    expect(usage?.outputTokens).toBeGreaterThan(10);
    expect(usage?.cacheReadTokens).toBeGreaterThan(0); // 必须用到缓存
  });

  it('nested-test-skill: should have token usage on both parent and nested skill', async () => {
    runClaude('run nested-test-skill');

    const session = await waitForSession();
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('nested-test-skill');

    // Root skill should have token usage
    const rootUsage = session?.skillTree?.usage;
    expect(rootUsage).toBeDefined();
    expect(rootUsage?.inputTokens).toBeGreaterThan(100);
    expect(rootUsage?.cacheReadTokens).toBeGreaterThan(0);

    // Nested weather-checker skill should also have token usage
    const nestedSkill = session?.skillTree?.nestedCalls.find(
      (n): n is CallNode & { name: string } => n.type === 'skill' && n.name === 'weather-checker'
    );
    expect(nestedSkill).toBeDefined();
    const nestedUsage = (nestedSkill as CallNode & { usage?: ModelUsage })?.usage;
    expect(nestedUsage).toBeDefined();
    expect(nestedUsage?.inputTokens).toBeGreaterThan(100);
    expect(nestedUsage?.cacheReadTokens).toBeGreaterThan(0);


  });
});
