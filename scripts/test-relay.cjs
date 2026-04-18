/**
 * claude-agent-hook-relay - Integration Test
 * 
 * Run: node scripts/test-relay.cjs [port]
 * 
 * If no port given, starts its own relay instance.
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');

// __dirname is available globally in Node 22 CJS
const ROOT = path.join(__dirname, '..');

// ─── HTTP client ─────────────────────────────────────────────────────────────

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function curl(method, path, body, headers) {
  return request(method, path, body, headers);
}

// ─── Port helpers ────────────────────────────────────────────────────────────

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const s = require('net').createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port);
  });
}

async function findAvailablePort(start) {
  for (let port = start; port < start + 200; port++) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`No port available from ${start}`);
}

async function waitForServer(port, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await new Promise((r) => setTimeout(r, 200));
      const res = await request('GET', '/health', null, {});
      if (res.status === 200) return true;
    } catch {}
  }
  throw new Error(`Server on port ${port} did not start`);
}

// ─── Test cases ──────────────────────────────────────────────────────────────

async function testNoSkill() {
  console.log('\n🧪 Test: Session with no Skill calls (Bash + Read only)\n');
  const sid = `no-skill-${Date.now()}`;
  const t0 = Date.now();

  await curl('POST', '/hook/session-start', { session_id: sid }, { 'x-source-id': 'test-terminal' });
  await sleep(50);

  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu1',
    tool_input: { command: 'ls -la' }, timestamp: t0 + 100,
  }, { 'x-source-id': 'test-terminal' });
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu1', timestamp: t0 + 200,
  }, { 'x-source-id': 'test-terminal' });

  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Read', tool_use_id: 'tu2',
    tool_input: { path: '/etc/hostname' }, timestamp: t0 + 300,
  }, { 'x-source-id': 'test-terminal' });
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Read', tool_use_id: 'tu2', timestamp: t0 + 400,
  }, { 'x-source-id': 'test-terminal' });

  await sleep(50);
  await curl('POST', '/hook/stop', {
    session_id: sid, reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 340, total_cost_usd: 0.004 },
    timestamp: t0 + 500,
  }, { 'x-source-id': 'test-terminal' });

  await sleep(200);
}

async function testSingleSkill() {
  console.log('\n🧪 Test: Single Skill with nested tool calls\n');
  const sid = `single-skill-${Date.now()}`;
  const t0 = Date.now();

  await curl('POST', '/hook/session-start', { session_id: sid }, { 'x-source-id': 'test-terminal' });
  await sleep(50);

  // Enter Skill "batch"
  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-skill-1',
    tool_input: { skill: 'batch', args: { pattern: '*.ts' } }, timestamp: t0 + 100,
  }, { 'x-source-id': 'test-terminal' });

  // Nested calls
  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu-skill-2',
    tool_input: { command: 'find . -name "*.ts"' }, timestamp: t0 + 200,
  }, { 'x-source-id': 'test-terminal' });
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu-skill-2', timestamp: t0 + 300,
  }, { 'x-source-id': 'test-terminal' });

  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Read', tool_use_id: 'tu-skill-3',
    tool_input: { path: 'result.json' }, timestamp: t0 + 400,
  }, { 'x-source-id': 'test-terminal' });
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Read', tool_use_id: 'tu-skill-3', timestamp: t0 + 500,
  }, { 'x-source-id': 'test-terminal' });

  // Exit Skill
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-skill-1', timestamp: t0 + 600,
  }, { 'x-source-id': 'test-terminal' });

  await sleep(50);
  await curl('POST', '/hook/stop', {
    session_id: sid, reason: 'end_turn',
    usage: { input_tokens: 3500, output_tokens: 890, cache_read_input_tokens: 12000, total_cost_usd: 0.018 },
    timestamp: t0 + 700,
  }, { 'x-source-id': 'test-terminal' });

  await sleep(200);
}

async function testNestedSkill() {
  console.log('\n🧪 Test: Nested Skill calls\n');
  const sid = `nested-skill-${Date.now()}`;
  const t0 = Date.now();

  await curl('POST', '/hook/session-start', { session_id: sid }, { 'x-source-id': 'test-terminal' });
  await sleep(50);

  // Outer skill "weather"
  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-outer',
    tool_input: { skill: 'weather' }, timestamp: t0 + 100,
  }, { 'x-source-id': 'test-terminal' });

  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu-outer-cmd',
    tool_input: { command: 'curl wttr.in/Shanghai?format=3' }, timestamp: t0 + 200,
  }, { 'x-source-id': 'test-terminal' });
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Bash', tool_use_id: 'tu-outer-cmd', timestamp: t0 + 300,
  }, { 'x-source-id': 'test-terminal' });

  // Nested inner skill "agent-reach"
  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-inner',
    tool_input: { skill: 'agent-reach' }, timestamp: t0 + 400,
  }, { 'x-source-id': 'test-terminal' });

  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'WebSearch', tool_use_id: 'tu-inner-ws',
    tool_input: { query: 'weather Shanghai' }, timestamp: t0 + 500,
  }, { 'x-source-id': 'test-terminal' });
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'WebSearch', tool_use_id: 'tu-inner-ws', timestamp: t0 + 600,
  }, { 'x-source-id': 'test-terminal' });

  // Inner ends
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-inner', timestamp: t0 + 700,
  }, { 'x-source-id': 'test-terminal' });

  // Back in outer - Edit
  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Edit', tool_use_id: 'tu-outer-edit',
    tool_input: { path: 'report.md' }, timestamp: t0 + 800,
  }, { 'x-source-id': 'test-terminal' });
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Edit', tool_use_id: 'tu-outer-edit', timestamp: t0 + 900,
  }, { 'x-source-id': 'test-terminal' });

  // Outer ends
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-outer', timestamp: t0 + 1000,
  }, { 'x-source-id': 'test-terminal' });

  await sleep(50);
  await curl('POST', '/hook/stop', {
    session_id: sid, reason: 'end_turn',
    usage: {
      input_tokens: 8000, output_tokens: 2100,
      cache_read_input_tokens: 30000, cache_creation_input_tokens: 5000,
      total_cost_usd: 0.052,
    },
    timestamp: t0 + 1100,
  }, { 'x-source-id': 'test-terminal' });

  await sleep(200);
}

async function testSessionEnd() {
  console.log('\n🧪 Test: SessionEnd event\n');
  const sid = `session-end-${Date.now()}`;
  const t0 = Date.now();

  await curl('POST', '/hook/session-start', { session_id: sid }, { 'x-source-id': 'test-terminal' });
  await sleep(50);

  await curl('POST', '/hook/pre-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-end',
    tool_input: { skill: 'memex' }, timestamp: t0 + 100,
  }, { 'x-source-id': 'test-terminal' });
  await curl('POST', '/hook/post-tool-use', {
    session_id: sid, tool_name: 'Skill', tool_use_id: 'tu-end', timestamp: t0 + 200,
  }, { 'x-source-id': 'test-terminal' });

  await sleep(50);
  await curl('POST', '/hook/session-end', {
    session_id: sid, reason: 'error', total_cost_usd: 0.007, timestamp: t0 + 300,
  }, { 'x-source-id': 'test-terminal' });

  await sleep(200);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ────────────────────────────────────────────────────────────────────

const TEST_PORT_ARG = parseInt(process.argv[2], 10);
let TEST_PORT;
let relayProcess = null;

async function main() {
  const relayBin = path.join(ROOT, 'dist', 'index.js');

  if (TEST_PORT_ARG) {
    TEST_PORT = TEST_PORT_ARG;
    console.log(`📡 Using existing relay on port ${TEST_PORT}`);
    try {
      await waitForServer(TEST_PORT, 3000);
    } catch {
      console.error(`❌ No relay running on port ${TEST_PORT}. Start with: node dist/index.js start ${TEST_PORT}`);
      process.exit(1);
    }
  } else {
    TEST_PORT = await findAvailablePort(18080);
    console.log(`🚀 Starting fresh relay on port ${TEST_PORT}...`);

    relayProcess = spawn('node', [relayBin, 'start', String(TEST_PORT)], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    relayProcess.on('error', (e) => {
      console.error('❌ Relay error:', e.message);
      process.exit(1);
    });

    await waitForServer(TEST_PORT);
  }

  await sleep(300);

  console.log('\n' + '═'.repeat(70));
  console.log(' Claude Agent Hook Relay - Integration Test Suite');
  console.log('═'.repeat(70));

  await testNoSkill();
  await testSingleSkill();
  await testNestedSkill();
  await testSessionEnd();

  console.log('\n' + '─'.repeat(70));
  console.log('✅ All tests sent. Check [Relay] output above for session summaries.');
  console.log('   Format: [Relay] {sessionId, skillCount, skillList, totalUsage, ...}\n');

  if (relayProcess) {
    console.log(`🛑 Stopping relay on port ${TEST_PORT}...`);
    relayProcess.kill();
  }
}

main().catch((e) => {
  console.error('❌ Test failed:', e.message);
  if (relayProcess) relayProcess.kill();
  process.exit(1);
});
