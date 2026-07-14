#!/usr/bin/env node
// Installs the JFrog integration for the Kiro CLI (`kiro-cli`) — ADDITIVE.
//
// kiro-cli is a SEPARATE runtime from the Kiro IDE — it does not read ~/.kiro/powers/, so it cannot
// consume the IDE power (POWER.md). Its additive mechanism is skills (~/.kiro/skills/) + global steering
// (~/.kiro/steering/): the default agent auto-loads both and composes JFrog into ANY session — the
// default agent, or a user's own custom agent (which inherits default skills/steering). This is the same
// "many things compose in one session" model as the IDE power. It never installs a replacement --agent
// (a kiro-cli --agent is singular per session, so that would replace the user's own).
//
//   node scripts/install-cli.mjs               # additive: skills + steering -> ~/.kiro (global)
//   node scripts/install-cli.mjs --workspace   # additive: skills + steering -> ./.kiro
//
// Phase 1 = skills only (no MCP). Dependency-free Node ESM; no network (copies the local embedded files).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Copy every skill dir under skillsSrc into <dest>/skills (replace each dir), and every steering *.md
// file under steeringSrc into <dest>/steering (overwrite). Idempotent: a re-run yields identical files
// and never touches steering files this repo doesn't own. Returns the names it wrote.
export async function installAdditive({ skillsSrc, steeringSrc, dest }) {
  const skillsDest = path.join(dest, 'skills');
  const steeringDest = path.join(dest, 'steering');

  const skills = (await fs.readdir(skillsSrc, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  if (skills.length === 0) throw new Error(`no skills found in ${skillsSrc}`);
  await fs.mkdir(skillsDest, { recursive: true });
  for (const name of skills) {
    const to = path.join(skillsDest, name);
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(path.join(skillsSrc, name), to, { recursive: true });
  }

  const steering = (await fs.readdir(steeringSrc, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name);
  if (steering.length === 0) throw new Error(`no steering files found in ${steeringSrc}`);
  await fs.mkdir(steeringDest, { recursive: true });
  for (const file of steering) {
    await fs.cp(path.join(steeringSrc, file), path.join(steeringDest, file));
  }

  return { skills, steering, skillsDest, steeringDest };
}

async function main() {
  const workspace = process.argv.slice(2).includes('--workspace');
  const dest = workspace ? path.join(process.cwd(), '.kiro') : path.join(os.homedir(), '.kiro');

  const { skills, steering } = await installAdditive({
    skillsSrc: path.join(repoRoot, 'skills'),
    steeringSrc: path.join(repoRoot, 'steering'),
    dest,
  });
  for (const name of skills) console.log(`  skill     ${name} -> ${path.join(dest, 'skills', name)}`);
  for (const file of steering) console.log(`  steering  ${file} -> ${path.join(dest, 'steering', file)}`);
  console.log(`\nJFrog composes into any kiro-cli session now. Just run:  kiro-cli chat`);
  console.log(`then ask a JFrog question (no --agent needed).`);
}

// Only run main() when executed directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
