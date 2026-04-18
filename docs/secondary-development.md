# 二次开发与扩展

Relay 作为 Hook 事件的收集层和转发管道，提供了二次开发的基础设施。以下是可以在 relay 基础上开发的扩展功能。

---

## 二次开发功能清单

### 1. 实时告警

**场景**：Skill 执行超时、高频调用、异常检测

**示例**：
```typescript
// Skill 执行超时检测
if (skill.durationMs > 30000) {
  sendAlert({
    type: 'skill_timeout',
    skill: skill.name,
    duration: skill.durationMs,
    threshold: 30000,
    sessionId
  })
}
```

**触发条件**：
- Skill 执行时间超过阈值
- 工具调用失败率异常
- 特定 Skill 被频繁调用

---

### 2. 访问控制

**场景**：阻断危险命令、白名单控制

**示例**：
```typescript
// 阻断危险命令
if (tool_name === 'Bash' && command.includes('rm -rf /')) {
  return {
    hookSpecificOutput: {
      permissionDecision: 'deny',
      reason: 'Dangerous command blocked'
    }
  }
}
```

**触发条件**：
- 工具名称或参数匹配危险模式
- Skill 不在白名单中
- 用户权限不足

---

### 3. 审计日志

**场景**：持久化操作记录到数据库

**示例**：
```typescript
// 记录到数据库
await db.insert('audit_log', {
  sessionId,
  sourceId,          // X-Source-ID 标识终端
  userId,
  timestamp: new Date(),
  skill: skill.name,
  nestedTools: skill.nestedCalls,
  skillDuration: skill.durationMs,
  children: skill.children,
  stopReason
})
```

**可记录内容**：
- 谁（userId、sourceId）
- 什么时候（timestamp）
- 做了什么（skill、nestedCalls）
- 结果如何（duration、success）

---

### 4. 聚合计算

**场景**：按 Skill、用户、终端维度聚合

**示例**：
```typescript
// 聚合统计
const stats = {
  skill: 'batch',
  totalInvocations: 100,
  avgDuration: 5000,
  totalToolCalls: 450,
  bySource: {
    'workstation-1': 60,
    'workstation-2': 40
  },
  byHour: {
    '09:00': 20,
    '10:00': 35,
    '11:00': 45
  }
}
```

---

### 5. 数据转发

**场景**：转换为其他格式或发送到其他系统

**示例**：
```typescript
// Kafka 转发
class KafkaForwarder implements Forwarder {
  async forward(data: ForwardPayload) {
    await producer.send({
      topic: 'claude-code-events',
      messages: [{
        key: data.sessionId,
        value: JSON.stringify(data)
      }]
    })
  }
}
```

**可转发到**：
- Kafka（事件流）
- WebSocket（实时推送）
- Database（持久化）
- Slack/飞书（告警通知）

---

## 不适合在 relay 中做的

| 功能 | 原因 | 推荐方案 |
|------|------|---------|
| A/B Testing 决策 | relay 是收集层，不是决策引擎 | Skill 平台或包装器 Skill |
| 业务逻辑 | 耦合业务，不适合通用层 | 独立服务 |
| 复杂计算 | 影响性能 | 异步处理 |

---

## A/B Testing Skill 包装器设计（待细化）

### 背景

想对 Claude Code 默认的 Skill Tool 做扩展，在保留基础功能（加载、执行）的同时，增加请求路由能力。

### 核心思路

```
Claude Code Skill Tool
├── 基础功能（保留）
│   └── 加载 Skill 内容、执行工具调用
│
└── 扩展功能（新增）
    └── 请求路由（A/B Testing、灰度发布、实验分组）
```

### 技术路径

#### 路径 1：Hook 拦截（轻量）

```typescript
// PreToolUse Hook
if (tool_name === 'Skill') {
  const { skill, args } = tool_input
  
  // Skill Router 决定版本
  const version = routeSkill({
    skill,
    args,
    sessionId,
    userId
  })
  
  return {
    hookSpecificOutput: {
      updatedInput: {
        skill: `${skill}:${version}`,
        args
      }
    }
  }
}
```

#### 路径 2：包装器 Skill（可配置）

```
用户调用 /batch
    ↓
Skill "ab-testing" (包装器)
    ↓
读取路由配置
    ↓
决定执行 batch:v1 还是 batch:v2
    ↓
返回结果
```

### 待设计问题

- [ ] 路由配置存在哪（YAML/DB/远程服务）
- [ ] 如何识别版本（`skill:version` 命名约定？）
- [ ] session sticky 策略
- [ ] 数据收集机制
- [ ] 灰度策略（百分比、用户群、白名单）
- [ ] Skill Tool 加载时的扩展点在哪里

### 与 relay 的关系

| 组件 | 职责 |
|------|------|
| **Skill Tool 扩展** | 决定调用哪个版本（决策逻辑） |
| **relay** | 收集调用结果，记录哪个版本被调用 |

---

## 扩展开发指南

### 创建自定义转发器

```typescript
import { Forwarder, ForwardPayload } from './types'

class MyForwarder implements Forwarder {
  constructor(private config: MyConfig) {}

  async forward(data: ForwardPayload): Promise<void> {
    // 实现转发逻辑
  }
}

// 在 CompositeForwarder 中使用
const forwarder = new CompositeForwarder([
  new ConsoleForwarder(),
  new MyForwarder(config)
])
```

### 创建自定义 Hook 处理器

```typescript
// 扩展 Collector 处理逻辑
class ExtendedCollector extends Collector {
  processPreToolUse(event: PreToolUseEvent) {
    super.processPreToolUse(event)
    
    // 添加自定义逻辑
    this.checkAccessControl(event)
    this.recordMetrics(event)
  }
}
```

---

## 下一步

- [ ] 确定路由配置存储方案
- [ ] 设计版本识别机制
- [ ] 实现第一个扩展功能（建议：审计日志）
- [ ] 完善 A/B Testing 包装器设计
