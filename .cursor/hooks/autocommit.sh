#!/bin/bash
# Auto-commit all changes when an agent finishes responding.
# Runs from the project root (project-level hook).

# Consume hook input JSON from stdin (unused).
cat > /dev/null

# Only act inside a git repo.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

git add -A

# Nothing staged? Nothing to commit.
git diff --cached --quiet && exit 0

git commit -q -m "Auto-commit: agent finished ($(date '+%Y-%m-%d %H:%M:%S'))"
exit 0
