# claude-agent-hook-relay

> 收集并转发 Claude Code Hook 事件，将事件统一汇聚到外部系统。

## CLI 命令

安装后可用两个命令，功能完全相同：

| 命令 | 说明 |
|------|------|
| `claude-agent-hook-relay` | 全名 |
| `cahr` | 缩写 |

示例：`cahr start` 和 `claude-agent-hook-relay start` 效果一样。

---

## 这是什么

`claude-agent-hook-relay` 是一个轻量的 HTTP 服务，充当 **Hook 事件汇聚层**。它的核心价值：

| 价值 | 说明 |
|------|------|
| **多终端 Hook 汇聚** | 多个 Claude Code 实例的 Hook 事件统一收集，无需在每个终端单独配置 |
| **Skill 调用链追踪** | 追踪哪个 Skill 调用了哪些工具，包括嵌套深度 —— 这是原生 OTel **做不到** 的 |

### 为什么用 cahr 而不是 SDK 或 Hook 脚本？

| 方案 | 问题 |
|------|------|
| SDK 硬编码 | 耦合紧，升级困难 |
| 分散的 Hook 脚本 | 难以管理，分散在各处 |
| **cahr** | 集中管理，灵活可扩展 |

### cahr 不是

- **不是日志系统** —— 它只做收集和转发，存储由外部处理
- **不是决策引擎** —— A/B 测试和业务逻辑属于 Skill 平台
- **不依赖 SDK** —— 配合任意 Claude Code Hook 配置使用

## 功能

- 🔌 接收全部 26 个 Claude Code Hook 事件
- 📁 读取 Transcript 文件计算详细用量
- 🏷️ 通过 `X-Source-ID` 支持多终端
- 🔄 可扩展的 Forwarder 架构（Console、HTTP 等）
- 🚫 无需修改 Claude Code 或 SDK

---

## 安装

**方式一：通过 npm 安装（适合最终用户）**

```bash
npm install -g claude-agent-hook-relay
```

安装后，postinstall 脚本会自动在 `~/.claude/settings.json` 中配置好 Hook 指向 `http://localhost:8080`。

**方式二：从源码安装（适合开发者）**

```bash
git clone <仓库地址>
cd claude-agent-hook-relay
npm install
npm run build
```

---

## 安装后验证

安装完成后，按以下步骤验证 cahr 是否正常工作：

**第一步：启动 cahr**

```bash
cahr start
# 或
claude-agent-hook-relay start
```

默认监听端口 8080。如需更换端口：

```bash
cahr start 9000
```

**第二步（可选）：安装测试 Skill**

如果你想验证 Skill 嵌套追踪功能，可以安装一个测试 Skill：

```bash
cahr install-test-skill
```

这会把测试 Skill 安装到 `~/.claude/skills/`，包括：

- `parent-skill`（父 Skill，调用子 Skill 和工具）
- `child-skill`（子 Skill，被父 Skill 调用）
- `nested-test-skill` 和 `weather-checker`（其他测试 Skill）

**第三步：用 Claude Code 触发工具调用**

在另一个终端运行：

```bash
# 基础验证：触发 Bash 工具
claude -p "列出 /tmp 目录下的所有文件"

# Skill 追踪验证（如果安装了测试 Skill）：
claude -p "run nested-test-skill"
```

**第四步：查看 cahr 输出**

回到 cahr 终端，应该能看到类似这样的输出：

```
────────────────────────────────────────────────────────────
📋 Session abc-123… · 30000ms
🤖 weather-checker
├── 🔧 Bash echo 'Weather check: ' && date +7966ms
────────────────────────────────────────────────────────────
📊 Tokens  in=1500, out=80
📌 Reason  end_turn
────────────────────────────────────────────────────────────
```

**嵌套 Skill 示例**：

```
────────────────────────────────────────────────────────────
📋 Session def-456… · 17473ms
🤖 nested-test-skill
├── 🤖 weather-checker (1 calls)
│   └── 🔧 Bash echo 'Weather check: ' && date +7850ms
├── 🔧 Bash date +120ms
└── 🔧 Read /home/aqiu/.claude/skills/nested-test-skill/example.txt +95ms
────────────────────────────────────────────────────────────
📊 Tokens  in=3200, out=150
📌 Reason  end_turn
────────────────────────────────────────────────────────────
```

输出说明：
- `📋 Session` 开头的是会话信息（sessionId 截断 + 总耗时）
- `🤖` 表示 Skill 节点，带耗时和嵌套调用数
- `🔧` 表示 Tool 节点，显示工具名、具体参数（command/file/url 等）和耗时
- Tool 节点参数会截断到 40 字符

**第五步：停止 cahr**

在 cahr 终端按 `Ctrl+C`。

---

**其他常用命令**

```bash
cahr --version                  # 查看版本，确认安装成功
cahr status                     # 查看 Hook 安装状态
cahr start [端口]               # 启动 cahr
cahr init [--url <url>]         # 初始化 Claude Code hooks（默认 http://localhost:8080）
cahr install-test-skill         # 安装测试 Skill（用于验证嵌套 Skill 追踪）
cahr uninstall                  # 移除 Claude Code 中的 Hook 配置
```

---

## 开发者文档

### 本地开发环境搭建

```bash
git clone <仓库地址>
cd claude-agent-hook-relay
npm install
npm run build
```

### 手动配置 Claude Code Hook

如果你需要手动配置 Hook（在源码开发模式下），在 `~/.claude/settings.json` 中添加：

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

