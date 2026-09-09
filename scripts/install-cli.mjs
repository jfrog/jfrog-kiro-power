#!/usr/bin/env node
// (c) JFrog Ltd. (2026)
//
// Additive install of the JFrog integration for Kiro (IDE skills + kiro-cli).
// Copies the JFrog skills into ~/.kiro/skills/ so JFrog composes into ANY kiro-cli session (the
// default agent, or a user's own custom agent) and is accessible via slash commands in the IDE.
//
// TWO MODES — auto-detected:
//   LOCAL  (from a checkout):  node scripts/install-cli.mjs          — reads skills/ from the repo
//   REMOTE (no checkout):      npx -y github:jfrog/jfrog-kiro-power  — downloads from GitHub
//
// The script checks whether skills/ exists next to it. If yes → local mode. If no → remote mode
// (fetches the tarball from GitHub). Both modes then run the same install logic.
//
//   node scripts/install-cli.mjs               # additive: skills + MCP -> ~/.kiro (global)
//   node scripts/install-cli.mjs --workspace   # additive: skills + MCP -> ./.kiro
//   npx -y github:jfrog/jfrog-kiro-power       # remote: same result, no clone needed (all platforms)
//
// KIRO_HOME=<dir>  give the CLI its own profile (e.g. ~/.kiro-cli) instead of the default ~/.kiro, so
// its skills never land where the IDE reads (see README "Running both surfaces on one machine").
// Ignored with --workspace, which always scopes to ./.kiro regardless of KIRO_HOME.
//
// Options / env:
//   --workspace                  install into ./.kiro/skills instead of ~/.kiro/skills
//   KIRO_HOME=<dir>              custom Kiro home (ignored with --workspace)
//   JFROG_KIRO_REPO=owner/repo   override source repo   (default: jfrog/jfrog-kiro-power)
//   JFROG_KIRO_REF=<branch/tag>  override source ref    (default: latest release tag, else main)
//   KIRO_POWER_SRC=<dir>         force local source from a specific directory (offline/testing)
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { fetchTarGz, extractTarToDir } from './lib/targz.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const REPO = process.env.JFROG_KIRO_REPO ?? 'jfrog/jfrog-kiro-power';

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

// ---------------------------------------------------------------------------
// Remote-fetch helpers (used when skills/ is not available locally)
// ---------------------------------------------------------------------------

/** Resolve the git ref to download: explicit env > latest release tag > "main". */
export async function resolveRef(repo = REPO) {
  if (process.env.JFROG_KIRO_REF) return process.env.JFROG_KIRO_REF;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
    if (res.ok) {
      const data = await res.json();
      if (data.tag_name) return data.tag_name;
    }
  } catch { /* offline or no releases — fall through */ }
  return 'main';
}

/**
 * Resolve the skills source directory. Returns { skillsSrc, tmpDir } where tmpDir is set only when
 * a remote fetch was needed (caller must clean it up).
 *
 * Priority: KIRO_POWER_SRC env > local skills/ next to script > download from GitHub.
 */
export async function resolveSkillsSrc() {
  // 1. Explicit local source (testing/offline).
  if (process.env.KIRO_POWER_SRC) {
    const src = path.join(process.env.KIRO_POWER_SRC, 'skills');
    console.log(`Using local source: ${process.env.KIRO_POWER_SRC}`);
    return { skillsSrc: src, tmpDir: null };
  }

  // 2. Local checkout — skills/ exists next to this script.
  const localSkills = path.join(repoRoot, 'skills');
  const localStat = await fs.stat(localSkills).catch(() => null);
  if (localStat?.isDirectory()) {
    return { skillsSrc: localSkills, tmpDir: null };
  }

  // 3. Remote — download from GitHub.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jfrog-kiro-'));
  const ref = await resolveRef();
  console.log(`Fetching ${REPO}@${ref} …`);
  const { tar } = await fetchTarGz(REPO, ref);
  const src = await extractTarToDir(tar, tmpDir);
  return { skillsSrc: path.join(src, 'skills'), tmpDir };
}

// Only a bare host[:port] is accepted — no path, no userinfo, no shell metacharacters. On Windows,
// provisionMcp calls execFileSync with shell: true, which joins args into one command line without
// escaping; JFROG_PLATFORM_URL is otherwise unvalidated user input, so this is the guard against that.
// bootstrap-cli.sh applies the identical rule so both installers write the same MCP url (see README).
const HOST_RE = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

