# Token 统计逻辑

## 概述

claude-agent-hook-relay 通过分析 Claude Code 的 transcript 文件，实现按 skill 和按 tool 的 token 消耗统计。

## 数据来源

### Transcript 文件

Claude Code 的 transcript 保存在：
```
~/.claude/projects/<project-hash>/<session-id>.jsonl
```

每行是一个 JSON entry，主要类型：
- `user` — 用户消息
- `assistant` — Claude 回复，包含 `message.usage`（token 统计）
- `queue-operation` — 队列操作
- `last-prompt` — 最后一次 prompt
- `attachment` — 附件

### Token 字段

每个 `assistant` entry 的 `message.usage` 包含：

| 字段 | 说明 |
|------|------|
| `input_tokens` | 输入 token 数 |
| `output_tokens` | 输出 token 数 |
| `cache_read_input_tokens` | 缓存读取 token 数 |
| `cache_creation_input_tokens` | 缓存创建 token 数 |

## 核心算法：Deferred-Pop

### 问题背景

Claude Code 的 hook 事件在 skill 嵌套时不能准确反映执行顺序：

1. `PreToolUse(Skill)` — skill 调用**开始**时立即触发
2. `PostToolUse(Skill)` — skill 调用**完成**时立即触发（但此时 nested tools 还没执行）
3. nested tools 的 hook 事件在 PostToolUse(Skill) **之后**才触发

所以无法通过 hook 的实时序列来判断 skill 的真实调用栈。

### 解决方案

通过 transcript 的 `tool_use` / `tool_result` 配对来推断 skill 的执行窗口：

```
Transcript 中的模式：
- tool_use (type=tool_use, name=Skill) → "Launching skill: X"
- tool_result (type=tool_result, tool_use_id=X) → skill 执行结果
```

当遇到 Skill 的 `tool_result` 时，并不立即 pop skill 栈，而是标记为 `isDone=true`。等到下一个 skill 或 tool 被处理时，才 pop 掉所有已标记的 skill。

这确保了 skill 在其所有 nested calls 执行完之后才出栈。

## Token 归属算法

### 基本规则

**每条 assistant entry 的 token 归属于当前 skill 栈顶的 skill。**

**每条 assistant entry 的 token 归属于当前 skill 栈顶的 skill。**

当 Claude 执行一个 skill 时，可能产生多条 assistant 消息（多轮 tool 调用）。Transcript 按时间顺序记录，每条 `assistant` entry 都有自己的 `usage`。

在遍历 transcript 时维护一个 skill 栈，每当遇到一条 `assistant` entry，就将其 token 累加到栈顶 skill。

### 嵌套归属

```
skill A 开始
  skill B 开始
    tool X 执行  → token 归属 skill B
    tool Y 执行  → token 归属 skill B
  skill B 结束
  tool Z 执行  → token 归属 skill A
skill A 结束
```

**关键点：子 skill 的 token 只归属于子 skill 自身，父 skill 的 token 不包含子 skill 的消耗。**

### Token 随对话推进而增长的直观示例

以下是一次 `run nested-test-skill` 的 transcript 数据，展示了 token 如何随对话推进而增长：

```
 Entry      in      out   cache_read  事件
────────────────────────────────────────────────────
[  4]  in=  126   out=  53   cache=     0  (思考)
[  5]  in=  126   out=  53   cache=     0  Skill(nested-test-skill)
[ 11]  in=  126   out= 123   cache= 23408  (思考)
[ 13]  in=  126   out= 123   cache= 23408  Skill(weather-checker)
[ 21]  in=  126   out=  84   cache= 24257  Bash
[ 25]  in= 1585   out=  93   cache= 23408  (思考)
[ 27]  in= 1585   out=  93   cache= 23408  Bash
[ 31]  in= 1708   out=  78   cache= 23408  (思考)
[ 33]  in= 1708   out=  78   cache= 23408  Read
[ 42]  in= 2093   out= 277   cache= 23408  (思考)
```

**解读：**

- **in（inputTokens）持续增长**：126 → 1585 → 1708 → 2093。这是因为每次 API 调用的 context 越来越大：user prompt + conversation history + skill 内容。

- **cache_read 稳定在约 23408**：说明 Claude Code 已经建立了 KV 缓存，后续请求大量复用。

- **Token 归属规则**：每当 skill 被调用（`Skill(name)` 出现），下一个 assistant entry 的 usage 就归属到该 skill。例如：
  - entry 13 `Skill(weather-checker)` 后，usage 归属 weather-checker
  - entry 25 `in=1585` 时，context 里装的是 nested-test-skill 的内容，所以归属 nested-test-skill

**直观理解：** 哪个 skill 的内容在当前 API 请求的 context 里，token 就归属哪个 skill。skill 内容越多，in 越大。

### Session Total

Session 级别的 totalUsage 是所有 assistant entry 的 token 累加，等于所有 skill 的 token 之和加上 session 级别的 orchestration token（发动 skill 之前的决策消耗）。

### 验证公式

```
session_total = Σ(skill_i.usage) + orchestration_token

其中 orchestration_token 是根 skill 在发动任何 nested skill 之前的思考消耗。
```

