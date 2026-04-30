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

async function waitForSession(expectedSkill?: string, timeoutMs = 30000): Promise<SessionResponse | null> {
  const start = Date.now();
  const rejectedSessions = new Set<string>();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${RELAY_URL}/api/sessions`);
      if (response.ok) {
        const data = await response.json() as { sessions: { sessionId: string; hasSkillTree: boolean }[] };
        // Get ALL sessions with skill tree that haven't been rejected yet
        const candidates = data.sessions.filter(s => s.hasSkillTree && !rejectedSessions.has(s.sessionId));
        // Try each candidate in order (newest first)
        for (const candidate of candidates) {
          const session = await getSessionJson(candidate.sessionId);
          if (session?.skillTree) {
            if (!expectedSkill || session.skillTree.skill === expectedSkill) {
              return session;
            }
            // Wrong skill — mark rejected and try next
            rejectedSessions.add(candidate.sessionId);
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

    const session = await waitForSession('weather-checker');
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

    const session = await waitForSession('nested-test-skill');
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('nested-test-skill');

    const nestedSkills = session?.skillTree?.nestedCalls.filter(n => n.type === 'skill');
    expect(nestedSkills?.length).toBeGreaterThanOrEqual(1);
    expect(nestedSkills?.[0].name).toBe('weather-checker');

    expect(nestedSkills?.[0].nestedCalls).toBeDefined();
    const nestedBash = nestedSkills?.[0].nestedCalls?.find(n => n.type === 'tool' && n.name === 'Bash');
    expect(nestedBash).toBeDefined();
  });

  it('level-3-skill: should build a nested skill tree', async () => {
    runClaude('run level-3-skill');

    const session = await waitForSession('level-3-skill');
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('level-3-skill');

    // Skill tree should have at least one nested call (skill or tool)
    expect(session?.skillTree?.nestedCalls.length).toBeGreaterThan(0);

    // The nested calls should contain at least one skill
    const nestedSkills = session?.skillTree?.nestedCalls.filter(n => n.type === 'skill');
    expect(nestedSkills?.length).toBeGreaterThanOrEqual(1);
  });

  it('parent-skill: should track skill loaded from nested scripts/ directory', async () => {
    // parent-skill has a child-skill under scripts/child-skill/
    // The child is NOT a top-level skill - it should only be found when parent-skill calls it
    runClaude('run parent-skill');

    const session = await waitForSession('parent-skill');
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('parent-skill');

    // Should have at least one nested skill (child-skill)
    const nestedSkills = session?.skillTree?.nestedCalls.filter(n => n.type === 'skill');
    expect(nestedSkills?.length).toBeGreaterThanOrEqual(1);

    // The nested skill should be child-skill (first one — there may be multiple
    // variants like 'parent-skill/child-skill' due to path resolution attempts)
    expect(nestedSkills?.[0]?.name).toMatch(/child-skill/);
    // child-skill fails due to "Unknown skill" error (not a top-level skill)
    // Verify the failure is captured
    const childSkillNode = nestedSkills?.[0];
    expect(childSkillNode?.success).toBe(false);
    expect(childSkillNode?.error).toBeDefined();
    // The Bash "echo 'parent-skill: child has returned'" may be:
    // 1. A direct child tool call of parent-skill (correct: failed skill popped immediately)
    // 2. A nested tool inside the failed child skill (legacy behavior)
    // Check both locations.
    const allNested = session?.skillTree?.nestedCalls || [];
    const hasParentBash = allNested.some((n: CallNode) =>
      (n.type === 'tool' && n.name === 'Bash' && !!(n as CallNode & {command?: string})?.command?.includes('parent-skill')) ||
      (n.type === 'skill' && n.nestedCalls?.some((c: CallNode) =>
        c.type === 'tool' && c.name === 'Bash' && !!(c as CallNode & {command?: string})?.command?.includes('parent-skill')
      ))
    );
    expect(hasParentBash).toBe(true);
  });

  it('sequential-skill: should call weather-checker twice as sibling skills', async () => {
    runClaude('run sequential-skill');

    const session = await waitForSession('sequential-skill');
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('sequential-skill');

    // Should have at least 2 skill calls (weather-checker called twice)
    const skillCalls = session?.skillTree?.nestedCalls.filter(n => n.type === 'skill');
    expect(skillCalls?.length).toBeGreaterThanOrEqual(2);

    // Check for weather-checker
    const weatherCheckerCalls = skillCalls?.filter(n => n.name === 'weather-checker');
    expect(weatherCheckerCalls?.length).toBeGreaterThanOrEqual(1);

    // The second weather-checker should have "echo done" nested inside it
    const secondWeather = skillCalls?.[1];
    expect(secondWeather?.name).toBe('weather-checker');
    const doneBash = secondWeather?.nestedCalls?.find(n => n.type === 'tool' && (n as CallNode & {command?: string})?.command?.includes('done'));
    expect(doneBash).toBeDefined();
  });

  it('weather-checker: should have token usage on root skill', async () => {
    runClaude('run weather-checker');

    const session = await waitForSession('weather-checker');
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

    const session = await waitForSession('nested-test-skill');
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

  it('bare-tools: should capture tool calls without any skill', async () => {
    // Run a command that only uses tools without loading any skill
    runClaude('list all files in /tmp');

    const session = await waitForSession('<no-skill>');
    // With the fix, bare tool calls should create a synthetic <no-skill> root
    expect(session?.skillTree).toBeDefined();
    expect(session?.skillTree?.skill).toBe('<no-skill>');
    // Should have at least one nested tool call
    expect(session?.skillTree?.nestedCalls.length).toBeGreaterThan(0);
  });
});