### 运行测试

```bash
npm run test                  # 启动 cahr → 运行测试 → 停止 cahr
npm run test:port 8080       # 连接已有 cahr（指定端口）运行测试
```

测试会发送 4 种 Hook 事件序列（无 Skill、单 Skill、嵌套 Skill、SessionEnd），验证 cahr 的 Skill 追踪和聚合逻辑是否正确。测试不依赖真实的 Skill，skill 名称是测试用的模拟字符串。

### cahr 输出示例

Session 结束时，cahr 会打印汇总：

```
────────────────────────────────────────────────────────────
📋 Session abc-123… · 30000ms
🤖 batch  500ms
├── 🔧 Bash date +45ms
└── 🔧 Read /path/file +120ms
────────────────────────────────────────────────────────────
📊 Tokens  in=5000, out=300 cache=20000
📌 Reason  end_turn
────────────────────────────────────────────────────────────
```

转发到 HTTP 服务时，数据格式为：

```json
{
  "sessionId": "abc-123",
  "sourceId": "my-workstation",
  "skillTree": {
    "skill": "batch",
    "toolUseId": "inv_001",
    "durationMs": 500,
    "success": true,
    "discoveryCalls": [],
    "loadedFromNestedPath": false,
    "nestedCalls": [
      { "type": "tool", "name": "Bash", "command": "date", "durationMs": 45 },
      { "type": "tool", "name": "Read", "file": "/path/file", "durationMs": 120 }
    ]
  },
  "totalUsage": {
    "inputTokens": 5000,
    "outputTokens": 300,
    "cacheReadTokens": 20000,
    "cacheCreationTokens": 1000,
    "costUsd": 0.05
  },
  "sessionDuration": 30000,
  "stopReason": "end_turn",
  "failures": []
}
```

---

## Claude Code 可观测性：HTTP Hook vs OpenTelemetry

Claude Code 提供两种数据收集机制：

| 机制 | 说明 |
|------|------|
| **HTTP Hook** | 实时回调，可以修改或拦截操作 |
| **原生 OpenTelemetry** | 标准遥测导出，用于指标/追踪/日志 |

HTTP Hook 提供了原生 OTel 无法做到的能力：

| 能力 | HTTP Hook | 原生 OTel |
|------|:---------:|:---------:|
| **Skill 触发链追踪** | ✅ | ❌ |
| **嵌套深度追踪** | ✅ | ❌ |
| 实时处理 | ✅ | ⚠️（批量） |
| 修改/拦截操作 | ✅ | ❌ |
| Token/费用指标 | ❌ | ✅ |
| 标准格式导出 | ❌ | ✅ |

详细对比见 [docs/data-collection-matrix.md](docs/data-collection-matrix.md)。

> 💡 **Tip**：OtelForwarder 会自动合并所有 Skill Span 和原生 OTel Span 为统一的服务名。可通过 `RELAY_OTEL_SERVICE_NAME` 环境变量指定合并后的服务名，默认为 `claude-code`。

---

## 支持的 Hook 事件

| 事件 | 端点 |
|------|------|
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

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `RELAY_HTTP_URL` | HTTP 转发目标地址（与 `RELAY_OTEL_URL` 二选一） |
| `RELAY_AUTH_HEADER` | HTTP 转发 Authorization header 值 |
| `RELAY_OTEL_URL` | OpenTelemetry 收集器地址（与 `RELAY_HTTP_URL` 二选一） |
| `RELAY_OTEL_AUTH_HEADER` | OTel Authorization header 值 |
| `RELAY_OTEL_SERVICE_NAME` | 合并到 Jaeger 等平台的服务名，默认为 `claude-code` |
| `RELAY_SOURCE_ID` | 事件来源标识（如终端名、用户 ID） |

---

## 扩展 Forwarder

实现 `Forwarder` 接口即可添加自定义转发目标：

```typescript
interface Forwarder {
  forward(data: ForwardPayload): Promise<void>;
}
```

例如转发到 Kafka：

```typescript
class KafkaForwarder implements Forwarder {
  constructor(private brokers: string[], private topic: string) {}
  async forward(data: ForwardPayload): Promise<void> {
    // 发送到 Kafka
  }
}
```

使用多个 Forwarder：

```typescript
const forwarder = new CompositeForwarder([
  new ConsoleForwarder(),           // 本地调试
  new HttpForwarder('https://...'), // 远程服务器
]);
```

---

## 更多文档

- [SPEC.md](SPEC.md) - 项目规格说明
- [AGENTS.md](AGENTS.md) - 开发指南
- [docs/tech.md](docs/tech.md) - 技术架构
- [docs/api.md](docs/api.md) - API 端点参考
- [docs/data-collection-matrix.md](docs/data-collection-matrix.md) - 数据覆盖对比
- [docs/otel-integration.md](docs/otel-integration.md) - OpenTelemetry 集成设计
- [docs/secondary-development.md](docs/secondary-development.md) - 二次开发指南
- [docs/test-semantics.md](docs/test-semantics.md) - 测试语义与输出格式规范
- [docs/token-accounting.md](docs/token-accounting.md) - Token 计算与费用估算
- [docs/specs/skill-discovery-tracing-v1.0.0-spec.md](docs/specs/skill-discovery-tracing-v1.0.0-spec.md) - Skill 发现追踪协议规范

---

## License

MIT - 见 [LICENSE](LICENSE)
