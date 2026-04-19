# OpenTelemetry 集成设计

## 实现状态

> ⚠️ **注意**：SkillTree 结构变更时需同步更新 OtelForwarder

### 已实现
- ✅ `OtelForwarder` - 将 SkillTree 转换为 OTel 兼容的 Span 格式
- ✅ 配置方式：环境变量 `RELAY_OTEL_URL`

### Span 格式

每个 Skill 节点转换为一个 OTel Span：

```typescript
interface OtelSpan {
  name: 'claude_code.skill';
  attributes: {
    'span.type': 'skill';
    'user.id': string;
    'session.id': string;
    'skill.name': string;
    'skill.invocation_id': string;      // 唯一标识，用于关联父子
    'skill.parent_invocation_id'?: string; // 父 Skill ID（顶级为 undefined）
    'skill.depth': number;              // 0 = 顶级
    'skill.nested_tools': string[];     // 直接调用的工具列表
    'skill.child_skills': string[];     // 子 Skill 名称列表
    'skill.duration_ms': number;
    'skill.total_tool_calls': number;   // nested_tools.length + 子 Skill 的总调用数
  };
}
```

### 配置示例

```bash
# 启动 relay 并启用 OTel 转发
RELAY_OTEL_URL=http://otel-collector:4317/v1/traces \
RELAY_OTEL_AUTH_HEADER="Bearer xxx" \
  cahr start
```

---

## 背景

Claude Code 原生支持 OpenTelemetry 导出，但**不包含 Skill 调用链追踪**。Relay 可以作为 OTel 数据的**补充来源**，将 Skill 树形调用链转换为 OTel 兼容格式。

---

## Claude Code 原生 OTel Span 结构

### Span 类型

| Span 名称 | 类型 | 说明 |
|-----------|------|------|
| `claude_code.interaction` | interaction | 用户请求周期 |
| `claude_code.llm_request` | llm_request | LLM API 请求 |
| `claude_code.tool` | tool | 工具调用 |
| `claude_code.hook` | hook | Hook 执行 |

### 基础 Attributes

所有 Span 都包含：

```typescript
{
  'user.id': string,
  'session.id': string,
  'app.version': string,
  'organization.id'?: string,
  'user.email'?: string,
  'terminal.type'?: string,
}
```

### Tool Span Attributes

```typescript
{
  'span.type': 'tool',
  'tool_name': string,
  'skill_name'?: string,        // 仅当 tool_name === 'Skill' 时
  'tool_parameters'?: string,   // JSON string
}
```

---

## Relay OTel 集成方案

### 核心思路

将 Skill 调用链转换为 **OTel Span 树**，与原生格式保持一致：

```
claude_code.interaction (原生)
    ├── claude_code.llm_request (原生)
    └── claude_code.tool (原生)
            │
            └── claude_code.skill (Relay 新增)
                    │
                    ├── claude_code.skill (子 Skill)
                    │       └── claude_code.tool (子 Skill 的工具)
                    │
                    └── claude_code.tool (Skill 触发的工具)
```

### Skill Span 格式

```typescript
// Span: claude_code.skill
{
  name: 'claude_code.skill',
  attributes: {
    'span.type': 'skill',
    'skill.name': 'batch',
    'skill.invocation_id': 'uuid',        // 用于关联父子的唯一 ID
    'skill.parent_id'?: string,           // 父 Skill 的 invocation_id
    'skill.depth': 0,                     // 嵌套深度
    'skill.nested_tools': ['Bash', 'Edit'],
    'skill.child_skills': ['skill2'],    // 子 Skill 名称列表
    'skill.duration_ms': 5000,
    'skill.total_tool_calls': 3,
    
    // 基础属性（保持与原生一致）
    'user.id': 'xxx',
    'session.id': 'xxx',
  }
}
```

### Skill Event Log 格式

除了 Span，还可以发送 Event Log：

