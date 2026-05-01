# Skill Discovery & Loading Trace — v1.0.0

## 1. 背景

当前 `SkillCallNode` 在 transcript 分析后只记录了 `name`（skill 名称），但无法区分：
- skill 是从顶层 `~/.claude/skills/` 目录加载的
- skill 是从父 skill 的嵌套目录（如 `parent-skill/scripts/child-skill/`）加载的

更关键的是：当一次嵌套 skill 调用失败时（如 "Unknown skill: child-skill"），当前的 `SkillCallNode` 没有记录错误信息，也没有记录失败后触发的文件系统探查行为（Glob/Bash/Read）。

这些信息的缺失导致无法分析 skill 加载的真实行为路径，也无法识别"嵌套路径注入式加载"和"顶层 skill 查找"之间的区别。

## 2. 目标

增强 `SkillCallNode` 的数据采集，使其能够：

1. **记录 skill 调用的成功/失败状态及错误信息**
2. **识别 skill 调用后紧接的文件系统探查行为（Glob/Bash/Read）**
3. **推断 skill 是否从嵌套路径加载（loadedFromNestedPath 标记）**

目标衡量：
- 每次失败的 skill 调用，对应 `SkillCallNode.error` 有值
- 每次嵌套路径 skill 调用，`SkillCallNode.discoveryCalls` 包含探查工具调用
- `loadedFromNestedPath` 推断准确率 > 90%（以 transcript 中的路径证据为 ground truth）

## 3. 范围

**包含：**
- 修改 `src/types.ts`：在 `SkillCallNode` 新增字段
- 修改 `src/transcript.ts`：`analyzeNestedCalls` 新增错误提取和 discovery 调用检测逻辑
- 修改 `src/collector.ts`：在 `PreToolUse:Skill` / `PostToolUse:Skill` 时提取更多信息

**不包含：**
- 不修改 hook 接口（不影响外部 hook 契约）
- 不修改 ForwardPayload 结构（skillTree 的 skillCallNode 内部扩展，API 兼容）
- 不做实时的 skill 路径解析（只依赖 transcript 内已有的证据做推断）

## 4. 方案

### 4.1 SkillCallNode 字段扩展

```typescript
// src/types.ts

export interface SkillCallNode {
  type: 'skill';
  name: string;
  toolUseId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  nestedCalls: CallNode[];
  usage?: ModelUsage;

  // 新增字段
  success: boolean;                    // 此次 skill 调用是否成功
  error?: string;                     // 错误信息（如 "Unknown skill: xxx"）
  discoveryCalls: ToolCallNode[];      // 紧接的路径探查调用（Glob/Read/Bash）
  loadedFromNestedPath: boolean;       // 是否从嵌套目录加载的推断
}
```

### 4.2 transcript.ts 分析逻辑改造

#### 4.2.1 错误信息提取

Skill 工具的 `tool_result` 里可能包含 `<tool_use_error>...</tool_use_error>` 包装的错误信息。

从 `tool_result.content` 中提取：
- 如果包含 `<tool_use_error>`，提取其内容作为 `error`
- 提取后从 `content` 字符串中剔除该标签（保留其他正常返回内容）

#### 4.2.2 Discovery 调用检测

在 skill 调用后的紧邻 assistant turn 中，检测所有 tool_use：

- `Glob` — 如果 `input.pattern` 包含 skill 名称（如 `child-skill`）
- `Read` — 如果 `input.file_path` 指向 skills 目录或嵌套子目录
- `Bash` — 如果 `input.command` 包含 `ls`、`find` 等路径探查命令，且路径包含父 skill 目录

这些工具调用**不**作为子节点加入 skill 的 `nestedCalls`，而是加入 `discoveryCalls`（因为它们是 skill 加载过程的一部分，不是 skill 执行的一部分）。

#### 4.2.3 loadedFromNestedPath 推断规则

满足以下任一条件则 `loadedFromNestedPath = true`：

1. skill 调用紧接了 Glob/Read/Bash 探查调用，且探查路径包含父 skill 目录
2. skill 调用成功，且对应 transcript 的 `isMeta: true` 的 user entry 中 `Base directory` 路径包含父 skill 的 scripts/ 子目录

### 4.3 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| Skill 调用后无 tool_result（异常退出） | `success = false`，`error = "No tool result"` |
| Skill 调用成功但无探查调用 | `loadedFromNestedPath = false` |
| 探查调用出现在 skill 调用之后超过 2 个 assistant turn | 不关联，只追踪紧邻的 |
| 嵌套 skill 调用成功（正常路径） | 探查调用可能不存在，正常构建树即可 |

## 5. 任务拆解

- [ ] **T1**: 修改 `src/types.ts`，在 `SkillCallNode` 新增 `success`、`error`、`discoveryCalls`、`loadedFromNestedPath` 字段
- [ ] **T2**: 修改 `src/transcript.ts` `analyzeNestedCalls`，新增错误提取逻辑，解析 `<tool_use_error>` 标签
- [ ] **T3**: 在 `analyzeNestedCalls` 中新增 discovery 调用检测，当 skill 调用后的紧接 assistant turn 中出现 Glob/Read/Bash 探查时，关联到 `discoveryCalls`
- [ ] **T4**: 实现 `loadedFromNestedPath` 推断逻辑（基于 discovery 调用路径 或 Base directory meta）
- [ ] **T5**: 新增测试用例：失败的嵌套 skill 调用（parent-skill + child-skill 权限受限场景）
- [ ] **T6**: 新增测试用例：成功的嵌套 skill 调用（确保 success=true 时探查调用为空）
- [ ] **T7**: 验证现有 8 个测试仍然通过

## 6. 测试验证

### 6.1 单元测试场景

**场景 A：嵌套 skill 调用失败**
- 输入：parent-skill 调用 child-skill，child-skill 触发 "Unknown skill" 错误
- 期望：`success=false`，`error="Unknown skill: child-skill"`，`discoveryCalls` 包含 Glob 和 Bash

**场景 B：嵌套 skill 调用成功**
- 输入：parent-skill 调用 child-skill，child-skill 正常执行
- 期望：`success=true`，`error=undefined`，`loadedFromNestedPath=true`

**场景 C：顶层 skill 调用**
- 输入：直接调用 `weather-checker`
- 期望：`success=true`，`loadedFromNestedPath=false`

### 6.2 验证方法

```bash
cd /home/aqiu/.openclaw/workspace/claude-agent-hook-relay
npm test -- --run
# 期望：所有 8 个现有测试 + 新增 2 个测试 = 10 个测试通过
```

## 7. 成功标准

1. 现有 8 个测试全部通过
2. 新增的 2 个测试（失败路径、成功嵌套路径）全部通过
3. 失败的 skill 调用，`SkillCallNode.error` 包含错误信息字符串
4. `loadedFromNestedPath` 在有探查调用或 Base directory 证据时为 `true`
5. `discoveryCalls` 数组中的工具调用与 skill 调用在 transcript 中相邻（间隔 ≤ 2 个 assistant turn）
