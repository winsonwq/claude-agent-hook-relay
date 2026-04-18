# 技术架构

## 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     Claude Code 终端                             │
│  ┌────────────┐                                                 │
│  │ HTTP Hook   │ ──POST /hook/pre-tool-use──┐                   │
│  │ Config     │ ──POST /hook/post-tool-use──┼── X-Source-ID     │
│  │            │ ──POST /hook/stop────────────┘                   │
│  └────────────┘                                                 │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (JSON)
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                   claude-agent-hook-relay                              │
│                                                                  │
│  ┌────────────┐    ┌─────────────┐    ┌────────────────────┐   │
│  │ Express    │───→│ Collector   │───→│ SessionManager      │   │
│  │ Router     │    │             │    │ - skillStack       │   │
│  └────────────┘    └─────────────┘    │ - events           │   │
│                              │         └────────────────────┘   │
│                              │                   │               │
│                              ↓                   ↓               │
│                     ┌────────────────┐   ┌─────────────────┐   │
│                     │ TranscriptReader│   │ Forwarder       │   │
│                     │ (按需读取)     │   │ - ConsoleFwd    │   │
│                     └────────────────┘   │ - HttpFwd        │   │
│                                          │ - CompositeFwd  │   │
│                                          └─────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ ForwardPayload
                              ↓
                   ┌─────────────────────┐
                   │ 外部系统             │
                   │ - Console (调试)    │
                   │ - HTTP Server       │
                   │ - Kafka (未来)      │
                   └─────────────────────┘
```

## 模块说明

### 1. Express Router (index.ts)

- 监听所有 Hook 事件端点
- 将请求传递给 Collector

### 2. Collector (collector.ts)

- 解析请求体
- 调用 SessionManager 维护状态
- 在 Stop 事件时触发转发

### 3. SessionManager (session.ts)

- 内存中维护所有 Session 状态
- `skillStack`：追踪嵌套的 Skill 调用
- `events`：记录所有事件

### 4. TranscriptReader (transcript.ts)

- 按需读取 .jsonl 文件
- 解析 assistant message 中的 usage 数据

### 5. Forwarder (forwarder.ts)

#### Forwarder 接口

```typescript
interface Forwarder {
  forward(data: ForwardPayload): Promise<void>;
}
```

#### 内置实现

| 转发器 | 说明 |
|--------|------|
| ConsoleForwarder | 输出到 stdout，用于调试 |
| HttpForwarder | POST 到外部 HTTP 服务器 |
| CompositeForwarder | 组合多个转发器 |

## 数据流

### 1. PreToolUse 事件

```
Claude Code ──POST /hook/pre-tool-use──→ Collector
                                           │
                                           ├──→ SessionManager.pushSkill()  (如果是 Skill)
                                           │
                                           └──→ SessionManager.pushNestedCall()  (嵌套工具)
```

### 2. PostToolUse 事件

```
Claude Code ──POST /hook/post-tool-use──→ Collector
                                           │
                                           └──→ SessionManager.popSkill()  (如果是 Skill)
```

### 3. Stop 事件

```
Claude Code ──POST /hook/stop───────────→ Collector
                                           │
                                           ├──→ TranscriptReader.getSessionUsage()  (计算 usage)
                                           │
                                           ├──→ Forwarder.forward(payload)
                                           │
                                           └──→ SessionManager.clear()
```

## 数据结构

### ForwardPayload

```typescript
interface ForwardPayload {
  sessionId: string;           // 会话 ID
  sourceId: string;            // X-Source-ID Header
  skillInvocations: SkillInvocation[];  // Skill 调用列表
  totalUsage: ModelUsage;      // 汇总 usage
  allEvents: HookEvent[];      // 所有事件
  sessionDuration: number;    // 会话时长 (ms)
  stopReason?: string;        // 停止原因
}
```

### SkillInvocation（树形结构）

```typescript
interface SkillInvocation {
  skill: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  nestedCalls: string[];      // 直接调用的工具名列表
  children: SkillInvocation[]; // 子 Skill 调用（支持递归嵌套）
  toolUseId?: string;
}
```

#### 示例

```
Skill1 执行
  └── Tool1, Tool2 (nestedCalls)
  └── Skill2 执行 (children[0])
        └── Tool3 (nestedCalls)
  └── Skill3 执行 (children[1])
        └── Tool4