```typescript
// Event: claude_code.skill_invocation
{
  body: 'claude_code.skill_invocation',
  attributes: {
    'event.name': 'skill_invocation',
    'event.timestamp': '2026-04-17T12:00:00.000Z',
    'event.sequence': 1,
    
    'skill.name': 'batch',
    'skill.invocation_id': 'uuid',
    'skill.parent_id'?: string,
    'skill.depth': 0,
    'skill.nested_tools': ['Bash', 'Edit'],
    'skill.child_skills': ['skill2'],
    'skill.duration_ms': 5000,
    
    'user.id': 'xxx',
    'session.id': 'xxx',
  }
}
```

---

## 树形结构实现方案

### 方案 1：Span Parent-Child 关系（推荐）

每个 Skill 是一个独立的 Span，通过 OTel 的父子关系建立树形结构：

```typescript
// 创建 Skill1 Span（parent = 当前 interaction span）
const skill1Span = tracer.startSpan('claude_code.skill', {
  attributes: {
    'skill.name': 'skill1',
    'skill.invocation_id': 'skill1-uuid',
    'skill.depth': 0,
  }
}, parentContext)

// Skill1 的工具作为 skill1Span 的子 Span
const tool1Span = tracer.startSpan('claude_code.tool', {...}, skill1Span)

// Skill2 作为 Skill1 的子 Span
const skill2Span = tracer.startSpan('claude_code.skill', {
  attributes: {
    'skill.name': 'skill2',
    'skill.invocation_id': 'skill2-uuid',
    'skill.parent_id': 'skill1-uuid',
    'skill.depth': 1,
  }
}, skill1Span)
```

**优点**：天然支持树形结构，OTel SDK 自动处理父子关系
**缺点**：需要管理 span context

### 方案 2：Event Log + 属性引用

不创建新的 Span 类型，而是在原生 tool span 上添加 skill 上下文：

```typescript
// 原生 tool span 增强
{
  'tool_name': 'Bash',
  'skill.name': 'batch',              // 直接父 Skill
  'skill.invocation_id': 'batch-uuid', // 父 Skill ID
  'skill.depth': 0,                    // 在 Skill 调用链中的深度
  'skill.path': ['batch', 'skill2'],  // 完整路径
}
```

**优点**：简单，不破坏原生格式
**缺点**：丢失树形结构的明确性

---

## 推荐实现

### 最终格式设计

```typescript
interface SkillSpan {
  // OTel 标准
  name: 'claude_code.skill';
  
  // 基础属性（与原生一致）
  attributes: {
    'span.type': 'skill';
    'user.id': string;
    'session.id': string;
    
    // Skill 特定属性
    'skill.name': string;
    'skill.invocation_id': string;      // 唯一标识，用于关联
    'skill.parent_invocation_id'?: string; // 父 Skill ID（顶级为 undefined）
    'skill.depth': number;              // 0 = 顶级
    'skill.nested_tools': string[];    // 直接调用的工具
    'skill.child_skills': string[];    // 子 Skill 名称
    'skill.duration_ms': number;
    'skill.total_tool_calls': number;   // nested_tools.length + 子 Skill 的总调用数
  };
}
```

### 示例输出

```
Session: abc-123
Skill: "batch" (depth=0, duration=5000ms)
├── nested_tools: ["Bash", "Edit"]
├── child_skills: ["skill2"]
└── total_tool_calls: 4

    Skill: "skill2" (depth=1, parent=batch, duration=3000ms)
    ├── nested_tools: ["Bash"]
    ├── child_skills: []
    └── total_tool_calls: 1
```

对应的 OTel Span 树：

```
interaction span (session=abc-123)
└── skill span (skill.name=batch, depth=0)
    ├── tool span (tool_name=Bash, skill.name=batch)
    ├── tool span (tool_name=Edit, skill.name=batch)
    └── skill span (skill.name=skill2, depth=1, parent=batch)
        └── tool span (tool_name=Bash, skill.name=skill2)
```

---

## 与原生 OTel 的关系

| 数据类型 | 原生 OTel | Relay OTel |
|---------|----------|------------|
| LLM Request | ✅ | ❌ |
| Token/Cost | ✅ | ❌ |
| Tool Call | ✅ | ❌ |
| Skill 名称 | ✅ (仅直接调用) | ✅ (完整调用链) |
| Skill 树形结构 | ❌ | ✅ |
| Skill 嵌套深度 | ❌ | ✅ |
| Skill 调用耗时 | ❌ | ✅ |

