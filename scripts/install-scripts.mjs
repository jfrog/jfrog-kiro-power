#!/usr/bin/env node
// ON-DEMAND, scripts-only — install ONLY the JFrog skills' runnable helper scripts (login /
// environment-check) into ~/.kiro/jfrog-scripts/ (or ./.kiro/jfrog-scripts with --workspace).
//
// WHY scripts-only: the JFrog knowledge already ships as steering (bundled in the IDE Power, installed
// for the CLI), so the ONLY thing a user can be missing is the runnable helper scripts. We deliberately
// do NOT install SKILL.md (that would register a second `jfrog` skill and duplicate the steering in
// context) and do NOT install references/ (they ship as the #<name>-references steering). The shipped
// steering points the agent at ~/.kiro/jfrog-scripts/<skill>/<script>.
//
//   node scripts/install-scripts.mjs             # -> ~/.kiro/jfrog-scripts   (global, recommended)
//   node scripts/install-scripts.mjs --workspace # -> ./.kiro/jfrog-scripts
//
// GRACEFUL: this is the only action that touches the network. On failure (offline / blocked) it prints
// a calm note and exits non-zero (never an unhandled-rejection stack trace); re-running simply retries
// (idempotent). Dependency-free and cross-platform (pure Node via scripts/lib/targz.mjs; no external
// tar/curl). The pinned version comes from scripts/sync-skills-vendor.json.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fetchTarGz, extractTarToDir } from './lib/targz.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const vendorPath = path.join(scriptDir, 'sync-skills-vendor.json');

// Copy each skill's scripts/ directory from an extracted jfrog-skills tree into <dest>/<skill>/.
// Writes ONLY scripts — never SKILL.md or references. Idempotent (replaces each dir). Returns the
// skill names whose scripts were installed.
export async function installScripts({ srcSkillsDir, dest }) {
  const skills = (await fs.readdir(srcSkillsDir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const installed = [];
  await fs.mkdir(dest, { recursive: true });
  for (const name of skills) {
    const scriptsDir = path.join(srcSkillsDir, name, 'scripts');
    const entries = await fs.readdir(scriptsDir).catch(() => []);
    if (entries.length === 0) continue; // this skill has no scripts
    const to = path.join(dest, name);
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(scriptsDir, to, { recursive: true });
    installed.push(name);
  }
  return installed;
}

async function main() {
  const { repo, pin } = JSON.parse(await fs.readFile(vendorPath, 'utf8'));
  if (!repo || !pin) throw new Error(`${vendorPath} must define repo and pin`);

  const workspace = process.argv.includes('--workspace');
  const dest = workspace
    ? path.join(process.cwd(), '.kiro', 'jfrog-scripts')
    : path.join(os.homedir(), '.kiro', 'jfrog-scripts');

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'jfrog-scripts-'));
  try {
    console.log(`Fetching JFrog helper scripts from ${repo}@${pin} …`);
    const { tar } = await fetchTarGz(repo, pin);
    const top = await extractTarToDir(tar, path.join(work, 'x'));
    const installed = await installScripts({ srcSkillsDir: path.join(top, 'skills'), dest });
    if (installed.length === 0) throw new Error('no skill scripts found in the downloaded archive');
    for (const name of installed) console.log(`  scripts  ${name} -> ${path.join(dest, name)}`);
    console.log(`done. JFrog helper scripts installed into ${dest}`);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

// Only run when executed directly (not when imported by tests). Fail GRACEFULLY: a network/offline
// error prints a calm, actionable note and sets a non-zero exit code — no stack trace. Re-running retries.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(
      `\nCould not install JFrog helper scripts: ${err.message}\n` +
        `This step is optional — the JFrog steering still works without the scripts. ` +
        `Re-run \`npm run install-scripts\` when you are online, or the next time a script is needed.`
    );
    process.exitCode = 1;
  });
}
