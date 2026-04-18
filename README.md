# claude-agent-hook-relay

> Collect and forward Claude Code Hook events to external systems.

[![npm version](https://img.shields.io/npm/v/claude-agent-hook-relay.svg)](https://npmjs.com/package/claude-agent-hook-relay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is this?

`claude-agent-hook-relay` is a lightweight HTTP service that acts as a **Hook event collection layer** for Claude Code. It provides two unique values:

### Core Value

| Value | Description |
|-------|-------------|
| **Multi-terminal Hook Collection** | Unified collection of Hook events from multiple Claude Code instances without configuring Hooks on each terminal |
| **Skill Call Chain Tracking** | Tracks which Skill triggered which tools, including nested depth — this is **not available in native OTel** |

### Why relay instead of SDK or Hook scripts?

| Approach | Drawback |
|---------|----------|
| Hardcoded in SDK runtime | Coupled, hard to upgrade |
| Distributed Hook scripts | Scattered, hard to manage |
| **relay** | Centralized, flexible, extensible |

### What relay is NOT

- **Not a logging system** — it collects and forwards, storage is external
- **Not a decision engine** — A/B testing and business logic belong on the Skill platform
- **Not coupled to SDK** — works with any Claude Code Hook configuration

## Vision

relay serves as a **secondary development platform for Hook-based operations**. Instead of writing logic into SDK runtime or distributing Hook scripts across terminals, relay provides a unified layer where you can implement:

- Observability (collect → forward to your storage)
- Real-time alerts (detect → notify)
- Usage aggregation (per Skill, per terminal)
- Access control (block/modify tool calls)

All without modifying Claude Code or the SDK.

## Features

- 🔌 Receives all 26 Claude Code Hook events via HTTP POST
- 📁 Reads Transcript files for detailed usage calculation
- 🏷️ Multi-terminal support via `X-Source-ID` header
- 🔄 Extensible forwarder architecture (Console, HTTP, and more)
- 🚫 Zero modification to Claude Code or SDK

## Installation

**From npm (end users):**
```bash
npm install -g claude-agent-hook-relay
```
Hooks are auto-configured by the postinstall script.

**From source (developers):**
```bash
npm install
npm run build
```

## Install & Verify

After installing from npm, Claude Code hooks are **auto-configured** by the postinstall script. Follow these steps:

**Step 1: Start the relay**

```bash
relay start
```

By default the relay listens on port 8080. To use a different port:

```bash
relay start 9000
```

**Step 2: Verify with Claude Code**

In another terminal, run a prompt that triggers tool usage:

```bash
claude -p "List all files in /tmp using Bash"
```

Then check the relay terminal — you should see output like:

```
[Relay] {"sessionId":"...","sourceId":"...","skillCount":0,"skillList":[]}
```

> **Note:** `skillCount: 0` means no Skill invocations occurred — Claude Code called tools (Bash) directly. This confirms the relay is receiving hook events correctly.

**Step 3: Stop the relay**

Press Ctrl+C in the relay terminal.

---

**Useful commands:**

```bash
relay --version          # Check installation
relay status            # Show hook installation status
relay start [port]      # Start relay (default port: 8080)
relay uninstall         # Remove hooks from Claude Code
```

## For Developers

### Local setup

```bash
git clone <repo-url>
cd claude-agent-hook-relay
npm install
npm run build
```

### Run relay locally

```bash
npm run dev          # watch mode with tsx
npm run build       # compile TypeScript
npm start           # run compiled dist/index.js
```

### Configure Claude Code hooks manually

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/pre-tool-use",
        "headers": { "X-Source-ID": "my-workstation" }
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/post-tool-use",
        "headers": { "X-Source-ID": "my-workstation" }
      }]
    }],
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/stop",
        "headers": { "X-Source-ID": "my-workstation" }
      }]
    }],
    "SessionEnd": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/session-end",
        "headers": { "X-Source-ID": "my-workstation" }
      }]
    }]
  }
}
```

### Run tests

```bash
npm run test              # start relay + run test suite + stop relay
npm run test:port 8080   # test against a running relay on port 8080
```

The test suite sends realistic hook event sequences (no-skill, single-skill, nested-skill, session-end) and verifies the relay's skill tracking and aggregation logic.

### View relay output

When a session ends, the relay prints a summary:

```json
{
  "sessionId": "abc-123",
  "sourceId": "my-workstation",
  "skillCount": 1,
  "skillList": [{"skill": "batch", "durationMs": 500, "nestedCalls": ["Bash", "Read"]}],
  "totalUsage": {
    "inputTokens": 5000, "outputTokens": 300,
    "cacheReadTokens": 20000, "cacheCreationTokens": 1000,
    "costUsd": 0.05
  },
  "sessionDuration": 30000,
  "stopReason": "end_turn"
}
```

## Claude Code Observability: HTTP Hook vs OpenTelemetry

Claude Code provides two data collection mechanisms:

| Mechanism | Description |
|-----------|-------------|
| **HTTP Hook** | Real-time callbacks, can modify/block operations |
| **Native OpenTelemetry** | Standard telemetry export for metrics/traces/logs |

See [docs/data-collection-matrix.md](docs/data-collection-matrix.md) for a complete data coverage comparison.

### Key Insight: Skill Call Chain Tracking

HTTP Hook provides **unique value** that native OTel does not:

| Capability | HTTP Hook | Native OTel |
|------------|:---------:|:-----------:|
| **Skill trigger chain** | ✅ | ❌ |
| **Nested depth tracking** | ✅ | ❌ |
| Real-time processing | ✅ | ⚠️ (batched) |
| Modify/block operations | ✅ | ❌ |
| Token/Cost metrics | ❌ | ✅ |
| Standard format export | ❌ | ✅ |

```
HTTP Hook tracks:
Skill "batch"
  └── Bash "npm run build"  ← knows this was triggered by "batch"

