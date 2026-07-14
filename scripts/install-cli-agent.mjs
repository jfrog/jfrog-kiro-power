#!/usr/bin/env node
// Installs the JFrog integration for the Kiro CLI (`kiro-cli`) — ADDITIVE by default.
//
// kiro-cli is a SEPARATE runtime from the Kiro IDE — it does not read ~/.kiro/powers/, so it cannot
// consume the IDE power (POWER.md). Its additive mechanism is skills (~/.kiro/skills/) + global steering
// (~/.kiro/steering/): the default agent auto-loads both and composes JFrog into ANY session — the
// default agent, or a user's own custom agent (which inherits default skills/steering). This is the same
// "many things compose in one session" model as the IDE power.
//
// This installer therefore copies BOTH the vendored skills/ AND the generated steering/ into ~/.kiro/.
// It does NOT install a replacement --agent by default: a kiro-cli --agent is singular per session, so
// installing JFrog as THE agent would replace the user's own. The isolated JFrog-only agent is opt-in
// via --with-agent (a governed session with a scoped jf/jq shell allow-list).
//
//   node scripts/install-cli-agent.mjs                # additive: skills + steering -> ~/.kiro (global)
//   node scripts/install-cli-agent.mjs --workspace    # additive: skills + steering -> ./.kiro
//   node scripts/install-cli-agent.mjs --with-agent   # also write the optional ~/.kiro/agents/jfrog.json
//   node scripts/install-cli-agent.mjs --set-default  # implies --with-agent; make jfrog the default agent
//
// Phase 1 = skills only (no MCP). Dependency-free Node ESM; no network (copies the local embedded files).
import { promises as fs, accessSync, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
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
  const args = process.argv.slice(2);
  const workspace = args.includes('--workspace');
  const setDefault = args.includes('--set-default');
  const withAgent = args.includes('--with-agent') || setDefault; // --set-default implies --with-agent

  const dest = workspace ? path.join(process.cwd(), '.kiro') : path.join(os.homedir(), '.kiro');

  // 1) additive install: skills + steering
  const { skills, steering } = await installAdditive({
    skillsSrc: path.join(repoRoot, 'skills'),
    steeringSrc: path.join(repoRoot, 'steering'),
    dest,
  });
  for (const name of skills) console.log(`  skill     ${name} -> ${path.join(dest, 'skills', name)}`);
  for (const file of steering) console.log(`  steering  ${file} -> ${path.join(dest, 'steering', file)}`);
  console.log(`\nJFrog composes into any kiro-cli session now. Just run:  kiro-cli chat`);
  console.log(`then ask a JFrog question (no --agent needed).`);

  // 2) optional isolated agent (opt-in)
  if (!withAgent) {
    console.log(`\n(Optional) For an isolated JFrog-only session, re-run with --with-agent.`);
    return;
  }

  const skillDir = path.join(dest, 'skills', 'jfrog'); // absolute; referenced by the agent config
  const agentsDest = path.join(os.homedir(), '.kiro', 'agents');
  const agentFile = path.join(agentsDest, 'jfrog.json');
  const template = await fs.readFile(path.join(repoRoot, 'cli-agent', 'jfrog.agent.json'), 'utf8');
  const rendered = template.split('__SKILL_DIR__').join(skillDir);
  JSON.parse(rendered); // fail fast if substitution broke JSON
  await fs.mkdir(agentsDest, { recursive: true });
  await fs.writeFile(agentFile, rendered, 'utf8');
  console.log(`\n  agent     jfrog -> ${agentFile}  (optional isolated JFrog-only session)`);

  const kiroCli = findKiroCli();
  if (kiroCli) {
    const v = spawnSync(kiroCli, ['agent', 'validate', '--path', agentFile], { encoding: 'utf8' });
    console.log(`  validate: ${v.status === 0 ? 'valid ✓' : 'FAILED ✗\n' + (v.stderr || v.stdout || '')}`);
    if (setDefault) {
      const d = spawnSync(kiroCli, ['agent', 'set-default', 'jfrog'], { encoding: 'utf8' });
      console.log(`  set-default: ${d.status === 0 ? 'jfrog is now the default agent ✓' : (d.stderr || d.stdout || 'failed')}`);
    }
  } else {
    console.log('  (kiro-cli not on PATH — skipped validate/set-default)');
  }
  console.log(`\nIsolated mode:  kiro-cli chat --agent jfrog`);
  if (!setDefault) console.log(`Or make it the default:  kiro-cli agent set-default jfrog`);
}

function findKiroCli() {
  const exe = process.platform === 'win32' ? 'kiro-cli.exe' : 'kiro-cli';
  // Well-known install locations first, then anything on PATH (mirrors bootstrap-cli-agent.sh's
  // `command -v kiro-cli` fallback so a PATH-only install isn't missed).
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', exe),
    '/usr/local/bin/' + exe,
    '/opt/homebrew/bin/' + exe,
    ...pathDirs.map((d) => path.join(d, exe)),
  ];
  for (const c of candidates) {
    try {
      accessSync(c, constants.X_OK);
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

// Only run main() when executed directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
