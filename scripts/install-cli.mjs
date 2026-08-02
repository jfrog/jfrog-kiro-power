#!/usr/bin/env node
// (c) JFrog Ltd. (2026)
// Installs the JFrog integration for the Kiro CLI (`kiro-cli`) — ADDITIVE, skills only.
//
// kiro-cli is a SEPARATE runtime from the Kiro IDE — it does not read ~/.kiro/powers/, so it cannot
// consume the IDE power (POWER.md). Its additive mechanism is skills (~/.kiro/skills/): the default
// agent auto-loads them and composes JFrog into ANY session — the default agent, or a user's own custom
// agent (which inherits default skills). The skills carry the full JFrog knowledge plus the runnable
// helper scripts and `/`-invoke, so they are the complete CLI capability on their own. Steering is the
// IDE power's channel and is intentionally NOT copied here — the steering is generated from these same
// skills, so shipping it too would advertise JFrog twice within one CLI session.
// It never installs a replacement --agent (a kiro-cli --agent is singular per session).
//
//   node scripts/install-cli.mjs               # additive: skills -> ~/.kiro (global)
//   node scripts/install-cli.mjs --workspace   # additive: skills -> ./.kiro
//
// KIRO_HOME=<dir>  give the CLI its own profile (e.g. ~/.kiro-cli) instead of the default ~/.kiro, so
// its skills never land where the IDE reads (see README "Running both surfaces on one machine").
// Ignored with --workspace, which always scopes to ./.kiro regardless of KIRO_HOME.
//
// Phase 1 = skills only (no MCP). Dependency-free Node ESM; no network (copies the local embedded files).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Expand a leading `~` (env vars are not shell-expanded) and resolve to an absolute path.
export function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

// Workspace scope always wins (explicit --workspace on the command line). Otherwise KIRO_HOME
// wins over the default ~/.kiro, so a KIRO_HOME profile never gets skills written to ~/.kiro too.
export function resolveKiroDest({ workspace, cwd = process.cwd(), env = process.env, home = os.homedir() }) {
  if (workspace) return path.join(cwd, '.kiro');
  if (env.KIRO_HOME) return expandHome(env.KIRO_HOME);
  return path.join(home, '.kiro');
}

// Copy every skill dir under skillsSrc into <dest>/skills (replacing each dir). Idempotent: a re-run
// yields identical files. Returns the skill names it wrote.
export async function installAdditive({ skillsSrc, dest }) {
  const skillsDest = path.join(dest, 'skills');

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

  return { skills, skillsDest };
}

async function main() {
  const workspace = process.argv.slice(2).includes('--workspace');
  const dest = resolveKiroDest({ workspace });

  const { skills } = await installAdditive({
    skillsSrc: path.join(repoRoot, 'skills'),
    dest,
  });
  for (const name of skills) console.log(`  skill     ${name} -> ${path.join(dest, 'skills', name)}`);
  console.log(`\nJFrog composes into any kiro-cli session now. Just run:  kiro-cli chat`);
  console.log(`then ask a JFrog question (no --agent needed).`);
}

// Only run main() when executed directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