---

## 配置建议

### 方式 1：自动读取 Claude Code 环境变量（推荐）

Relay 自动读取 Claude Code 的 OTel 环境变量，无需额外配置：

```bash
# Claude Code 环境变量（Claude Code 官方配置）
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer xxx"

# Claude Code 往 http://collector:4317 发送原生数据
# Relay 也往 http://collector:4317 发送 Skill 树形数据
# 两者自动对齐，用户无感知
```

### 方式 2：Relay 独立配置

```bash
# 显式指定 Relay 的 OTel 端点
relay --otel-endpoint=http://collector:4317 --otel-enabled

# 可以覆盖 Claude Code 的配置
```

### 读取的环境变量

| 环境变量 | 说明 | Claude Code 原生使用 |
|---------|------|---------------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel 端点 | ✅ |
| `OTEL_EXPORTER_OTLP_HEADERS` | OTel 请求头 | ✅ |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | 协议 (grpc/http) | ✅ |
| `OTEL_SERVICE_NAME` | 服务名 | ✅ |
| `OTEL_RESOURCE_ATTRIBUTES` | 资源属性 | ✅ |

### 实现逻辑

```typescript
// Relay 读取 Claude Code 的 OTel 配置
const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
                     'http://localhost:4317'

const otelHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS || ''

// 使用相同的端点和认证信息发送 Skill Span
const otelExporter = new OTLPSpanExporter({
  url: `${otelEndpoint}/v1/traces`,
  headers: parseHeaders(otelHeaders),
})
```

---

## 实际测试

### 已验证：通过 context.with() 建立 Span 父子关系

```typescript
// 创建 Root Skill Span
const skill1Span = tracer.startSpan('claude_code.skill', {
  attributes: { 'skill.name': 'batch', 'skill.depth': 0 }
})

// 设置为当前上下文
const ctx = trace.setSpan(context.active(), skill1Span)

await context.with(ctx, async () => {
  // Tool 自动成为 skill1 的子 span
  const tool1 = tracer.startSpan('claude_code.tool', {...})
  tool1.end()
  
  // 子 Skill 也自动成为 skill1 的子 span
  const skill2Span = tracer.startSpan('claude_code.skill', {
    attributes: { 'skill.name': 'skill2', 'skill.depth': 1 }
  })
  // skill2 的工具会成为 skill2 的子 span
})

skill1Span.end()
```

### 测试结果（Console Span 输出）

```json
{
  "name": "claude_code.skill",
  "id": "fd56ecf077605226",
  "attributes": {
    "span.type": "skill",
    "skill.name": "batch",
    "skill.invocation_id": "skill1-uuid",
    "skill.depth": 0
  },
  "parentSpanContext": undefined  // Root span
}
{
  "name": "claude_code.tool",
  "id": "62d0f3a510f29eb4",
  "parentSpanContext": {
    "spanId": "fd56ecf077605226"  // parent = batch span
  }
}
{
  "name": "claude_code.skill",
  "id": "785c97bb83e7c712",
  "attributes": {
    "skill.name": "skill2",
    "skill.parent_invocation_id": "skill1-uuid",
    "skill.depth": 1
  },
  "parentSpanContext": {
    "spanId": "fd56ecf077605226"  // parent = batch span
  }
}
```

### 关键发现

1. **父子关系自动建立**：`context.with(ctx, fn)` 让 fn 内创建的 span 自动成为 ctx span 的子 span
2. **parentSpanContext** 显示父 span id
3. **skill.parent_invocation_id** 作为额外属性关联 Skill 链

---

## 待实现

- [x] 研究 OTel SDK TypeScript 接口（已完成测试）
- [x] 实现 Skill Span 创建逻辑（已验证可行）
- [x] 实现 parent-child 关系维护（通过 context.with()）
- [ ] 实现 Event Log 格式输出
- [ ] 测试与原生 OTel 的兼容性（需要 OTel Collector）
- [ ] 实现 OTLP 导出到远程 Collector
