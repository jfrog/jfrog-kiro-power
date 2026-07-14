#!/usr/bin/env bash
# One-command install of the JFrog agent for the Kiro CLI (`kiro-cli`) — no repo checkout needed.
#
#   curl -fsSL https://raw.githubusercontent.com/jfrog/jfrog-kiro-power/align-with-fleet/scripts/bootstrap-cli-agent.sh | bash
#
# Options / env:
#   --set-default            also make `jfrog` the default kiro-cli agent   (curl … | bash -s -- --set-default)
#   JFROG_KIRO_REPO=owner/repo   override source repo   (default: jfrog/jfrog-kiro-power)
#   JFROG_KIRO_REF=<branch/tag>  override source ref    (default: align-with-fleet)
#   KIRO_POWER_SRC=<dir>         install from a local checkout instead of fetching (offline/testing)
#
# It copies the JFrog skills into ~/.kiro/skills and writes ~/.kiro/agents/jfrog.json. Phase 1 = skills only.
set -euo pipefail

REPO="${JFROG_KIRO_REPO:-jfrog/jfrog-kiro-power}"
REF="${JFROG_KIRO_REF:-align-with-fleet}"
SET_DEFAULT=0
for a in "$@"; do [ "$a" = "--set-default" ] && SET_DEFAULT=1; done

SKILLS_DEST="$HOME/.kiro/skills"
AGENTS_DEST="$HOME/.kiro/agents"
SKILL_DIR="$SKILLS_DEST/jfrog"
AGENT_FILE="$AGENTS_DEST/jfrog.json"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

if [ -n "${KIRO_POWER_SRC:-}" ]; then
  SRC="$KIRO_POWER_SRC"
  echo "Using local source: $SRC"
else
  echo "Fetching $REPO@$REF …"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$TMP"
  SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
fi

[ -f "$SRC/cli-agent/jfrog.agent.json" ] || { echo "error: cli-agent/jfrog.agent.json missing in source ($SRC)" >&2; exit 1; }
[ -d "$SRC/skills" ] || { echo "error: skills/ missing in source ($SRC)" >&2; exit 1; }

echo "Installing skills -> $SKILLS_DEST"
mkdir -p "$SKILLS_DEST"
for d in "$SRC"/skills/*/; do
  name="$(basename "$d")"
  rm -rf "${SKILLS_DEST:?}/$name"
  cp -R "$d" "$SKILLS_DEST/$name"
  echo "  $name"
done

echo "Writing agent -> $AGENT_FILE"
mkdir -p "$AGENTS_DEST"
sed "s|__SKILL_DIR__|$SKILL_DIR|g" "$SRC/cli-agent/jfrog.agent.json" > "$AGENT_FILE"

# validate + optional set-default when kiro-cli is available
KC=""
for c in "$HOME/.local/bin/kiro-cli" /usr/local/bin/kiro-cli /opt/homebrew/bin/kiro-cli; do
  [ -x "$c" ] && KC="$c" && break
done
[ -z "$KC" ] && command -v kiro-cli >/dev/null 2>&1 && KC="$(command -v kiro-cli)"
if [ -n "$KC" ]; then
  if "$KC" agent validate --path "$AGENT_FILE" >/dev/null 2>&1; then echo "validated ✓"; else echo "warn: 'kiro-cli agent validate' failed — check $AGENT_FILE" >&2; fi
  if [ "$SET_DEFAULT" = 1 ]; then "$KC" agent set-default jfrog && echo "set as default ✓"; fi
else
  echo "(kiro-cli not found — skipped validate/set-default)"
fi

echo "done. Use it:  kiro-cli chat --agent jfrog"
