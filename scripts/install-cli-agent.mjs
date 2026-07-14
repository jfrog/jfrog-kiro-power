#!/usr/bin/env node
// Installs the JFrog agent for the Kiro CLI (`kiro-cli`).
//
// kiro-cli is a SEPARATE runtime from the Kiro IDE — it does not read ~/.kiro/powers/. Its plugin unit
// is an "agent" config at ~/.kiro/agents/<name>.json that bundles a system prompt + context resources +
// tools (+ MCP). This installer:
//   1. copies the embedded skills/ into ~/.kiro/skills/  (JFrog knowledge + login scripts; also serves
//      the IDE's Agent Skills), and
//   2. writes ~/.kiro/agents/jfrog.json from cli-agent/jfrog.agent.json, resolving the skill path.
//
//   node scripts/install-cli-agent.mjs                 # install (global: ~/.kiro)
//   node scripts/install-cli-agent.mjs --set-default   # also make `jfrog` the default kiro-cli agent
//
// Phase 1 = skills only (no MCP). Dependency-free Node ESM; no network (copies the local embedded skills).
import { promises as fs, accessSync, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

async function main() {
  const setDefault = process.argv.includes('--set-default');
  const kiroHome = path.join(os.homedir(), '.kiro');
  const skillsSrc = path.join(repoRoot, 'skills');
  const skillsDest = path.join(kiroHome, 'skills');
  const agentsDest = path.join(kiroHome, 'agents');
  const skillDir = path.join(skillsDest, 'jfrog'); // absolute; referenced by the agent config
  const agentFile = path.join(agentsDest, 'jfrog.json');

  // 1) copy embedded skills -> ~/.kiro/skills (replace each skill dir)
  const skills = (await fs.readdir(skillsSrc, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  if (skills.length === 0) throw new Error(`no skills found in ${skillsSrc}`);
  await fs.mkdir(skillsDest, { recursive: true });
  for (const name of skills) {
    const to = path.join(skillsDest, name);
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(path.join(skillsSrc, name), to, { recursive: true });
    console.log(`  skill  ${name} -> ${to}`);
  }

  // 2) render the agent config from the committed template (resolve __SKILL_DIR__)
  const template = await fs.readFile(path.join(repoRoot, 'cli-agent', 'jfrog.agent.json'), 'utf8');
  const rendered = template.split('__SKILL_DIR__').join(skillDir);
  JSON.parse(rendered); // fail fast if substitution broke JSON
  await fs.mkdir(agentsDest, { recursive: true });
  await fs.writeFile(agentFile, rendered, 'utf8');
  console.log(`  agent  jfrog -> ${agentFile}`);

  // 3) validate + optionally set default, when kiro-cli is on PATH
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

  console.log('\ndone. Use it with:  kiro-cli chat --agent jfrog');
  if (!setDefault) console.log('Or make it the default:  kiro-cli agent set-default jfrog');
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

await main();
