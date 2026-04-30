# parent-skill

A test skill demonstrating **nested directory structure** — the child skill is loaded from `scripts/child-skill/` subdirectory, not as a top-level skill.

## What it does

1. First, call the `Skill` tool to invoke `child-skill` (loaded from `scripts/child-skill/`)
2. After the child returns, run a Bash command as a sibling step

## Steps

**Step 1:** Use the Skill tool to call `child-skill` (nested under `scripts/child-skill/`)

```
Tool: Skill
Input: {"skill": "child-skill"}
```

**Step 2:** After step 1 completes, use the Bash tool:

```
Tool: Bash
Input: {"command": "echo 'parent-skill: child has returned'"}
```

## Verification

After running, check the relay output — you should see:

- `parent-skill` as the root skill
- `child-skill` as a nested skill under `parent-skill` (with `success: false` and an error)
- Inside `child-skill`'s nested calls: the Glob discovery call, and the Bash `echo 'parent-skill: child has returned'`

Note: Because `child-skill` fails with "Unknown skill", Claude continues executing subsequent steps inside `child-skill`'s context — so the Bash appears as a nested call inside `child-skill`, not as a sibling of `child-skill` under `parent-skill`.

This confirms relay correctly captures skill failures and tracks all nested calls within the failed skill's execution context.
