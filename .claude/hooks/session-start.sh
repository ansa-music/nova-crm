#!/bin/bash
set -uo pipefail

# Rebuilds the graphify knowledge graph (graphify-out/, gitignored) fresh at
# the start of every session, so codebase questions can go through
# `graphify query`/`path`/`explain` instead of a cold full-repo scan.
# AST-only extraction (see the "## graphify" section in CLAUDE.md) — no LLM
# calls, no API cost, a few seconds for this repo's size.
#
# `uv tool install` lands in the container's own filesystem, not the repo,
# so a fresh session's fresh container won't have the `graphify` binary yet
# even though .claude/skills/graphify/ and this hook are committed — install
# it here first if missing.

if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install graphifyy >/dev/null 2>&1
  fi
fi

if command -v graphify >/dev/null 2>&1; then
  cd "${CLAUDE_PROJECT_DIR:-.}"
  graphify update . >/dev/null 2>&1
fi

exit 0