Native OTel only records:
Skill "batch"
Bash "npm run build"  ← no parent context
```

## Documentation

- [SPEC.md](SPEC.md) - Project specification
- [AGENTS.md](AGENTS.md) - Development guidelines
- [docs/tech.md](docs/tech.md) - Technical architecture
- [docs/api.md](docs/api.md) - API endpoint reference
- [docs/data-collection-matrix.md](docs/data-collection-matrix.md) - Data coverage comparison
- [docs/otel-integration.md](docs/otel-integration.md) - OpenTelemetry integration design
- [docs/secondary-development.md](docs/secondary-development.md) - Secondary development & extensions

## Extending

### Custom Forwarders

Implement the `Forwarder` interface:

```typescript
interface Forwarder {
  forward(data: ForwardPayload): Promise<void>;
}
```

Example with Kafka:

```typescript
class KafkaForwarder implements Forwarder {
  constructor(private brokers: string[], private topic: string) {}

  async forward(data: ForwardPayload): Promise<void> {
    // Send to Kafka
  }
}
```

### Using Multiple Forwarders

```typescript
const forwarder = new CompositeForwarder([
  new ConsoleForwarder(),           // Local debugging
  new HttpForwarder('https://...'), // Remote server
]);
```

## Supported Hook Events

| Event | Endpoint |
|-------|----------|
| PreToolUse | /hook/pre-tool-use |
| PostToolUse | /hook/post-tool-use |
| PostToolUseFailure | /hook/post-tool-use-failure |
| PermissionRequest | /hook/permission-request |
| PermissionDenied | /hook/permission-denied |
| UserPromptSubmit | /hook/user-prompt-submit |
| Stop | /hook/stop |
| StopFailure | /hook/stop-failure |
| SessionStart | /hook/session-start |
| SessionEnd | /hook/session-end |
| SubagentStart | /hook/subagent-start |
| SubagentStop | /hook/subagent-stop |
| TaskCreated | /hook/task-created |
| TaskCompleted | /hook/task-completed |
| PreCompact | /hook/pre-compact |
| PostCompact | /hook/post-compact |
| Notification | /hook/notification |
| TeammateIdle | /hook/teammate-idle |
| InstructionsLoaded | /hook/instructions-loaded |
| ConfigChange | /hook/config-change |
| CwdChanged | /hook/cwd-changed |
| FileChanged | /hook/file-changed |
| WorktreeCreate | /hook/worktree-create |
| WorktreeRemove | /hook/worktree-remove |
| Elicitation | /hook/elicitation |
| ElicitationResult | /hook/elicitation-result |

## License

MIT - see [LICENSE](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)
