# Skill Tree 测试语义解析

本文档说明每个测试用例验证的语义逻辑，以及对应的实际意义。

---

## 测试环境

- 测试框架：Vitest
- 测试入口：`tests/skill-tree.test.ts`
- 测试流程：启动本地 relay → 执行 `claude -p "<command>"` → 等待 session 完成 → 验证 skill tree 结构

---

## Console Forwarder 输出格式

relay 启动后，每个 session 结束时打印完整的执行摘要：

```
📋 Session abc123… · 10000ms
────────────────────────────────────────────────────────────
🤖 weather-checker 10000ms
└── 🔧 Bash echo 'Weather check: ' && date +100ms
────────────────────────────────────────────────────────────
📊 Tokens  in=1200, out=340 cache=9800
📌 Reason  end_turn
────────────────────────────────────────────────────────────
```

- `📋 Session` 行：session ID（截断）+ 总耗时
- `🤖` = skill 节点，`🔧` = tool 节点
- `└──` = 最后一项，`├──` = 非最后一项
- `📊 Tokens` 行：总 token 消耗（各层级汇总）
- `❌ Failures` 节：记录所有失败的 tool/skill 调用及错误信息

---

## 测试用例解析

### 1. weather-checker: should have correct structure with Bash command

**命令：** `run weather-checker`

**语义：** 调用一个 skill，该 skill 内部执行了一个 Bash 工具调用。

**Console 输出：**

```
📋 Session abc123… · 10000ms
────────────────────────────────────────────────────────────
🤖 weather-checker 10000ms
└── 🔧 Bash echo 'Weather check: ' && date +100ms
────────────────────────────────────────────────────────────
📊 Tokens  in=1200, out=340 cache=9800
📌 Reason  end_turn
────────────────────────────────────────────────────────────
```

**Transcript：**

```
TOOL_USE: Bash echo 'Weather check: ' && date
TOOL_RET: Weather check: Fri May  1 12:00:00 CST 2026
```

**验证点：**
- `skillTree.skill === 'weather-checker'`
- `nestedCalls` 包含 `type: 'tool', name: 'Bash'`，`command` 包含 `'date'`

**实际意义：** 验证 relay 能正确捕获 skill 的根节点信息，以及该 skill 直接调用的工具（不是子 skill）。

---

### 2. nested-test-skill: should have nested weather-checker skill

**命令：** `run nested-test-skill`

**语义：** 父 skill（A）调用了另一个子 skill（B），子 skill 内部有自己的工具调用。

**Console 输出：**

```
📋 Session def456… · 20000ms
────────────────────────────────────────────────────────────
🤖 nested-test-skill 20000ms
└── 🤖 weather-checker 12000ms (1 calls)
    └── 🔧 Bash echo 'Weather check: ' && date +100ms
────────────────────────────────────────────────────────────
📊 Tokens  in=2100, out=340 cache=18000
📌 Reason  end_turn
────────────────────────────────────────────────────────────
```

**Transcript：**

```
TOOL_USE: Skill {skill: 'weather-checker'}
TOOL_USE: Bash echo 'Weather check: ' && date
TOOL_RET: Weather check: Fri May  1 12:00:00 CST 2026
TOOL_RET: skill complete
```

**验证点：**
- `nestedCalls` 中存在 `type: 'skill'` 节点，name 为 `'weather-checker'`
- 该子 skill 节点下还有 `type: 'tool', name: 'Bash'` 的嵌套调用

**实际意义：** 验证嵌套调用链（A → B → tool）的完整性和正确归属性。子 skill 的工具调用不会被错误地挂到父 skill 下。

---

### 3. level-3-skill: should build a nested skill tree

**命令：** `run level-3-skill`

**语义：** 三层深的 skill 调用链（A → B → C），验证多层嵌套的能力。

**Console 输出：**

```
📋 Session ghi789… · 30000ms
────────────────────────────────────────────────────────────
🤖 level-3-skill 30000ms
└── 🤖 mid-skill 22000ms (1 calls)
    └── 🤖 leaf-skill 15000ms (1 calls)
        └── 🔧 Bash echo 'deep' +50ms
────────────────────────────────────────────────────────────
📊 Tokens  in=3200, out=450 cache=25000
📌 Reason  end_turn
────────────────────────────────────────────────────────────
```

**Transcript：**

```
TOOL_USE: Skill {skill: 'mid-skill'}
TOOL_USE: Skill {skill: 'leaf-skill'}
TOOL_USE: Bash echo 'deep'
TOOL_RET: deep
TOOL_RET: skill complete
TOOL_RET: skill complete
```

**验证点：**
- `nestedCalls.length > 0`
- `nestedCalls` 中至少有一个 `type: 'skill'` 节点

**实际意义：** 验证 relay 能处理深度嵌套场景，不会因嵌套层数多而丢失节点或崩溃。

---

### 4. parent-skill: should track skill loaded from nested scripts/ directory

**命令：** `run parent-skill`

**语义：** 子 skill（`scripts/child-skill/`）不在顶级 skills 目录中，只有 parent-skill 调用它时才被加载。调用会失败，但 parent 仍能继续执行。

**Console 输出：**

