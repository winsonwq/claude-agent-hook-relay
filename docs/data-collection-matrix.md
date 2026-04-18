# Claude Code 可观测性数据矩阵

## 概述

Claude Code 提供两种数据收集机制：

| 机制 | 说明 |
|------|------|
| **HTTP Hook** | 回调函数，可实时拦截、修改、阻断操作 |
| **原生 OpenTelemetry** | 标准化的遥测导出，面向 metrics/traces/logs |

两者数据覆盖存在**交集**，但各有**独有能力**。

---

## 完整数据矩阵

### 分类：工具调用

| 数据项 | HTTP Hook | 原生 OTel | 说明 |
|--------|:---------:|:----------:|------|
| PreToolUse 事件 | ✅ | ❌ | 工具调用前（Hook 独有） |
| PostToolUse 事件 | ✅ | ❌ | 工具调用后（Hook 独有） |
| PostToolUseFailure 事件 | ✅ | ❌ | 工具调用失败（Hook 独有） |
| 工具名称 (tool_name) | ✅ | ✅ | |
| 工具输入 (tool_input) | ✅ | ⚠️ 需 OTEL_LOG_TOOL_DETAILS=1 | |
| 工具输出 (tool_output) | ✅ | ⚠️ 需 OTEL_LOG_TOOL_CONTENT=1 | |
| 工具执行耗时 | ✅ 手动计算 | ✅ | |
| 工具调用 ID (tool_use_id) | ✅ | ✅ | 关联 Pre/Post |
| 嵌套深度 (query_depth) | ✅ | ❌ | **Hook 独有** |

### 分类：Skill 相关

| 数据项 | HTTP Hook | 原生 OTel | 说明 |
|--------|:---------:|:----------:|------|
| Skill 调用 (tool_name="Skill") | ✅ | ✅ | |
| Skill 名称 | ✅ | ✅ | tool_input.skill |
| Skill 参数 | ✅ | ⚠️ | tool_input.args |
| **Skill 触发链** | ✅ | ❌ | **Hook 独有** |
| **Skill 嵌套调用链** | ✅ | ❌ | **树形结构**：Skill1 → Skill2 → Tool，支持递归嵌套 |
| **Skill 子树聚合统计** | ✅ | ❌ | totalDuration、totalToolCalls、totalTokenUsage **Hook 独有** |
| Skill 执行耗时 | ✅ | ❌ | **Hook 独有** |

### 分类：API / Model

| 数据项 | HTTP Hook | 原生 OTel | 说明 |
|--------|:---------:|:----------:|------|
| 输入 Token 数 | ❌ | ✅ | |
| 输出 Token 数 | ❌ | ✅ | |
| Cache 读取 Token | ❌ | ✅ | |
| Cache 创建 Token | ❌ | ✅ | |
| API 请求耗时 | ❌ | ✅ | |
| API 错误 | ❌ | ✅ | |
| Model 名称 | ❌ | ✅ | |
| Cost USD | ❌ | ✅ | |
| LLM Request Span | ❌ | ✅ | claude_code.llm_request |

### 分类：Session

| 数据项 | HTTP Hook | 原生 OTel | 说明 |
|--------|:---------:|:----------:|------|
| SessionStart 事件 | ✅ | ✅ | |
| SessionEnd 事件 | ✅ | ✅ | |
| Session ID | ✅ | ✅ | |
| Session 时长 | ✅ | ✅ | 可计算 |
| 停止原因 (stop_reason) | ✅ | ❌ | |

### 分类：Subagent / Task

| 数据项 | HTTP Hook | 原生 OTel | 说明 |
|--------|:---------:|:----------:|------|
| SubagentStart 事件 | ✅ | ❌ | **Hook 独有** |
| SubagentStop 事件 | ✅ | ❌ | **Hook 独有** |
| TaskCreated 事件 | ✅ | ❌ | **Hook 独有** |
| TaskCompleted 事件 | ✅ | ❌ | **Hook 独有** |
| Subagent 类型 | ✅ | ❌ | **Hook 独有** |

### 分类：上下文 / 文件

| 数据项 | HTTP Hook | 原生 OTel | 说明 |
|--------|:---------:|:----------:|------|
| UserPromptSubmit 事件 | ✅ | ✅ | |
| CwdChanged 事件 | ✅ | ❌ | **Hook 独有** |
| FileChanged 事件 | ✅ | ❌ | **Hook 独有** |
| InstructionsLoaded 事件 | ✅ | ❌ | **Hook 独有** |

### 分类：权限

| 数据项 | HTTP Hook | 原生 OTel | 说明 |
|--------|:---------:|:----------:|------|
| PermissionRequest 事件 | ✅ | ❌ | **Hook 独有** |
| PermissionDenied 事件 | ✅ | ❌ | **Hook 独有** |

### 分类：Hook 系统

