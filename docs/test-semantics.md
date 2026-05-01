# Skill Tree 测试语义解析

本文档说明每个测试用例验证的语义逻辑，以及对应的实际意义。

---

## 测试环境

- 测试框架：Vitest
- 测试入口：`tests/skill-tree.test.ts`
- 测试流程：启动本地 relay → 执行 `claude -p "<command>"` → 等待 session 完成 → 验证 skill tree 结构

---

## API 响应结构

每个 session 的完整响应如下：

```json
{
  "sessionId": "01jx8xxxxx",
  "sourceId": "01jx8xxxxx",
  "skillTree": { ... },
  "transcriptPath": "/tmp/relay/transcripts/01jx8xxxxx.json",
  "createdAt": 1746081600000,
  "updatedAt": 1746081615000
}
```

### SkillTree 节点

```json
{
  "skill": "weather-checker",
  "toolUseId": "01jx8xxxxx",
  "startTime": 1746081600000,
  "endTime": 1746081615000,
  "durationMs": 15000,
  "nestedCalls": [ ... ],
  "usage": {
    "inputTokens": 1200,
    "outputTokens": 340,
    "cacheReadTokens": 9800,
    "cacheCreationTokens": 0,
    "costUsd": 0.00123
  }
}
```

### CallNode 节点

```json
{
  "type": "tool",
  "name": "Bash",
  "toolUseId": "01jx8yyyyy",
  "command": "echo 'Weather check: ' && date",
  "startTime": 1746081602000,
  "endTime": 1746081602100,
  "durationMs": 100
}
```

```json
{
  "type": "skill",
  "name": "weather-checker",
  "toolUseId": "01jx8zzzzz",
  "startTime": 1746081602000,
  "endTime": 1746081610000,
  "durationMs": 8000,
  "nestedCalls": [ ... ],
  "usage": {
    "inputTokens": 1100,
    "outputTokens": 280,
    "cacheReadTokens": 8900,
    "cacheCreationTokens": 0,
    "costUsd": 0.00109
  },
  "success": true
}
```

---

## 测试用例解析

### 1. weather-checker: should have correct structure with Bash command

**命令：** `run weather-checker`

**语义：** 调用一个 skill，该 skill 内部执行了一个 Bash 工具调用。

**验证点：**
- `skillTree.skill === 'weather-checker'` — 根节点 skill 名正确
- `nestedCalls` 包含至少一个 `type: 'tool', name: 'Bash'` 的节点
- 该 Bash 节点的 `command` 包含 `'date'`

**实际意义：** 验证 relay 能正确捕获 skill 的根节点信息，以及该 skill 直接调用的工具（不是子 skill）。

**示例输出：**

```json
{
  "skillTree": {
    "skill": "weather-checker",
    "toolUseId": "01jx8aaaaa",
    "startTime": 1746081600000,
    "endTime": 1746081610000,
    "durationMs": 10000,
    "nestedCalls": [
      {
        "type": "tool",
        "name": "Bash",
        "toolUseId": "01jx8bbbbb",
        "command": "echo 'Weather check: ' && date",
        "startTime": 1746081602000,
        "endTime": 1746081602100,
        "durationMs": 100
      }
    ],
    "usage": {
      "inputTokens": 1200,
      "outputTokens": 340,
      "cacheReadTokens": 9800,
      "cacheCreationTokens": 0,
      "costUsd": 0.00123
    }
  }
}
```

---

### 2. nested-test-skill: should have nested weather-checker skill

**命令：** `run nested-test-skill`

**语义：** 父 skill（A）调用了另一个子 skill（B），子 skill 内部有自己的工具调用。

**验证点：**
- `nestedCalls` 中存在 `type: 'skill'` 节点，name 为 `'weather-checker'`
- 该子 skill 节点下还有 `type: 'tool', name: 'Bash'` 的嵌套调用

**实际意义：** 验证嵌套调用链（A → B → tool）的完整性和正确归属性。子 skill 的工具调用不会被错误地挂到父 skill 下。

**示例输出：**

```json
{
  "skillTree": {
    "skill": "nested-test-skill",
    "toolUseId": "01jx8ccccc",
    "startTime": 1746081600000,
    "durationMs": 20000,
    "nestedCalls": [
      {
        "type": "skill",
        "name": "weather-checker",
        "toolUseId": "01jx8dddddd",
        "startTime": 1746081601000,
        "durationMs": 12000,
        "nestedCalls": [
          {
            "type": "tool",
            "name": "Bash",
            "toolUseId": "01jx8eeeee",
            "command": "echo 'Weather check: ' && date",
            "startTime": 1746081603000,
            "durationMs": 100
          }
        ],
        "usage": {
          "inputTokens": 1100,
          "outputTokens": 280,
          "cacheReadTokens": 8900,
          "cacheCreationTokens": 0,
          "costUsd": 0.00109
        }
      }
    ]
  }
}
```

---

### 3. level-3-skill: should build a nested skill tree

**命令：** `run level-3-skill`

**语义：** 三层深的 skill 调用链（A → B → C），验证多层嵌套的能力。

**验证点：**
- `nestedCalls.length > 0`
- `nestedCalls` 中至少有一个 `type: 'skill'` 节点

**实际意义：** 验证 relay 能处理深度嵌套场景，不会因嵌套层数多而丢失节点或崩溃。

**示例输出：**