```

对应数据结构：

```typescript
{
  skill: "skill1",
  startTime: 1713345600000,
  nestedCalls: ["Tool1", "Tool2"],
  children: [
    {
      skill: "skill2",
      startTime: 1713345605000,
      nestedCalls: ["Tool3"],
      children: []
    },
    {
      skill: "skill3",
      startTime: 1713345610000,
      nestedCalls: ["Tool4"],
      children: []
    }
  ]
}
```

#### 栈操作逻辑

| 事件 | 操作 |
|------|------|
| PreToolUse (Skill) | push 到栈顶；入栈前记录为栈顶的 children |
| PreToolUse (其他工具) | 加入栈顶的 nestedCalls |
| PostToolUse (Skill) | pop；计算 durationMs |

#### Skill 聚合统计

Skill 作为入口时，需要计算**整棵子树**的聚合统计数据：

```typescript
interface SkillInvocation {
  // 身份信息
  skill: string;
  invocationId: string;
  parentInvocationId?: string;
  depth: number;
  
  // 自身信息
  startTime: number;
  endTime?: number;
  durationMs?: number;           // 自身执行耗时
  nestedCalls: string[];        // 直接调用的工具
  children: SkillInvocation[];  // 子 Skill
  toolUseId?: string;
  
  // 聚合统计（整棵子树）
  totalDurationMs: number;       // 自身 + 所有子 Skill 耗时
  totalToolCalls: number;        // 自身 + 所有子 Skill 的工具调用总数
  totalTokenUsage?: TokenUsage;  // 子树内所有工具调用的 Token 消耗
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}
```

##### 聚合计算逻辑

```typescript
function aggregateSkillStats(skill: SkillInvocation): void {
  // 1. 递归计算子 Skill
  let childDuration = 0
  let childToolCalls = 0
  let childTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
  
  for (const child of skill.children) {
    aggregateSkillStats(child)
    childDuration += child.totalDurationMs
    childToolCalls += child.totalToolCalls
    childTokenUsage.inputTokens += child.totalTokenUsage?.inputTokens || 0
    childTokenUsage.outputTokens += child.totalTokenUsage?.outputTokens || 0
    childTokenUsage.cacheReadTokens += child.totalTokenUsage?.cacheReadTokens || 0
    childTokenUsage.cacheCreationTokens += child.totalTokenUsage?.cacheCreationTokens || 0
  }
  
  // 2. 聚合到当前 Skill
  skill.totalDurationMs = (skill.durationMs || 0) + childDuration
  skill.totalToolCalls = skill.nestedCalls.length + childToolCalls
  skill.totalTokenUsage = {
    inputTokens: skill.tokenUsage?.inputTokens || 0 + childTokenUsage.inputTokens,
    outputTokens: skill.tokenUsage?.outputTokens || 0 + childTokenUsage.outputTokens,
    cacheReadTokens: skill.tokenUsage?.cacheReadTokens || 0 + childTokenUsage.cacheReadTokens,
    cacheCreationTokens: skill.tokenUsage?.cacheCreationTokens || 0 + childTokenUsage.cacheCreationTokens,
  }
}
```

##### 示例

```
Skill: "batch" (root, depth=0)
├── 自身: durationMs=1000, nestedCalls=[Tool1, Tool2]
├── 子 Skill: skill2 (durationMs=500, nestedCalls=[Tool3])
│   └── 子 Skill: skill3 (durationMs=200, nestedCalls=[Tool4])
│
└── 聚合结果:
    ├── totalDurationMs: 1700 (1000+500+200)
    ├── totalToolCalls: 4 (2+1+1)
    └── totalTokenUsage: { input: 5000, output: 2000 }
```

##### 数据来源

| 统计 | 来源 |
|------|------|
| `durationMs` | PreToolUse / PostToolUse 事件时间戳 |
| `totalDurationMs` | 递归汇总子树 |
| `totalToolCalls` | 树节点计数 |
| `totalTokenUsage` | Transcript 文件（关联 session_id 获取） |

### ModelUsage

```typescript
interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}
```

## 扩展转发器

### 添加新的转发器

```typescript
class KafkaForwarder implements Forwarder {
  constructor(private brokers: string[], private topic: string) {}
  
  async forward(data: ForwardPayload): Promise<void> {
    // 实现 Kafka 发送逻辑
  }
}
```

### 使用组合转发器

```typescript
const forwarder = new CompositeForwarder([
  new ConsoleForwarder(),           // 本地调试
  new HttpForwarder('https://...'), // 远程服务器
  new KafkaForwarder(['kafka:9092'], 'claude-hooks')  // 消息队列
]);
```

## 配置

### Claude Code HTTP Hook 配置

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/pre-tool-use",
        "headers": {
          "X-Source-ID": "workstation-1"
        }
      }]
    }],
    "PostToolUse": [...],
    "Stop": [...]
  }
}
```

### 路由映射

| 事件 | 路由 |
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
