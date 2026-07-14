#!/usr/bin/env bash
# One-command, additive install of the JFrog integration for the Kiro CLI (`kiro-cli`) — no checkout needed.
#
#   curl -fsSL https://raw.githubusercontent.com/jfrog/jfrog-kiro-power/align-with-fleet/scripts/bootstrap-cli.sh | bash
#
# It copies the JFrog skills into ~/.kiro/skills and the JFrog steering into ~/.kiro/steering, so JFrog
# composes into ANY kiro-cli session (the default agent, or your own custom agent) — just run
# `kiro-cli chat` and ask a JFrog question. It never installs a replacement --agent (a kiro-cli --agent
# is singular per session, so that would replace the user's own).
#
# Options / env:
#   JFROG_KIRO_REPO=owner/repo   override source repo   (default: jfrog/jfrog-kiro-power)
#   JFROG_KIRO_REF=<branch/tag>  override source ref    (default: align-with-fleet)
#   KIRO_POWER_SRC=<dir>         install from a local checkout instead of fetching (offline/testing)
#
# Always installs globally into ~/.kiro. Phase 1 = skills only (no MCP).
set -euo pipefail

REPO="${JFROG_KIRO_REPO:-jfrog/jfrog-kiro-power}"
REF="${JFROG_KIRO_REF:-align-with-fleet}"

SKILLS_DEST="$HOME/.kiro/skills"
STEERING_DEST="$HOME/.kiro/steering"

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

# additive: skills -> ~/.kiro/skills (replace each dir)
echo "Installing skills -> $SKILLS_DEST"
mkdir -p "$SKILLS_DEST"
for d in "$SRC"/skills/*/; do
  name="$(basename "$d")"
  rm -rf "${SKILLS_DEST:?}/$name"
  cp -R "$d" "$SKILLS_DEST/$name"
  echo "  skill     $name"
done

# additive: steering/*.md -> ~/.kiro/steering (overwrite our files; leave others alone)
echo "Installing steering -> $STEERING_DEST"
mkdir -p "$STEERING_DEST"
for f in "$SRC"/steering/*.md; do
  cp "$f" "$STEERING_DEST/$(basename "$f")"
  echo "  steering  $(basename "$f")"
done

echo
echo "done. JFrog composes into any kiro-cli session now. Just run:  kiro-cli chat"
echo "then ask a JFrog question (no --agent needed)."
