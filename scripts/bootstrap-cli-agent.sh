#!/usr/bin/env bash
# One-command, additive install of the JFrog integration for the Kiro CLI (`kiro-cli`) — no checkout needed.
#
#   curl -fsSL https://raw.githubusercontent.com/jfrog/jfrog-kiro-power/align-with-fleet/scripts/bootstrap-cli-agent.sh | bash
#
# By default this is ADDITIVE: it copies the JFrog skills into ~/.kiro/skills and the JFrog steering into
# ~/.kiro/steering, so JFrog composes into ANY kiro-cli session (the default agent, or your own custom
# agent) — just run `kiro-cli chat` and ask a JFrog question. It does NOT install a replacement --agent by
# default, because a kiro-cli --agent is singular per session.
#
# Options / env:
#   --with-agent             also write the optional isolated ~/.kiro/agents/jfrog.json (governed jf/jq session)
#   --set-default            implies --with-agent; also make `jfrog` the default kiro-cli agent
#   JFROG_KIRO_REPO=owner/repo   override source repo   (default: jfrog/jfrog-kiro-power)
#   JFROG_KIRO_REF=<branch/tag>  override source ref    (default: align-with-fleet)
#   KIRO_POWER_SRC=<dir>         install from a local checkout instead of fetching (offline/testing)
#
# Always installs globally into ~/.kiro. Phase 1 = skills only (no MCP).
set -euo pipefail

REPO="${JFROG_KIRO_REPO:-jfrog/jfrog-kiro-power}"
REF="${JFROG_KIRO_REF:-align-with-fleet}"
WITH_AGENT=0
SET_DEFAULT=0
for a in "$@"; do
  case "$a" in
    --with-agent)  WITH_AGENT=1 ;;
    --set-default) SET_DEFAULT=1; WITH_AGENT=1 ;;  # --set-default implies --with-agent
  esac
done

SKILLS_DEST="$HOME/.kiro/skills"
STEERING_DEST="$HOME/.kiro/steering"
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

[ -d "$SRC/skills" ]   || { echo "error: skills/ missing in source ($SRC)" >&2; exit 1; }
[ -d "$SRC/steering" ] || { echo "error: steering/ missing in source ($SRC)" >&2; exit 1; }

# 1) additive: skills -> ~/.kiro/skills (replace each dir)
echo "Installing skills -> $SKILLS_DEST"
mkdir -p "$SKILLS_DEST"
for d in "$SRC"/skills/*/; do
  name="$(basename "$d")"
  rm -rf "${SKILLS_DEST:?}/$name"
  cp -R "$d" "$SKILLS_DEST/$name"
  echo "  skill     $name"
done

# 2) additive: steering/*.md -> ~/.kiro/steering (overwrite our files; leave others alone)
echo "Installing steering -> $STEERING_DEST"
mkdir -p "$STEERING_DEST"
for f in "$SRC"/steering/*.md; do
  cp "$f" "$STEERING_DEST/$(basename "$f")"
  echo "  steering  $(basename "$f")"
done

echo
echo "JFrog composes into any kiro-cli session now. Just run:  kiro-cli chat"
echo "then ask a JFrog question (no --agent needed)."

# locate kiro-cli (well-known paths, then PATH)
KC=""
for c in "$HOME/.local/bin/kiro-cli" /usr/local/bin/kiro-cli /opt/homebrew/bin/kiro-cli; do
  [ -x "$c" ] && KC="$c" && break
done
[ -z "$KC" ] && command -v kiro-cli >/dev/null 2>&1 && KC="$(command -v kiro-cli)"

# 3) optional isolated agent (opt-in)
if [ "$WITH_AGENT" = 0 ]; then
  echo
  echo "(Optional) For an isolated JFrog-only session, re-run with --with-agent."
  exit 0
fi

[ -f "$SRC/cli-agent/jfrog.agent.json" ] || { echo "error: cli-agent/jfrog.agent.json missing in source ($SRC)" >&2; exit 1; }
echo
echo "Writing optional agent -> $AGENT_FILE"
mkdir -p "$AGENTS_DEST"
sed "s|__SKILL_DIR__|$SKILL_DIR|g" "$SRC/cli-agent/jfrog.agent.json" > "$AGENT_FILE"

if [ -n "$KC" ]; then
  if "$KC" agent validate --path "$AGENT_FILE" >/dev/null 2>&1; then echo "validated ✓"; else echo "warn: 'kiro-cli agent validate' failed — check $AGENT_FILE" >&2; fi
  if [ "$SET_DEFAULT" = 1 ]; then "$KC" agent set-default jfrog && echo "set as default ✓"; fi
else
  echo "(kiro-cli not found — skipped validate/set-default)"
fi

echo "done. Isolated mode:  kiro-cli chat --agent jfrog"
