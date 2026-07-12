#!/usr/bin/env node
// OPTIONAL — install the real JFrog Agent Skills into Kiro's skills directory.
//
// The power itself works with NO fetch: the JFrog knowledge ships as bundled steering/ files. This
// step is only for users who additionally want the real SKILL.md skills in `.kiro/skills/` (Kiro's
// skill UI / slash-invoke / runnable helper scripts).
//
// A Kiro Power does NOT package skills/, so there is no local copy on your machine to copy from — this
// step therefore downloads the SAME pinned version recorded in scripts/sync-skills-vendor.json from
// public GitHub (no auth). It is the ONLY part of this power that touches the network.
//
//   node scripts/install-skills.mjs            # into ./.kiro/skills   (this workspace)
//   node scripts/install-skills.mjs --global   # into ~/.kiro/skills   (all workspaces)
//
// Dependency-free and cross-platform (Windows/macOS/Linux): download + extraction are pure Node via
// scripts/lib/targz.mjs — no external `tar`/`curl` binary is used.
//
// This is distinct from scripts/sync-skills.mjs, which is a MAINTAINER build-time tool that refreshes
// the embedded skills/ tree in the repo and must never run on a user's machine.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fetchTarGz, extractTarToDir } from './lib/targz.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const vendorPath = path.join(scriptDir, 'sync-skills-vendor.json');

async function main() {
  const { repo, pin } = JSON.parse(await fs.readFile(vendorPath, 'utf8'));
  if (!repo || !pin) throw new Error(`${vendorPath} must define repo and pin`);

  const global = process.argv.includes('--global');
  const dest = global
    ? path.join(os.homedir(), '.kiro', 'skills')
    : path.join(process.cwd(), '.kiro', 'skills');

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'jfrog-skills-'));
  try {
    console.log(`Downloading ${repo}@${pin} …`);
    const { tar } = await fetchTarGz(repo, pin);
    const top = await extractTarToDir(tar, path.join(work, 'x'));

    const srcSkills = path.join(top, 'skills');
    const names = (await fs.readdir(srcSkills, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    if (names.length === 0) throw new Error('no skills found in the downloaded archive');

    await fs.mkdir(dest, { recursive: true });
    for (const name of names) {
      const to = path.join(dest, name);
      await fs.rm(to, { recursive: true, force: true });
      await fs.cp(path.join(srcSkills, name), to, { recursive: true });
      console.log(`  installed ${name} -> ${to}`);
    }
    console.log(`done. JFrog skills installed into ${dest}`);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
await main();
