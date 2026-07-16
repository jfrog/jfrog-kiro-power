#!/usr/bin/env bash
# (c) JFrog Ltd. (2026)
# Verifies the prerequisites for the JFrog Kiro Power on macOS/Linux.
# Checks: (1) jf CLI present and >= 2.100.0, (2) at least one JFrog server configured.
# Exit 0 = all good; exit 1 = something needs attention.
set -uo pipefail

MIN="2.100.0"
status=0

echo "JFrog Kiro Power — install check"
echo "--------------------------------"

# 1) jf CLI + version
if ! command -v jf >/dev/null 2>&1; then
  echo "✗ jf CLI not found on PATH."
  echo "  Install: https://jfrog.com/getting-started-with-jfrog-cli/  (brew install jfrog-cli)"
  status=1
else
  ver="$(jf --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ -z "$ver" ]; then
    echo "✗ could not determine jf version (is 'jf' the JFrog CLI?)."
    status=1
  elif [ "$(printf '%s\n%s\n' "$MIN" "$ver" | sort -V | head -1)" != "$MIN" ]; then
    echo "✗ jf $ver is below the required $MIN. Upgrade: brew upgrade jfrog-cli"
    status=1
  else
    echo "✓ jf CLI $ver (>= $MIN)"
  fi
fi

# 2) at least one configured server
# NB: capture first, then match. `jf config show | grep -q` would SIGPIPE `jf` when grep
# closes the pipe on first match, and `pipefail` turns that 141 into a false "not configured".
cfg="$(jf config show 2>/dev/null || true)"
if command -v jf >/dev/null 2>&1 && printf '%s' "$cfg" | grep -q "Server ID"; then
  echo "✓ JFrog server configured"
else
  echo "✗ no JFrog server configured."
  echo "  Run: jf config add <server-id> --url=https://<host>.jfrog.io --access-token=<token> --interactive=false"
  status=1
fi

echo "--------------------------------"
[ "$status" -eq 0 ] && echo "All checks passed." || echo "Some checks failed — see above."
exit "$status"