```json
{
  "skillTree": {
    "skill": "level-3-skill",
    "toolUseId": "01jx8fffff",
    "startTime": 1746081600000,
    "durationMs": 30000,
    "nestedCalls": [
      {
        "type": "skill",
        "name": "mid-skill",
        "toolUseId": "01jx8ggggg",
        "startTime": 1746081601000,
        "durationMs": 22000,
        "nestedCalls": [
          {
            "type": "skill",
            "name": "leaf-skill",
            "toolUseId": "01jx8hhhhh",
            "startTime": 1746081605000,
            "durationMs": 15000,
            "nestedCalls": [
              {
                "type": "tool",
                "name": "Bash",
                "toolUseId": "01jx8iiiiii",
                "command": "echo 'deep'",
                "durationMs": 50
              }
            ]
          }
        ]
      }
    ]
  }
}
```

---

### 4. parent-skill: should track skill loaded from nested scripts/ directory

**命令：** `run parent-skill`

**语义：** 子 skill（`scripts/child-skill/`）不在顶级 skills 目录中，只有 parent-skill 调用它时才被加载。调用会失败，但 parent 仍能继续执行。

**验证点：**
- `nestedCalls` 中存在子 skill 节点，name 匹配 `child-skill`
- `success === false`，`error` 有定义 — 确认失败被正确捕获
- parent 的 `echo 'parent-skill: child has returned'` 被正确归到 parent 下，而非失败子 skill 下

**实际意义：** 验证两个关键行为：
1. relay 能发现并加载嵌套目录结构中的 skill（`scripts/` 子目录）
2. **失败 skill 立即弹出**：子 skill 失败后，parent 的后续工具调用不会错误地挂在子 skill 树下

**示例输出：**

```json
{
  "skillTree": {
    "skill": "parent-skill",
    "toolUseId": "01jx8jjjjj",
    "startTime": 1746081600000,
    "durationMs": 15000,
    "nestedCalls": [
      {
        "type": "skill",
        "name": "child-skill",
        "toolUseId": "01jx8kkkkk",
        "startTime": 1746081601000,
        "durationMs": 2000,
        "success": false,
        "error": "Unknown skill: child-skill",
        "nestedCalls": []
      },
      {
        "type": "tool",
        "name": "Bash",
        "toolUseId": "01jx8lllll",
        "command": "echo 'parent-skill: child has returned'",
        "startTime": 1746081604000,
        "durationMs": 50
      }
    ]
  }
}
```

---

### 5. sequential-skill: should call weather-checker twice as sibling skills

**命令：** `run sequential-skill`

**语义：** 同一个父 skill 顺序调用同一个子 skill 两次，两次调用是兄弟节点关系。

**验证点：**
- `nestedCalls` 中至少有两个 `type: 'skill'` 节点
- 第二个 `weather-checker` 的 `nestedCalls` 中有 `command` 包含 `'done'` 的 Bash

**实际意义：** 验证 relay 能区分同一 skill 的多次调用（每次都有独立的 `toolUseId`），并且 sibling 之间的嵌套归属正确。

**示例输出：**

```json
{
  "skillTree": {
    "skill": "sequential-skill",
    "toolUseId": "01jx8mmmmm",
    "startTime": 1746081600000,
    "durationMs": 25000,
    "nestedCalls": [
      {
        "type": "skill",
        "name": "weather-checker",
        "toolUseId": "01jx8nnnnn",
        "startTime": 1746081601000,
        "durationMs": 8000,
        "nestedCalls": [
          {
            "type": "tool",
            "name": "Bash",
            "toolUseId": "01jx8ooooo",
            "command": "echo 'Weather check: ' && date",
            "durationMs": 100
          }
        ]
      },
      {
        "type": "skill",
        "name": "weather-checker",
        "toolUseId": "01jx8ppppp",
        "startTime": 1746081610000,
        "durationMs": 10000,
        "nestedCalls": [
          {
            "type": "tool",
            "name": "Bash",
            "toolUseId": "01jx8qqqqq",
            "command": "echo done",
            "durationMs": 50
          }
        ]
      }
    ]
  }
}
```

---

### 6. weather-checker: should have token usage on root skill

**命令：** `run weather-checker`

**语义：** API 真实调用，有 token 消耗。

**验证点：**
- `skillTree.usage` 存在
- `inputTokens > 100` — 真实调用了 API
- `outputTokens > 10`
- `cacheReadTokens > 0` — 使用了缓存

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

**验证点：**
- 生成一个 `skill: '<no-skill>'` 的根节点
- `nestedCalls.length > 0` — 工具调用被正确挂在该兜底根下

**实际意义：** 验证 relay 在无 skill 场景下有兜底处理，不会丢失工具调用数据。

**示例输出：**

```json
{
  "skillTree": {
    "skill": "<no-skill>",
    "toolUseId": "01jx8rrrrr",
    "startTime": 1746081600000,
    "durationMs": 5000,
    "nestedCalls": [
      {
        "type": "tool",
        "name": "Bash",
        "toolUseId": "01jx8sssss",
        "command": "ls -la /tmp",
        "startTime": 1746081600100,
        "durationMs": 200
      },
      {
        "type": "tool",
        "name": "Read",
        "toolUseId": "01jx8ttttt",
        "file": "/tmp",
        "startTime": 1746081601000,
        "durationMs": 300
      }
    ]
  }
}
```

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
