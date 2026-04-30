#!/bin/bash
set -e

SKILLS_DIR="${HOME}/.claude/skills"
mkdir -p "$SKILLS_DIR"

# weather-checker
mkdir -p "$SKILLS_DIR/weather-checker"
cat > "$SKILLS_DIR/weather-checker/SKILL.md" << 'EOF'
# weather-checker

## Steps

Step 1: Use the Bash tool to check weather:
Tool: Bash
Input: {"command": "echo 'Weather check: ' && date"}
EOF

# nested-test-skill
mkdir -p "$SKILLS_DIR/nested-test-skill"
cat > "$SKILLS_DIR/nested-test-skill/SKILL.md" << 'EOF'
# nested-test-skill

## Steps

Step 1: Use the Skill tool to call weather-checker
Tool: Skill
Input: {"skill": "weather-checker"}

Step 2: Use the Bash tool
Tool: Bash
Input: {"command": "date"}

Step 3: Use the Read tool
Tool: Read
Input: {"filePath": "example.txt"}
EOF
echo "test" > "$SKILLS_DIR/nested-test-skill/example.txt"

# parent-skill (nested directory structure)
mkdir -p "$SKILLS_DIR/parent-skill/scripts/child-skill"
cat > "$SKILLS_DIR/parent-skill/SKILL.md" << 'EOF'
# parent-skill

A test skill demonstrating nested directory structure — the child skill is loaded from `scripts/child-skill/` subdirectory.

## Steps

Step 1: Use the Skill tool to call child-skill (nested under `scripts/child-skill/`)
Tool: Skill
Input: {"skill": "child-skill"}

Step 2: Use the Bash tool
Tool: Bash
Input: {"command": "echo 'parent-skill: child has returned'"}
EOF

cat > "$SKILLS_DIR/parent-skill/scripts/child-skill/SKILL.md" << 'EOF'
# child-skill

A sub-skill loaded from `parent-skill/scripts/child-skill/`. This skill is NOT a top-level skill.

## Steps

Step 1: Use the Bash tool
Tool: Bash
Input: {"command": "echo 'child-skill: running in nested directory'"}
EOF

# level-3-skill
mkdir -p "$SKILLS_DIR/level-3-skill"
cat > "$SKILLS_DIR/level-3-skill/SKILL.md" << 'EOF'
# level-3-skill

## Steps

Step 1: Use the Skill tool to call level-2-skill
Tool: Skill
Input: {"skill": "level-2-skill"}

Step 2: Use the Bash tool
Tool: Bash
Input: {"command": "echo level3-step3"}
EOF

# level-2-skill
mkdir -p "$SKILLS_DIR/level-2-skill"
cat > "$SKILLS_DIR/level-2-skill/SKILL.md" << 'EOF'
# level-2-skill

## Steps

Step 1: Use the Skill tool to call level-1-skill
Tool: Skill
Input: {"skill": "level-1-skill"}

Step 2: Use the Bash tool
Tool: Bash
Input: {"command": "echo level2-step2"}
EOF

# level-1-skill
mkdir -p "$SKILLS_DIR/level-1-skill"
cat > "$SKILLS_DIR/level-1-skill/SKILL.md" << 'EOF'
# level-1-skill

## Steps

Step 1: Use the Bash tool
Tool: Bash
Input: {"command": "date"}
EOF

# sequential-skill
mkdir -p "$SKILLS_DIR/sequential-skill"
cat > "$SKILLS_DIR/sequential-skill/SKILL.md" << 'EOF'
# sequential-skill

## Steps

Step 1: Use the Skill tool to call weather-checker
Tool: Skill
Input: {"skill": "weather-checker"}

Step 2: Use the Bash tool
Tool: Bash
Input: {"command": "echo after-first-weather"}

Step 3: Use the Skill tool to call weather-checker again
Tool: Skill
Input: {"skill": "weather-checker"}

Step 4: Use the Bash tool
Tool: Bash
Input: {"command": "echo done"}
EOF

echo "Test skills setup complete"
