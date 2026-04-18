# Claude Agent Hook Relay - 测试结果

## 测试时间
2026-04-18（初始测试）
2026-04-19（结构修复：打平 skills）

## 测试场景矩阵

| # | 场景 | 描述 | 期望 | 实际 | 状态 |
|---|------|------|------|------|------|
| 1 | 单层 Skill | 直接调用一个 skill | weather-checker: [Bash] | ✅ 正确 | ✅ PASS |
| 2 | 两层嵌套 | nested-test-skill → weather-checker | weather-checker: [Bash], nested-test-skill: [Skill, Bash, Read] | weather-checker: [Bash], nested-test-skill: [Bash, Read, Read] | ✅ PASS |
| 3 | 三层嵌套 | level-3-skill → level-2-skill → level-1-skill | 各层正确归因 | level-1: [Bash], level-2: [Bash], level-3: [Bash] | ✅ PASS |
| 4 | 连续调用同名 Skill | A → B → A（顺序调用两次 B） | B: 1x[Bash], A: 2x[Bash] | B: 1x[Bash], A: 1x[Bash] | ⚠️ PARTIAL |

## 算法说明

### Deferred-Pop 算法

核心逻辑：
1. Skill 调用 → push 到栈
2. 非 Skill 工具调用 → 归到栈顶 skill
3. 非 Skill 工具结果返回 → pending--
4. pending=0 时 → 标记 isDone=true（**不立即 pop**）
5. **下一个工具进来时**：先 pop done skills，再归因

关键洞察：
- Skill 返回 "Launching skill: X" 时，skill 刚启动还没真正执行完
- Skill 的脚本会继续执行后续命令
- 需要延迟 pop，等下一个工具进来才能确认上一个 skill 是否真的完成了

### 示例：两层嵌套

```
Entry 5 : PUSH nested-test-skill | stack: nested-test-skill
Entry 7 : SKILL result for nested-test-skill (Launching)
Entry 13 : PUSH weather-checker | stack: nested-test-skill -> weather-checker
Entry 15 : SKILL result for weather-checker (Launching)
Entry 20 : Bash -> weather-checker
Entry 22 : Bash result -> pending=0, isDone=true
Entry 26 : Bash -> pop done (weather-checker), then nested-test-skill ✅
```

## 已知限制

### 1. 连续调用场景的归因问题

当 skill A 顺序调用 skill B，然后继续执行自己的命令时，A 的命令可能被错误归到 B。

示例：sequential-skill 调用 weather-checker，然后执行 `echo "after-first-weather"`
- `echo "after-first-weather"` 被错误归到 weather-checker（应该归 sequential-skill）
- `echo "done"` 正确归到 sequential-skill

原因：weather-checker launching 后，sequential-skill 继续执行（skill launching 不阻塞外层 skill），但 weather-checker 还在栈上，导致 sequential-skill 的命令被归到 weather-checker。

这是 skill 执行模型和算法设计的根本冲突：**无法区分 skill launching 后、外层 skill 继续执行时的工具到底属于谁**。

### 2. 同名 Skill 多个实例无法区分

当同一个 skill 被调用多次时，nestedCalls 是按 skill name 聚合的，所有实例共享相同的数据。

示例：weather-checker 被调用两次
```
实际: weather-checker: [Bash, Bash] (两次调用共享)
期望: weather-checker-instance-1: [Bash], weather-checker-instance-2: [Bash]
```

### 3. Skill 调用本身不计入 nestedCalls

当 skill A 调用 skill B 时，"Skill" 这个工具调用不计入 A 的 nestedCalls。

```
期望 nested-test-skill: [Skill, Bash, Read]
实际 nested-test-skill: [Bash, Read]
```

原因：算法把 Skill 调用视为栈管理操作，不是嵌套的工具调用。

## 验证方法

```bash
# 启动 relay
cd ~/.openclaw/workspace/claude-agent-hook-relay
fuser -k 8080/tcp 2>/dev/null; sleep 1
npm run build && node dist/index.js start > /tmp/relay-test.log 2>&1 &
sleep 2

# 运行测试 skill
claude -p "run <skill-name>"

# 查看 relay 输出
cat /tmp/relay-test.log | tail -3
```

## Skill 测试用例

### 单层：weather-checker
```bash
claude -p "run weather-checker"
```

### 两层嵌套：nested-test-skill
```bash
claude -p "run nested-test-skill"
```

### 三层嵌套：level-3-skill
需要创建 level-2-skill 和 level-1-skill：
```bash
# level-1-skill
mkdir -p ~/.claude/skills/level-1-skill
# SKILL.md: Run: date

# level-2-skill  
mkdir -p ~/.claude/skills/level-2-skill
# SKILL.md: Call level-1-skill, Run: echo "level2-step2"

# level-3-skill
mkdir -p ~/.claude/skills/level-3-skill
# SKILL.md: Call level-2-skill, Run: echo "step2"
```

### 连续调用：sequential-skill
```bash
mkdir -p ~/.claude/skills/sequential-skill
# SKILL.md:
# 1. Call weather-checker
# 2. Run: echo "after-first-weather"
# 3. Call weather-checker
# 4. Run: echo "done"
```
