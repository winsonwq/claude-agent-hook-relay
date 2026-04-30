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
- `child-skill` as a nested skill under `parent-skill`
- `Bash` as a sibling tool call under `parent-skill`
- The `child-skill` itself should have a nested `Bash` call

This confirms relay correctly tracks skill calls even when the child is loaded from a nested `scripts/` directory (not a top-level skill).
