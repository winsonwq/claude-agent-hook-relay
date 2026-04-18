# SPEC.md - 需求规格

## 项目背景

在不修改 Claude Code SDK 的情况下，收集 Claude Code 的运行数据（工具调用、Skill 使用、Usage 统计等），并转发到外部日志系统。

**终极目标**：成为 Claude Code 的**系统级可观测性出口（Sidecar）**，支撑 Skill 质量分析、运行日志分析、多终端监控等场景。

## 核心需求

> 📊 **完整数据能力对比**：参见 [docs/data-collection-matrix.md](docs/data-collection-matrix.md)

### 需要收集的数据

| 数据类型 | 来源 | 说明 |
|---------|------|------|
| 工具调用记录 | PreToolUse / PostToolUse | 所有工具的调用/完成事件 |
| Skill 调用链 | Skill 嵌套检测 | **树形结构**：支持 Skill → Skill → Tool 递归嵌套 |
| Skill 聚合统计 | 递归计算 | 整棵子树的 duration、toolCalls、tokenUsage |
| 会话统计 | Stop / SessionEnd | 每个会话的 usage 汇总 |
| 多终端区分 | transcript_path | 自动从路径推断用户/机器 |
| Transcript | 文件读取 | 解析 .jsonl 文件获取详细 usage |

### 技术约束

1. **零侵入**：不修改 Claude Code SDK
2. **利用原生机制**：使用 Claude Code HTTP Hook
3. **支持多终端**：同一服务接收多个 Claude Code 实例的数据
4. **可扩展转发**：支持多种转发目标（Console / HTTP / 未来更多）
5. **开箱即用**：npm install 后自动配置

## 功能目标

### Phase 1 - 基础 Relay

#### 核心功能
- [x] 接收所有 26 个 Hook 事件的 HTTP POST 请求
- [x] 维护 Session 级别的调用栈（追踪 Skill 嵌套）
- [x] 读取 Transcript 文件计算完整 Usage
- [x] 通过 transcript_path 自动区分多终端（用户/机器）
- [x] 提供 Console 转发器（调试用）
- [x] 提供 HTTP 转发器（生产用）
- [x] 支持转发器组合（同时发往多个目标）

#### 安装与配置
- [x] **npm install -g 后自动安装 Hooks**
  - postinstall 脚本检测 Claude Code 是否安装
  - 已安装 → 自动写入 hooks 配置 → `claude config reload`
  - 未安装 → 跳过（提示用户稍后运行 `relay init`）
- [x] **relay init 命令**（Claude Code 后装时手动初始化）
  - 检测 Claude Code 安装状态
  - 写入 hooks 配置到 `~/.claude/settings.json`
  - 支持 `--url` 指定 relay 地址
- [x] **端口自动选择**
  - 默认端口 8080
  - 端口被占用时自动递增查找可用端口
  - 启动时提示实际使用的端口

#### CLI 命令
```
relay start     # 启动 relay 服务（默认 8080）
relay init      # 初始化 Claude Code hooks
relay uninstall # 移除 Claude Code hooks 配置
relay status    # 查看 relay 状态
```

### Phase 2 - 增强分析（规划中）

- [ ] **多终端标识增强**
  - X-Source-ID（人工指定）
  - machine-id（自动采集）
  - IP / Hostname

- [ ] **Skill 深度追踪**
  - 嵌套调用链完整记录
  - 每个 Skill 的耗时统计
  - Skill 被触发的次数

- [ ] **Usage 聚合**
  - input / output / cache tokens 汇总
  - 预估 cost 计算
  - 按 Skill 维度拆分

- [ ] **实时告警**
  - 高频调用检测
  - 超时检测
  - 异常错误率

- [ ] **统一出口**
  - HTTP（已有）
  - Kafka（规划）
  - WebSocket（规划）

- [ ] **OpenTelemetry 集成**（规划）
  - Skill Span 格式设计（参见 [docs/otel-integration.md](docs/otel-integration.md)）
  - 与原生 OTel 格式兼容
  - Skill 树形结构作为 OTel Span 树

## 安装流程

### 自动安装（推荐）

```bash
# 1. 全局安装
npm install -g claude-agent-hook-relay

# 2. postinstall 自动检测并配置
#    - 检测 claude 是否安装
#    - 写入 hooks 配置
#    - claude config reload

# 3. 启动 relay
relay start
```

### 手动安装（Claude Code 后装）

```bash
# 1. 安装 Claude Code
npm install -g @anthropic-ai/claude-code

# 2. 初始化 hooks
relay init --url http://localhost:8080

# 3. 启动 relay
relay start
```

### Claude Code Hooks 配置

安装后，Claude Code 的 `~/.claude/settings.json` 会包含：

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/pre-tool-use"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/post-tool-use"
      }]
    }],
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/stop"
      }]
    }]
  }
}
```

## 多终端自动识别

Claude Code 不主动发送终端标识，但可以从 `transcript_path` 推断：

### transcript_path 格式

```
/home/{username}/.claude/projects/{project}/{session_id}.jsonl
/Users/{username}/.claude/sessions/{session_id}.jsonl
```

### 解析逻辑

```typescript
interface TerminalIdentity {
  userId: string;      // 从路径提取的用户名
  machineId?: string;   // 可选的机器标识
  projectId?: string;   // 项目标识
}

