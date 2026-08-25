#!/usr/bin/env node
// (c) JFrog Ltd. (2026)
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
//   node scripts/install-cli.mjs               # additive: skills + MCP -> ~/.kiro (global)
//   node scripts/install-cli.mjs --workspace   # additive: skills + MCP -> ./.kiro
//
// KIRO_HOME=<dir>  give the CLI its own profile (e.g. ~/.kiro-cli) instead of the default ~/.kiro, so
// its skills never land where the IDE reads (see README "Running both surfaces on one machine").
// Ignored with --workspace, which always scopes to ./.kiro regardless of KIRO_HOME.
//
// Dependency-free Node ESM; the skills copy touches no network (copies the local embedded files). The
// MCP step shells out to the local `kiro-cli` binary only — no network call of its own either.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

  const { skills } = await installAdditive({
    skillsSrc: path.join(repoRoot, 'skills'),
    dest,
  });
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
}

// Only run main() when executed directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
