# nested-test-skill

A test skill for verifying claude-agent-hook-relay's nested Skill tracking.

## What it does

This skill demonstrates a **nested Skill call chain**:

1. Calls the `weather-checker` sub-skill (nested Skill)
   - `weather-checker` internally calls Bash to get the current time
2. After the nested skill returns, calls Bash to list the current directory
3. Calls Read to read a file

This creates a trace like:

```
Skill "nested-test-skill"
  └── Skill "weather-checker"
        └── Bash "date"
  └── Bash "ls -la"
  └── Read "example.txt"
```

## Usage

After installing with `relay install-test-skill`, trigger it with:

```
claude -p "run the nested-test-skill"
```

Or interactively:

```
/nested-test-skill
```

## Verification

After running, check the relay terminal output — you should see:

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
- `scripts/weather-checker/SKILL.md` — the nested sub-skill
- `scripts/example.txt` — a file for the Read tool to read