// Resolve JFROG_PLATFORM_URL into a full MCP url, or null if it isn't a valid bare host[:port]. Keeps
// an explicit http:// scheme (defaults to https otherwise) instead of always forcing https.
export function resolvePlatformUrl(rawUrl) {
  const match = /^(https?):\/\//i.exec(rawUrl);
  const scheme = match ? match[1].toLowerCase() : 'https';
  const host = rawUrl.slice(match ? match[0].length : 0).replace(/\/+$/, '');
  return HOST_RE.test(host) ? `${scheme}://${host}/mcp` : null;
}

export function provisionMcp({ scope, env = process.env, exec = execFileSync, onError = undefined }) {
  const isWin = process.platform === 'win32';
  const opts = { shell: isWin, timeout: 10_000 };
  const childEnv = { ...env };
  if (childEnv.KIRO_HOME) childEnv.KIRO_HOME = expandHome(childEnv.KIRO_HOME);

  try {
    exec('kiro-cli', ['--version'], { ...opts, stdio: 'ignore', env: childEnv });
  } catch {
    return 'unavailable';
  }

  if (!childEnv.JFROG_PLATFORM_URL) return 'no-platform-url';

  const mcpUrl = resolvePlatformUrl(childEnv.JFROG_PLATFORM_URL);
  if (!mcpUrl) return 'invalid-platform-url';

  try {
    exec(
      'kiro-cli',
      ['mcp', 'add', '--name', 'jfrog', '--url', mcpUrl, '--scope', scope],
      { ...opts, stdio: 'pipe', env: childEnv }
    );
    return 'added';
  } catch (err) {
    const stderr = err.stderr?.toString() ?? err.message ?? '';
    if (/already.exist/i.test(stderr)) return 'skipped';
    onError?.(stderr.trim() || String(err));
    return 'error';
  }
}

async function main() {
  const workspace = process.argv.slice(2).includes('--workspace');
  const dest = resolveKiroDest({ workspace });

  const { skillsSrc, tmpDir } = await resolveSkillsSrc();

  try {
    const stat = await fs.stat(skillsSrc).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new Error(`skills/ missing in source (${skillsSrc})`);
    }

    console.log(`Installing skills -> ${path.join(dest, 'skills')}`);
    const { skills } = await installAdditive({ skillsSrc, dest });
    for (const name of skills) console.log(`  skill     ${name} -> ${path.join(dest, 'skills', name)}`);

    const mcpScope = workspace ? 'workspace' : 'global';
    const mcpResult = provisionMcp({
      scope: mcpScope,
      onError: (msg) => process.stderr.write(`  mcp       error: ${msg}\n`),
    });
    if (mcpResult === 'added') {
      console.log(`  mcp       jfrog -> ${resolvePlatformUrl(process.env.JFROG_PLATFORM_URL)} (OAuth, ${mcpScope} scope)`);
    } else if (mcpResult === 'skipped') {
      console.log('  mcp       jfrog skipped — entry already exists, leaving it untouched');
    } else if (mcpResult === 'no-platform-url') {
      console.log(`  mcp       jfrog skipped — JFROG_PLATFORM_URL is not set; set it and re-run, or: kiro-cli mcp add --name jfrog --url https://<host>/mcp --scope ${mcpScope}`);
    } else if (mcpResult === 'invalid-platform-url') {
      console.log(`  mcp       jfrog skipped — JFROG_PLATFORM_URL ("${process.env.JFROG_PLATFORM_URL}") is not a valid host; set it to just the platform hostname (e.g. my.jfrog.io) and re-run, or: kiro-cli mcp add --name jfrog --url https://<host>/mcp --scope ${mcpScope}`);
    } else if (mcpResult === 'error') {
      console.log('  mcp       jfrog registration failed — see error above');
    } else {
      console.log('  mcp       skipped (kiro-cli not found on PATH) — install it, then run this again to add the JFrog MCP server');
    }

    console.log(`\nJFrog composes into any kiro-cli session now. Just run:  kiro-cli chat`);
    console.log(`then ask a JFrog question (no --agent needed).`);
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// Only run main() when executed directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
