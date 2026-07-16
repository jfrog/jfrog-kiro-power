#!/usr/bin/env bash
# One-command, additive install of the JFrog integration for the Kiro CLI (`kiro-cli`) — no checkout needed.
#
#   curl -fsSL https://raw.githubusercontent.com/jfrog/jfrog-kiro-power/main/scripts/bootstrap-cli.sh | bash
#
# It copies the JFrog skills into ~/.kiro/skills, so JFrog composes into ANY kiro-cli session (the
# default agent, or your own custom agent) — just run `kiro-cli chat` and ask a JFrog question. The
# skills carry the JFrog knowledge, helper scripts, and `/`-invoke, so they are the complete CLI
# capability; steering is the IDE power's channel and is intentionally not copied here. It never
# installs a replacement --agent (a kiro-cli --agent is singular per session, so that would replace
# the user's own).
#
# Options / env:
#   JFROG_KIRO_REPO=owner/repo   override source repo   (default: jfrog/jfrog-kiro-power)
#   JFROG_KIRO_REF=<branch/tag>  override source ref    (default: latest release tag, else main)
#   KIRO_POWER_SRC=<dir>         install from a local checkout instead of fetching (offline/testing)
#
# Always installs globally into ~/.kiro. Phase 1 = skills only (no MCP).
set -euo pipefail

REPO="${JFROG_KIRO_REPO:-jfrog/jfrog-kiro-power}"

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

SKILLS_DEST="$HOME/.kiro/skills"

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

echo
echo "done. JFrog composes into any kiro-cli session now. Just run:  kiro-cli chat"
echo "then ask a JFrog question (no --agent needed)."