实际验证（来自上面的 trace）：
```
nested-test-skill:   in=9166   (包含 orchestration + nested skill 委托前消耗)
weather-checker:     in=5133   (weather-checker 执行期间的消耗)
sum:                in=14299
session_total:       in=14551  (差值 252 是 root 级别 orchestration)
```

差值 `252` 是整个 session 里不属于任何 skill 的纯思考消耗（entry 4 等早期 entries）。

## 实现细节

### SkillTree 结构

```typescript
interface SkillTree {
  skill: string;           // 根 skill 名称
  toolUseId: string;
  startTime: number;
  nestedCalls: CallNode[];  // 子节点
  usage?: ModelUsage;       // 该 skill 的 token 消耗
}

interface SkillCallNode {
  type: 'skill';
  name: string;
  toolUseId: string;
  startTime: number;
  nestedCalls: CallNode[];
  usage?: ModelUsage;       // 累加所有 nested assistant entry 的 token
}

interface ToolCallNode {
  type: 'tool';
  name: string;
  toolUseId?: string;
  // ...tool-specific fields
  usage?: ModelUsage;       // 当前实现中 tool 粒度的 token 归属为预留字段
}
```

### analyzeNestedCalls 流程

1. **第一遍扫描**：遍历所有 `assistant` entry，建立 `tool_use_id → tool_info` 的映射表
2. **第二遍扫描**：按顺序处理 transcript entry
   - `assistant` entry → 把 `message.usage` 累加到 skill 栈顶
   - `tool_use` (name=Skill) → 创建 SkillCallNode，push 到栈
   - `tool_result` (skill) → 标记 skill 为 done，不立即 pop
   - `tool_use` (其他 tool) → pop 已标记的 skill，然后添加到当前 skill 的 nestedCalls
3. **返回**：根 skill 的 SkillTree（包含递归的 nestedCalls）

### 时间窗口

Transcript entry 有 `timestamp` 字段，但 skill 的 `startTime` 并不用于 token 归属（token 归属只看 transcript 的顺序，不看时间）。`startTime` 主要用于调试和展示。

## 与 Hook 事件的配合

### Stop vs SessionEnd

Claude Code 在每个 turn 结束时触发 `Stop` 事件，在整个 session 结束时触发 `SessionEnd` 事件。

| 事件 | transcriptPath | token 细分 | 触发次数 |
|------|----------------|-----------|---------|
| Stop | ✅ 有 | ✅ 有 | 每轮一次 |
| SessionEnd | ❌ 无 | ❌ 无（只有 total_cost_usd） | 整个 session 一次 |

### 缓存机制

relay 在 `Stop` 事件时从 transcript 计算出 skill tree 和 token 统计，缓存在 session 对象中。当 `SessionEnd` 事件到达时，直接使用缓存数据转发，避免被覆盖。

```typescript
// collector.ts
handleStop() {
  const skillTree = await TranscriptReader.analyzeNestedCalls(event.transcriptPath);
  session.cachedSkillTree = skillTree;
  session.cachedUsage = modelUsage;
  await forward(payload);  // 第一次转发
}

handleSessionEnd() {
  // 使用缓存数据，避免 SessionEnd 没有 transcriptPath 的问题
  payload.skillTree = session.cachedSkillTree ?? null;
  payload.totalUsage = session.cachedUsage ?? { inputTokens: 0, ... };
  await forward(payload);  // 第二次转发（SessionEnd 打印相同汇总，内容幂等）
}
```

## ConsoleForwarder 输出示例

```
────────────────────────────────────────────────────────────
📋 Session abc123… · 19171ms
🤖 nested-test-skill
  ├── 🤖 weather-checker (2 calls)
  │   ├── 🔧 Bash echo 'Weather check: ' && date
  │   └── 🔧 Bash date
  ├── 🔧 Bash date
  ├── 🔧 Read example.txt
  └── 🔧 Bash ls -la ...
────────────────────────────────────────────────────────────
📊 Tokens  in=16314, out=1513, cache=404343
📌 Reason  stop
────────────────────────────────────────────────────────────
```

输出分为两部分：
- **实时行**：每个 Tool 调用完成时立即打印一行（→ 开始，✓ 完成，✗ 失败），带时间戳
- **汇总摘要**：Session 结束时打印完整 Skill 树、Token 统计、停止原因

## 限制与已知问题

1. **Tool 粒度的 token 归属**：`ToolCallNode.usage` 字段已预留，但当前只归属到 skill 级别。Tool 级别的 token 需要更细粒度的 transcript 分析（按 tool_use → tool_result 之间的 assistant entry 累加）。

2. **缓存读取时机**：如果 Claude Code 在 Stop 之后、SessionEnd 之前崩溃，缓存数据可能不完整。但这种情况极其罕见。

3. **Token 时间窗口**：`cache_read_input_tokens` 是累积值，不是单轮值。如果多轮 session 共享缓存，cache token 会持续累积。这是 Claude Code / API 侧的行为，relay 只是如实记录。

4. **精度**：由于 token 归属是基于 transcript 顺序而非精确计时，同一 assistant entry 如果同时发起多个 skill 调用，token 会全部归属到最后一个（栈顶）。但实际测试中这种情况极少发生。