function parseTerminalIdentity(transcriptPath: string): TerminalIdentity {
  // /home/alice/.claude/projects/myapp/abc123.jsonl
  const match = transcriptPath.match(/\/home\/([^\/]+)\//);
  return {
    userId: match?.[1] || 'unknown',
  };
}
```

### 优先级

1. **X-Source-ID Header**（用户手动配置时）
2. **transcript_path 推断**（自动，无感知）

## 端口选择机制

```typescript
const DEFAULT_PORT = 8080;
const MAX_PORT = 65535;

async function findAvailablePort(startPort: number = DEFAULT_PORT): Promise<number> {
  for (let port = startPort; port <= MAX_PORT; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found from ${startPort}`);
}
```

### 启动输出示例

```bash
$ relay start

claude-agent-hook-relay v0.1.0
Listening on http://localhost:8080

$ relay start

claude-agent-hook-relay v0.1.0
⚠️  Port 8080 was in use, using 8081
Listening on http://localhost:8081
```

## 数据结构

### SessionReport（Stop 事件输出）

```typescript
interface SessionReport {
  // 基础信息
  sessionId: string;
  terminalIdentity: TerminalIdentity;
  
  // 时间统计
  startTime: number;
  endTime: number;
  durationMs: number;
  
  // Skill 统计
  skills: {
    name: string;
    invocations: number;
    totalDurationMs: number;
    avgDurationMs: number;
    nestedCalls: string[];
  }[];
  
  // 工具统计
  tools: {
    name: string;
    invocations: number;
    failures: number;
  }[];
  
  // Usage 统计
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    estimatedCost: number;
  };
  
  // 原始事件（可选，用于调试）
  events: HookEvent[];
  
  // 异常标记
  alerts?: {
    type: 'high_frequency' | 'long_duration' | 'high_cost' | 'repeated_failures';
    message: string;
  }[];
}
```

## 用户场景

### 场景 1：本地调试

```
开发者本机
├── Claude Code (终端 A) ──→ localhost:8080 ──→ Console
└── Claude Code (终端 B) ──→ localhost:8080 ──→ Console
```

### 场景 2：Skill 平台可观测性

```
┌─────────────────────────────────────────────────────────────────┐
│                    Skill 线上平台                                │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐  │
│  │ Skill 编辑器 │   │ Skill 商店   │   │ Skill 运行平台        │  │
│  └─────────────┘   └─────────────┘   └─────────────────────┘  │
│                                               │                 │
│                                    ┌──────────┴──────────┐       │
│                                    │  Claude Code 内核  │       │
│                                    │  (多租户容器化)     │       │
│                                    └──────────┬──────────┘       │
│                                               │                 │
│                                    ┌──────────┴──────────┐       │
│                                    │ hook-relay (Sidecar)│       │
│                                    │ (可观测性出口)      │       │
│                                    └──────────┬──────────┘       │
└───────────────────────────────────────────────┼─────────────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │  数据分析平台          │
                                    │  - Skill 质量评估     │
                                    │  - 性能分析           │
                                    │  - 使用模式           │
                                    │  - 计费依据           │
                                    └─────────────────────┘
```

### 场景 3：多终端统一监控

```
终端 A (dev)     终端 B (staging)    终端 C (prod)
    │                 │                  │
    └─────────────────┼──────────────────┘
                      │
                      ▼
          ┌───────────────────────────┐
          │   claude-agent-hook-relay  │
          │   (Sidecar, 统一出口)      │
          └───────────────────────────┘
                      │
                      ▼
          ┌───────────────────────────┐
          │   日志/监控平台            │
          └───────────────────────────┘
```

## 架构定位

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code 集群 (Sidecar 模式)                 │
│   终端 A          终端 B          终端 C                        │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                   │
│  │ Claude  │    │ Claude  │    │ Claude  │                   │
│  │ Code    │    │ Code    │    │ Code    │                   │
│  └────┬────┘    └────┬────┘    └────┬────┘                   │
│       │relay         │relay         │relay                    │
└───────┼──────────────┼──────────────┼─────────────────────────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│          claude-agent-hook-relay (增强版)                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐    │
│  │ Hook 收集  │  │ Skill 分析 │  │ 多终端标识              │    │
│  │ (26 事件)  │  │            │  │ - transcript_path 推断 │    │
│  └────────────┘  └────────────┘  └────────────────────────┘    │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐    │
│  │ Usage 计算  │  │ 实时告警   │  │ 统一出口                │    │
│  │            │  │            │  │ - Console              │    │
│  │            │  │            │  │ - HTTP                 │    │
│  └────────────┘  └────────────┘  └────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## 可观测性维度

| 维度 | relay 能提供 |
|------|-------------|
| **Logs** | ✅ 所有 Hook 事件原始记录 |
| **Metrics** | ✅ Usage、调用次数、耗时统计 |
| **Traces** | ✅ Skill 调用链、嵌套关系 |
| **Alerts** | ⚠️ 简单阈值告警（Phase 2） |

## 技术选型

- **语言**：TypeScript
- **框架**：Express
- **运行时**：Node.js 18+
- **构建**：tsc + tsx (开发)

## 项目结构

```
claude-agent-hook-relay/
├── src/
│   ├── index.ts        # 主入口 + CLI
│   ├── collector.ts   # Hook 收集逻辑
│   ├── session.ts      # Session 管理
│   ├── transcript.ts   # Transcript 读取
│   ├── forwarder.ts    # 转发器接口
│   ├── types.ts       # 类型定义
│   └── utils/
│       ├── port.ts    # 端口选择
│       └── install.ts # Hook 安装逻辑
├── scripts/
│   └── postinstall.js # npm install -g 后自动安装 hooks
├── docs/
│   ├── tech.md
│   ├── api.md
│   ├── data-collection-matrix.md  # HTTP Hook vs OTel 数据矩阵
│   ├── otel-integration.md       # OpenTelemetry 集成设计
│   └── secondary-development.md  # 二次开发与扩展
├── package.json
├── tsconfig.json
└── .eslintrc.json
```

## 项目状态

**当前状态**：Phase 1 代码实现完成，端到端测试通过
