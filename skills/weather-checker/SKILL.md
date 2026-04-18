# weather-checker

A sub-skill used by nested-test-skill to demonstrate nested Skill tracking.

## What it does

Calls Bash to get the current date/time, simulating a weather API lookup.

## Steps

**Step 1:** Use the Bash tool:

```
Tool: Bash
Input: {"command": "echo 'Weather check: ' && date"}
```

This creates a nested call chain: nested-test-skill → weather-checker → Bash