```
📋 Session jkl012… · 15000ms
────────────────────────────────────────────────────────────
🤖 parent-skill 15000ms
├── 🤖 scripts/child-skill 2000ms (1 calls)
└── 🔧 Bash echo 'parent-skill: child has returned' +50ms
────────────────────────────────────────────────────────────
📊 Tokens  in=1800, out=300 cache=15000
📌 Reason  end_turn
❌ Failures (1)
   ✗ child-skill [scripts/child-skill]: Unknown skill
────────────────────────────────────────────────────────────
```

**Transcript：**

```
TOOL_USE: Skill {skill: 'child-skill'}
TOOL_RET: <error> Unknown skill
TOOL_USE: Bash echo 'parent-skill: child has returned'
TOOL_RET: parent-skill: child has returned
```

**验证点：**
- `nestedCalls` 中存在子 skill 节点，name 匹配 `child-skill`
- `success === false`，`error` 有定义
- parent 的 `echo 'parent-skill: child has returned'` 被正确归到 parent 下，而非失败子 skill 下

**实际意义：** 验证两个关键行为：
1. relay 能发现并加载嵌套目录结构中的 skill（`scripts/` 子目录）
2. **失败 skill 立即弹出**：子 skill 失败后，parent 的后续工具调用不会错误地挂在子 skill 树下

---

### 5. sequential-skill: should call weather-checker twice as sibling skills

**命令：** `run sequential-skill`

**语义：** 同一个父 skill 顺序调用同一个子 skill 两次，两次调用是兄弟节点关系。

**Console 输出：**

```
📋 Session mno345… · 25000ms
────────────────────────────────────────────────────────────
🤖 sequential-skill 25000ms
├── 🤖 weather-checker 8000ms (1 calls)
│   └── 🔧 Bash echo 'Weather check: ' && date +100ms
└── 🤖 weather-checker 10000ms (1 calls)
    └── 🔧 Bash echo done +50ms
────────────────────────────────────────────────────────────
📊 Tokens  in=3200, out=680 cache=26000
📌 Reason  end_turn
────────────────────────────────────────────────────────────
```

**Transcript：**

```
TOOL_USE: Skill {skill: 'weather-checker'}    ← 第一次调用
TOOL_USE: Bash echo 'Weather check: ' && date
TOOL_RET: Weather check: ...
TOOL_RET: skill complete
TOOL_USE: Skill {skill: 'weather-checker'}    ← 第二次调用（兄弟节点）
TOOL_USE: Bash echo done
TOOL_RET: done
TOOL_RET: skill complete
```

**验证点：**
- `nestedCalls` 中至少有两个 `type: 'skill'` 节点
- 第二个 `weather-checker` 的 `nestedCalls` 中有 `command` 包含 `'done'` 的 Bash

**实际意义：** 验证 relay 能区分同一 skill 的多次调用（每次都有独立的 `toolUseId`），并且 sibling 之间的嵌套归属正确。

---

### 6. weather-checker: should have token usage on root skill

**命令：** `run weather-checker`

**语义：** API 真实调用，有 token 消耗。

**验证点：**
- `skillTree.usage` 存在
- `inputTokens > 100`，`outputTokens > 10`，`cacheReadTokens > 0`

**实际意义：** 验证 token 用量统计的完整性，缓存读取被正确计入成本。

---

### 7. nested-test-skill: should have token usage on both parent and nested skill

**命令：** `run nested-test-skill`

**语义：** 父 skill 和子 skill 都有独立的 API 调用，各自消耗 token。

**验证点：**
- 父 skill（root）有 `usage`，`inputTokens > 100`，`cacheReadTokens > 0`
- 子 skill（`weather-checker`）也有 `usage`，且数值合理

**实际意义：** 验证 token 用量按 skill 层级分开统计，而非混在一起。嵌套调用的 token 归属清晰。

---

### 8. bare-tools: should capture tool calls without any skill

**命令：** `list all files in /tmp`

**语义：** 纯工具调用，不走任何 skill。

**Console 输出：**

```
📋 Session pqr678… · 5000ms
────────────────────────────────────────────────────────────
🤖 <no-skill> 5000ms
├── 🔧 Bash ls -la /tmp +200ms
└── 🔧 Read /tmp +300ms
────────────────────────────────────────────────────────────
📊 Tokens  in=600, out=180 cache=2000
📌 Reason  end_turn
────────────────────────────────────────────────────────────
```

**Transcript：**

```
TOOL_USE: Bash ls -la /tmp
TOOL_RET: total 48 ...
TOOL_USE: Read
TOOL_RET: ...
```

**验证点：**
- 生成一个 `skill: '<no-skill>'` 的根节点
- `nestedCalls.length > 0` — 工具调用被正确挂在该兜底根下

**实际意义：** 验证 relay 在无 skill 场景下有兜底处理，不会丢失工具调用数据。

---

## 测试结果语义总览

| # | 测试名 | 核心语义 |
|---|--------|----------|
| 1 | weather-checker (basic) | 单层 skill + 工具调用 |
| 2 | nested-test-skill | 二层嵌套 skill |
| 3 | level-3-skill | 多层深度嵌套 |
| 4 | parent-skill (scripts/) | 嵌套目录加载 + 失败弹出 |
| 5 | sequential-skill | 同级多次调用区分 |
| 6 | token usage (root) | Token 统计完整性 |
| 7 | token usage (nested) | 分层 token 归属 |
| 8 | bare-tools | 无 skill 场景兜底 |