| 数据项 | HTTP Hook | 原生 OTel | 说明 |
|--------|:---------:|:----------:|------|
| Hook 执行 Span | ❌ | ✅ | claude_code.hook |
| Hook 输入 | ✅ | ❌ | **Hook 独有** |
| Hook 输出 | ✅ | ❌ | **Hook 独有** |

### 分类：其他

| 数据项 | HTTP Hook | 原生 OTel | 说明 |
|--------|:---------:|:----------:|------|
| ConfigChange 事件 | ✅ | ❌ | **Hook 独有** |
| WorktreeCreate 事件 | ✅ | ❌ | **Hook 独有** |
| WorktreeRemove 事件 | ✅ | ❌ | **Hook 独有** |
| Notification 事件 | ✅ | ❌ | **Hook 独有** |
| TeammateIdle 事件 | ✅ | ❌ | **Hook 独有** |
| PreCompact 事件 | ✅ | ❌ | **Hook 独有** |
| PostCompact 事件 | ✅ | ❌ | **Hook 独有** |
| Elicitation 事件 | ✅ | ❌ | **Hook 独有** |
| ElicitationResult 事件 | ✅ | ❌ | **Hook 独有** |
| Pull Request 计数 | ❌ | ✅ | |
| Commit 计数 | ❌ | ✅ | |
| 代码行数变化 | ❌ | ✅ | |

---

## 数据能力汇总

| 能力 | HTTP Hook | 原生 OTel | 独有性 |
|------|:---------:|:----------:|--------|
| **实时性** | ✅ 实时回调 | ⚠️ 批量导出（5-60s 间隔） | Hook 优势 |
| **可修改/阻断** | ✅ | ❌ | Hook 独有 |
| **Skill 触发链追踪** | ✅ | ❌ | **Hook 独有** |
| **嵌套深度追踪** | ✅ | ❌ | **Hook 独有** |
| **API/Token/Cost** | ❌ | ✅ | OTel 独有 |
| **标准格式导出** | ❌ | ✅ | OTel 独有 |
| **生态集成** | ❌ | ✅ (Grafana, Datadog...) | OTel 独有 |

---

## 架构关系

```
┌─────────────────────────────────────────────────────────────────┐
│                         Claude Code                              │
│                                                                  │
│   HTTP Hook ───────────────┐                                   │
│   (实时、可修改、调用链追踪)  │                                   │
│                              ▼                                   │
│                         relay (我们的服务)                        │
│                              │                                   │
│                              │ 转发                               │
│                              ▼                                   │
│                    ┌─────────────────┐                         │
│                    │  我们的日志系统   │                         │
│                    │  (独立存储)      │                         │
│                    └─────────────────┘                         │
│                                                                  │
│   原生 OTel ────────────────────────────────────────────────────→│
│   (标准格式、metrics/traces/logs)                              │
│                              │                                   │
│                              ▼                                   │
│                    ┌─────────────────┐                         │
│                    │  OTel Collector │                         │
│                    │  (Grafana/DD/...)│                         │
│                    └─────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 使用建议

| 需求场景 | 推荐方案 |
|---------|---------|
| 只需要看 metrics、cost、API 性能 | 原生 OTel |
| 需要**追踪 Skill 调用链**（谁触发了什么） | **HTTP Hook** |
| 需要**实时告警**（Skill 调用超时） | **HTTP Hook** |
| 需要**阻断/修改**工具调用 | **HTTP Hook** |
| 需要**历史数据分析**（Grafana 看板） | 原生 OTel |
| 需要**完整覆盖** | **两者都用** |

---

## 关键洞察

### 1. Skill 调用链追踪是 Hook 独有价值

原生 OTel 只记录**直接调用**的 Skill 名称，不记录**被 Skill 触发的子工具的 parent Skill**。

```typescript
// HTTP Hook 能追踪（树形结构）：
{
  skill: "skill1",
  nestedCalls: ["Tool1", "Tool2"],
  children: [
    { skill: "skill2", nestedCalls: ["Tool3"], children: [] }
  ]
}

// 原生 OTel 只能记录：
// - skill_name: "skill1"
// - tool_name: "Tool1"
// - tool_name: "Tool3"
// （但不知道 Tool1/Tool3 和 skill 的父子关系）
```

**支持的场景**：
- Skill A 调用 Tool1、Tool2
- Skill A 内部调用 Skill B
- Skill B 调用 Tool3
- Skill B 内部调用 Skill C
- Skill C 调用 Tool4

形成完整的树形调用链。

### 2. 两者互补而非竞争

- **HTTP Hook** = 实时处理 + 调用链 + 可干预
- **原生 OTel** = 历史数据 + 标准格式 + 生态集成

合并两者使用可以获得完整的可观测性。

### 3. 建议配置

```bash
# 开启原生 OTel（获取 API/Token/Cost 数据）
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317

# 同时配置 HTTP Hook（获取调用链、实时告警）
# 在 Claude Code settings.json 中配置 hooks
```
