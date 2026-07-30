#!/usr/bin/env node
// (c) JFrog Ltd. (2026)
// Vendors skill content from jfrog/jfrog-skills into this plugin.
// Run when bumping the pin in scripts/sync-skills-vendor.json:  node scripts/sync-skills.mjs
//
// Dependency-free and cross-platform (Windows/macOS/Linux): extraction is pure Node via
// scripts/lib/targz.mjs — no external `tar` binary is spawned.
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fetchTarGz, extractTarToDir } from "./lib/targz.mjs";

async function readJson(p) { return JSON.parse(await fs.readFile(p, "utf8")); }
async function fileExists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function copyPath(fromDir, toDir, rel) {
  const from = path.join(fromDir, rel);
  const to = path.join(toDir, rel);
  if (!(await fileExists(from))) throw new Error(`path missing in upstream tarball: ${rel}`);
  await fs.rm(to, { recursive: true, force: true });
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
  console.log(`  ${rel} -> ${path.relative(process.cwd(), to)}`);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const vendorPath = path.join(scriptDir, "sync-skills-vendor.json");
  if (!(await fileExists(vendorPath))) throw new Error(`missing ${vendorPath}`);
  const { repo, pin, paths } = await readJson(vendorPath);
  if (!repo || !pin || !Array.isArray(paths) || paths.length === 0)
    throw new Error(`${vendorPath} must define repo, pin and a non-empty paths[]`);
  console.log(`--- ${repo} (ref: ${pin}) ---`);
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "sync-skills-"));
  try {
    const { url, tar } = await fetchTarGz(repo, pin);
    console.log(`  fetched ${url}`);
    const extracted = await extractTarToDir(tar, path.join(workDir, "x"));
    for (const rel of paths) await copyPath(extracted, repoRoot, rel);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
  console.log("done.");
}
await main();
