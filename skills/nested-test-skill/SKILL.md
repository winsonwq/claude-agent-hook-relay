# nested-test-skill

A test skill for verifying claude-agent-hook-relay's nested Skill tracking.

## What it does

This skill demonstrates a **nested Skill call chain**:

1. First, call the `Skill` tool to invoke `weather-checker` (the sub-skill)
2. After the sub-skill returns, call Bash with `date`
3. Call Read to read `example.txt`

## Steps

Follow these steps exactly:

**Step 1:** Use the Skill tool to call `weather-checker`

```
Tool: Skill
Input: {"skill": "weather-checker"}
```

**Step 2:** After step 1 completes, use the Bash tool:

```
Tool: Bash
Input: {"command": "date"}
```

**Step 3:** After step 2 completes, use the Read tool:

```
Tool: Read
Input: {"filePath": "~/.claude/skills/nested-test-skill/example.txt"}
```

## Verification

After running, check the cahr terminal output — you should see:

```
skillCount: 2
skillList: [
  { skill: "weather-checker", nestedCalls: ["Bash"] },
  { skill: "nested-test-skill", nestedCalls: ["Skill", "Bash", "Read"] }
]
```

This confirms nested Skill tracking is working correctly.

## Files

- `SKILL.md` — this file
- `example.txt` — a file for the Read tool to read
