# child-skill

A sub-skill loaded from `parent-skill/scripts/child-skill/`. This skill is **not** a top-level skill — it is only discoverable when `parent-skill` explicitly calls it via the Skill tool.

## What it does

Calls Bash to simulate a simple operation.

## Steps

**Step 1:** Use the Bash tool:

```
Tool: Bash
Input: {"command": "echo 'child-skill: running in nested directory'"}
```
