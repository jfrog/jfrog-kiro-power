#!/usr/bin/env node
// (c) JFrog Ltd. (2026)
// Keep the hardcoded jfrog-skills pin in POWER.md and README.md in lockstep with the single source of
// truth, scripts/sync-skills-vendor.json.
//
// WHY: the IDE's on-demand helper-script fetch uses the tag hardcoded in POWER.md's Onboarding snippet.
// If that tag drifts from the pin the steering was generated at, the fetched scripts can mismatch the
// shipped steering (design doc "vector 1"). Run at pin-bump time (`npm run sync-pin`); CI enforces that
// it was run (drift check). Idempotent, dependency-free. Only edits POWER.md and README.md.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vendorPath = path.join(scriptDir, 'sync-skills-vendor.json');
const FILES = ['POWER.md', 'README.md'];

// Rewrite the pin in-place. Two rules:
//   1. Functional (authoritative): codeload .../<repo>/{tar.gz|zip}/<ref>  ->  <ref> = pin. Scoped to
//      the vendored repo so unrelated URLs (e.g. the jfrog-kiro-power bootstrap ref) are never touched.
//   2. Prose (best-effort): a backticked v-semver is set to `<pin>`, but ONLY when it's explicitly
//      called out as "the pinned version" nearby — not any backticked vX.Y.Z-shaped string anywhere
//      in the file. Without that anchor, an unrelated version mention added later (a kiro-cli tag, a
//      jf CLI minimum version) would get silently overwritten on the next pin bump. (A SHA pin skips
//      rule 2; rule 1 still applies.)
export function syncPin(text, repo, pin) {
  const repoRe = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`(${repoRe}\\/(?:tar\\.gz|zip)\\/)[^\\s"'|)\\\\]+`, 'g'), `$1${pin}`)
    .replace(/(pinned version[^`\n]{0,20})`v\d+\.\d+\.\d+[A-Za-z0-9.-]*`/gi, `$1\`${pin}\``);
}

async function main() {
  const { repo, pin } = JSON.parse(await fs.readFile(vendorPath, 'utf8'));
  if (!repo || !pin) throw new Error(`${vendorPath} must define repo and pin`);
  let changed = 0;
  for (const rel of FILES) {
    const p = path.join(repoRoot, rel);
    const before = await fs.readFile(p, 'utf8');
    const after = syncPin(before, repo, pin);
    if (after !== before) {
      await fs.writeFile(p, after, 'utf8');
      changed++;
      console.log(`  updated ${rel} -> ${pin}`);
    } else {
      console.log(`  ${rel} already at ${pin}`);
    }
  }
  console.log(changed ? 'done (pin synced).' : 'done (no changes).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
