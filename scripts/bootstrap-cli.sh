#!/usr/bin/env bash
# (c) JFrog Ltd. (2026)
# One-command, additive install of the JFrog integration for the Kiro CLI (`kiro-cli`) — no checkout needed.
#
#   curl -fsSL https://raw.githubusercontent.com/jfrog/jfrog-kiro-power/main/scripts/bootstrap-cli.sh | bash
#   ...workspace-scoped (into ./.kiro):  ...bootstrap-cli.sh | bash -s -- --workspace
#
# It copies the JFrog skills into ~/.kiro/skills, so JFrog composes into ANY kiro-cli session (the
# default agent, or your own custom agent) — just run `kiro-cli chat` and ask a JFrog question. The
# skills carry the JFrog knowledge, helper scripts, and `/`-invoke, so they are the complete CLI
# capability; steering is the IDE power's channel and is intentionally not copied here. It never
# installs a replacement --agent (a kiro-cli --agent is singular per session, so that would replace
# the user's own).
#
# If `kiro-cli` is on PATH, it also registers the JFrog MCP server (`kiro-cli mcp add`) — same
# OAuth-by-default mcpServers.jfrog.url entry the IDE Power's mcp.json ships, just written to
# kiro-cli's own config (~/.kiro/settings/mcp.json). Never overwrites an existing `jfrog` entry.
#
# Options / env:
#   --workspace                  install into ./.kiro/skills (this workspace) instead of ~/.kiro/skills
#   KIRO_HOME=<dir>              give the CLI its own profile (e.g. ~/.kiro-cli) instead of ~/.kiro, so
#                                 its skills never land where the IDE reads. Ignored with --workspace.
#   JFROG_KIRO_REPO=owner/repo   override source repo   (default: jfrog/jfrog-kiro-power)
#   JFROG_KIRO_REF=<branch/tag>  override source ref    (default: latest release tag, else main)
#   KIRO_POWER_SRC=<dir>         install from a local checkout instead of fetching (offline/testing)
#
# Installs globally into ~/.kiro (or $KIRO_HOME) by default (JFrog available in every kiro-cli
# session). Pass --workspace to scope into ./.kiro instead (avoids duplicating the IDE power's
# steering when you use both surfaces; note the CLI must then be run from this directory).
set -euo pipefail

REPO="${JFROG_KIRO_REPO:-jfrog/jfrog-kiro-power}"

# Scope: global (~/.kiro) by default, or ./.kiro when --workspace is passed.
WORKSPACE=false
for arg in "$@"; do
  case "$arg" in
    --workspace) WORKSPACE=true ;;
    *) echo "warning: ignoring unknown argument '$arg'" >&2 ;;
  esac
done

# Source ref: an explicit JFROG_KIRO_REF wins; otherwise install the latest published release tag; if
# the repo has no releases yet (or GitHub is unreachable), fall back to main. Dependency-free parse.
if [ -n "${JFROG_KIRO_REF:-}" ]; then
  REF="$JFROG_KIRO_REF"
else
  # `|| true` so a 404 (no releases yet) / offline does not trip `set -euo pipefail`.
  REF="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
        | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
  [ -n "$REF" ] || REF="main"
fi

# Workspace scope always wins (explicit --workspace). Otherwise KIRO_HOME wins over the default
# ~/.kiro, so a KIRO_HOME profile never gets skills written to ~/.kiro too (matches install-cli.mjs).
if [ "$WORKSPACE" = true ]; then
  SKILLS_DEST="$(pwd)/.kiro/skills"
elif [ -n "${KIRO_HOME:-}" ]; then
  SKILLS_DEST="${KIRO_HOME/#\~/$HOME}/skills"
else
  SKILLS_DEST="$HOME/.kiro/skills"
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

if [ -n "${KIRO_POWER_SRC:-}" ]; then
  SRC="$KIRO_POWER_SRC"
  echo "Using local source: $SRC"
else
  echo "Fetching $REPO@$REF …"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$TMP"
  SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
fi

[ -d "$SRC/skills" ] || { echo "error: skills/ missing in source ($SRC)" >&2; exit 1; }

# additive: skills -> ~/.kiro/skills (replace each dir)
echo "Installing skills -> $SKILLS_DEST"
mkdir -p "$SKILLS_DEST"
for d in "$SRC"/skills/*/; do
  name="$(basename "$d")"
  rm -rf "${SKILLS_DEST:?}/$name"
  cp -R "$d" "$SKILLS_DEST/$name"
  echo "  skill     $name"
done

# Register the JFrog MCP entry via `kiro-cli mcp add` (same mcpServers.jfrog.url shape as the IDE
# Power's mcp.json — OAuth by default, no static token). Best-effort: skip entirely if kiro-cli isn't
# on PATH yet, and never overwrite an existing `jfrog` entry (mcp add without --force exits non-zero
# when the name is taken, which is exactly the skip signal we want).
if command -v kiro-cli >/dev/null 2>&1; then
  MCP_SCOPE="global"; [ "$WORKSPACE" = true ] && MCP_SCOPE="workspace"
  if kiro-cli mcp add --name jfrog --url 'https://${JFROG_PLATFORM_URL}/mcp' --scope "$MCP_SCOPE" >/dev/null 2>&1; then
    echo "  mcp       jfrog -> https://\${JFROG_PLATFORM_URL}/mcp (OAuth, $MCP_SCOPE scope)"
  else
    echo "  mcp       jfrog skipped (already configured or error — re-run to retry)"
  fi
else
  echo "  mcp       skipped (kiro-cli not found on PATH) — install it, then re-run this script to add the JFrog MCP server"
fi

echo
if [ "$WORKSPACE" = true ]; then
  echo "done. Installed at workspace scope ($SKILLS_DEST)."
  echo "Run kiro-cli FROM this directory, then ask a JFrog question (no --agent needed)."
else
  echo "done. JFrog composes into any kiro-cli session now. Just run:  kiro-cli chat"
  echo "then ask a JFrog question (no --agent needed)."
fi
