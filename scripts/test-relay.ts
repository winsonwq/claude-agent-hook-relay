/**
 * claude-agent-hook-relay - Integration Test Suite
 *
 * Run with:
 *   npx tsx scripts/test-relay.ts           # starts its own relay
 *   npx tsx scripts/test-relay.ts <port>    # uses existing relay
 */

import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Types ────────────────────────────────────────────────────────────────────

interface RelayResponse {
  status: number;
  body: string;
}

// ─── HTTP client ─────────────────────────────────────────────────────────────

function request(port: number, method: string, urlPath: string, body: unknown, xSourceId = 'test'): Promise<RelayResponse> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const opts: http.RequestOptions = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-source-id': xSourceId,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const post = (port: number, path: string, body: unknown, xsrc = 'test') =>
  request(port, 'POST', path, body, xsrc);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Port helpers ─────────────────────────────────────────────────────────────

function portIsAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port);
  });
}

async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + 200; port++) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`No port available from ${start}`);
}

async function waitForServer(port: number, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await sleep(200);
      const res = await request(port, 'GET', '/health', null);
      if (res.status === 200) return;
    } catch {}
  }
  throw new Error(`Server on port ${port} did not start`);
}

// ─── Test cases ──────────────────────────────────────────────────────────────

async function testNoSkill(port: number) {
  console.log('\n🧪 Test: Session with no Skill calls (Bash + Read only)\n');
  const sid = `no-skill-${Date.now()}`;
  const t0 = Date.now();

  await post(port, '/hook/session-start', { session_id: sid });
  await sleep(50);

  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu1',
    tool_input: { command: 'ls -la' }, timestamp: t0 + 100,
  });
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu1', timestamp: t0 + 200,
  });

  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Read', tool_use_id: 'tu2',
    tool_input: { path: '/etc/hostname' }, timestamp: t0 + 300,
  });
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Read', tool_use_id: 'tu2', timestamp: t0 + 400,
  });

  await sleep(50);
  await post(port, '/hook/stop', {
    session_id: sid, reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 340, total_cost_usd: 0.004 },
    timestamp: t0 + 500,
  });

  await sleep(200);
}

async function testSingleSkill(port: number) {
  console.log('\n🧪 Test: Single Skill with nested tool calls\n');
  const sid = `single-skill-${Date.now()}`;
  const t0 = Date.now();

  await post(port, '/hook/session-start', { session_id: sid });
  await sleep(50);

  // Enter Skill "batch"
  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-skill-1',
    tool_input: { skill: 'batch', args: { pattern: '*.ts' } }, timestamp: t0 + 100,
  });

  // Nested calls
  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu-skill-2',
    tool_input: { command: 'find . -name "*.ts"' }, timestamp: t0 + 200,
  });
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu-skill-2', timestamp: t0 + 300,
  });

  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Read', tool_use_id: 'tu-skill-3',
    tool_input: { path: 'result.json' }, timestamp: t0 + 400,
  });
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Read', tool_use_id: 'tu-skill-3', timestamp: t0 + 500,
  });

  // Exit Skill
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-skill-1', timestamp: t0 + 600,
  });

  await sleep(50);
  await post(port, '/hook/stop', {
    session_id: sid, reason: 'end_turn',
    usage: { input_tokens: 3500, output_tokens: 890, cache_read_input_tokens: 12000, total_cost_usd: 0.018 },
    timestamp: t0 + 700,
  });

  await sleep(200);
}

async function testNestedSkill(port: number) {
  console.log('\n🧪 Test: Nested Skill calls\n');
  const sid = `nested-skill-${Date.now()}`;
  const t0 = Date.now();

  await post(port, '/hook/session-start', { session_id: sid });
  await sleep(50);

  // Outer skill "weather"
  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-outer',
    tool_input: { skill: 'weather' }, timestamp: t0 + 100,
  });

  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu-outer-cmd',
    tool_input: { command: 'curl wttr.in/Shanghai?format=3' }, timestamp: t0 + 200,
  });
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu-outer-cmd', timestamp: t0 + 300,
  });

  // Nested inner skill "agent-reach"
  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-inner',
    tool_input: { skill: 'agent-reach' }, timestamp: t0 + 400,
  });

  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'WebSearch', tool_use_id: 'tu-inner-ws',
    tool_input: { query: 'weather Shanghai' }, timestamp: t0 + 500,
  });
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'WebSearch', tool_use_id: 'tu-inner-ws', timestamp: t0 + 600,
  });

  // Inner ends
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-inner', timestamp: t0 + 700,
  });

  // Back in outer - Edit
  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Edit', tool_use_id: 'tu-outer-edit',
    tool_input: { path: 'report.md' }, timestamp: t0 + 800,
  });
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Edit', tool_use_id: 'tu-outer-edit', timestamp: t0 + 900,
  });

  // Outer ends
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-outer', timestamp: t0 + 1000,
  });

  await sleep(50);
  await post(port, '/hook/stop', {
    session_id: sid, reason: 'end_turn',
    usage: {
      input_tokens: 8000, output_tokens: 2100,
      cache_read_input_tokens: 30000, cache_creation_input_tokens: 5000,
      total_cost_usd: 0.052,
    },
    timestamp: t0 + 1100,
  });

  await sleep(200);
}

async function testSessionEnd(port: number) {
  console.log('\n🧪 Test: SessionEnd event\n');
  const sid = `session-end-${Date.now()}`;
  const t0 = Date.now();

  await post(port, '/hook/session-start', { session_id: sid });
  await sleep(50);

  await post(port, '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-end',
    tool_input: { skill: 'memex' }, timestamp: t0 + 100,
  });
  await post(port, '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-end', timestamp: t0 + 200,
  });

  await sleep(50);
  await post(port, '/hook/session-end', {
    session_id: sid, reason: 'error', total_cost_usd: 0.007, timestamp: t0 + 300,
  });

  await sleep(200);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const TEST_PORT_ARG = parseInt(process.argv[2], 10);

async function main() {
  const relayBin = path.join(ROOT, 'dist', 'index.js');
  let port: number;
  let relayProcess: ReturnType<typeof spawn> | null = null;

  if (TEST_PORT_ARG) {
    port = TEST_PORT_ARG;
    console.log(`📡 Using existing relay on port ${port}`);
    try {
      await waitForServer(port, 3000);
    } catch {
      console.error(`❌ No relay running on port ${port}. Start with: node dist/index.js start ${port}`);
      process.exit(1);
    }
  } else {
    port = await findAvailablePort(18080);
    console.log(`🚀 Starting fresh relay on port ${port}...`);

    relayProcess = spawn('node', [relayBin, 'start', String(port)], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    relayProcess.on('error', (e) => {
      console.error('❌ Relay error:', e.message);
      process.exit(1);
    });

    await waitForServer(port);
  }

  await sleep(300);

  console.log('\n' + '═'.repeat(70));
  console.log(' Claude Agent Hook Relay - Integration Test Suite');
  console.log('═'.repeat(70));

  await testNoSkill(port);
  await testSingleSkill(port);
  await testNestedSkill(port);
  await testSessionEnd(port);

  console.log('\n' + '─'.repeat(70));
  console.log('✅ All tests sent. Check [Relay] output above for session summaries.');
  console.log('   Format: [Relay] {sessionId, skillCount, skillList, totalUsage, ...}\n');

  if (relayProcess) {
    console.log(`🛑 Stopping relay on port ${port}...`);
    relayProcess.kill();
  }
}

main().catch((e) => {
  console.error('❌ Test failed:', e.message);
  process.exit(1);
});
