#!/usr/bin/env node
// (c) JFrog Ltd. (2026)
// Validates the Kiro power's skills and POWER.md frontmatter. Zero dependencies.
// CLI: `node scripts/validate.mjs` -> exit 1 on any error, else prints "validation passed".
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function extractFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

export function parseField(fm, field) {
  const m = fm.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

// Accepts an inline scalar (`description: text`) or a YAML block scalar
// (`description: >-` / `|` followed by indented, non-empty lines).
export function hasNonEmptyDescription(fm) {
  const lines = fm.split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i === -1) return false;
  const raw = lines[i].replace(/^description:\s*/, '').replace(/^[|>][-+]?\d*\s*$/, '').trim();
  // Strip a matching pair of surrounding quotes so `description: ""` / '' reads as empty, not truthy.
  const inline = raw.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  if (inline) return true;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '') continue;
    return /^\s+\S/.test(lines[j]);
  }
  return false;
}

export function validateSkillDir(skillsRoot, dirName) {
  const errors = [];
  const skillPath = join(skillsRoot, dirName, 'SKILL.md');
  if (!existsSync(skillPath)) return [`${dirName}: missing SKILL.md`];
  const fm = extractFrontmatter(readFileSync(skillPath, 'utf8'));
  if (!fm) return [`${dirName}: missing YAML frontmatter`];
  const name = parseField(fm, 'name');
  if (name !== dirName) errors.push(`${dirName}: frontmatter name "${name}" != dir "${dirName}"`);
  if (!hasNonEmptyDescription(fm)) errors.push(`${dirName}: missing/empty description`);
  return errors;
}

// Each steering file must have frontmatter with a valid `inclusion` mode and a non-empty description.
const INCLUSION_MODES = ['always', 'auto', 'fileMatch', 'manual'];
export function validateSteeringFile(name, md) {
  const errors = [];
  const fm = extractFrontmatter(md ?? '');
  if (!fm) return [`steering/${name}: missing YAML frontmatter`];
  const inclusion = parseField(fm, 'inclusion');
  if (!INCLUSION_MODES.includes(inclusion)) {
    errors.push(`steering/${name}: inclusion "${inclusion}" must be one of ${INCLUSION_MODES.join('/')}`);
  }
  if (!hasNonEmptyDescription(fm)) errors.push(`steering/${name}: missing/empty description`);
  return errors;
}

// POWER.md must carry frontmatter with a name and a non-empty description (Kiro power metadata).
export function validatePower(md) {
  const errors = [];
  const fm = extractFrontmatter(md ?? '');
  if (!fm) return ['POWER.md: missing YAML frontmatter'];
  if (!parseField(fm, 'name')) errors.push('POWER.md: missing "name"');
  if (!hasNonEmptyDescription(fm)) errors.push('POWER.md: missing/empty description');
  return errors;
}

// mcp.json ships with the power (see README/POWER.md); it must stay valid JSON with the JFrog MCP
// server's url wired to the ${JFROG_PLATFORM_URL} env-var placeholder, not a raw/mistyped value. This
// was deleted once already in this repo's history — catch that regression (or a broken url) at build time.
//
// The jfrog entry connects via OAuth (Kiro's dynamic-client-registration flow, triggered by an explicit
// `oauth` object and the absence of `headers`) rather than a static bearer token. Fail the build if either
// a `headers`/Authorization block or `oauth: false` reappears — that would silently regress the connection
// back to token auth, and nothing else would catch it (see mcp.json history).
export function validateMcpJson(text) {
  if (text == null) return ['mcp.json: file is missing'];
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return [`mcp.json: invalid JSON (${e.message})`];
  }
  const errors = [];
  const entry = json?.mcpServers?.jfrog;
  const url = entry?.url;
  if (typeof url !== 'string' || !url) errors.push('mcp.json: missing mcpServers.jfrog.url');
  else if (!/^https:\/\/\$\{[A-Z0-9_]+\}\/mcp$/.test(url)) {
    errors.push(`mcp.json: mcpServers.jfrog.url "${url}" must look like https://\${ENV_VAR}/mcp`);
  }
  if (entry && entry.headers !== undefined) {
    errors.push('mcp.json: mcpServers.jfrog must not set "headers" — this server connects via OAuth, not a static bearer token');
  }
  if (entry?.oauth === false) {
    errors.push('mcp.json: mcpServers.jfrog must not set "oauth: false" — that disables OAuth auto-detection');
  }
  return errors;
}

function main() {
  const root = process.cwd();
  const errors = [];

  const skillsRoot = join(root, 'skills');
  const dirs = existsSync(skillsRoot)
    ? readdirSync(skillsRoot).filter((d) => statSync(join(skillsRoot, d)).isDirectory())
    : [];
  if (dirs.length === 0) errors.push('skills/: no skill directories found');
  for (const d of dirs) errors.push(...validateSkillDir(skillsRoot, d));

  errors.push(...validatePower(readFileSync(join(root, 'POWER.md'), 'utf8')));

  const mcpPath = join(root, 'mcp.json');
  errors.push(...validateMcpJson(existsSync(mcpPath) ? readFileSync(mcpPath, 'utf8') : null));

  const steeringRoot = join(root, 'steering');
  const steeringFiles = existsSync(steeringRoot)
    ? readdirSync(steeringRoot).filter((f) => f.endsWith('.md'))
    : [];
  if (steeringFiles.length === 0) errors.push('steering/: no steering files found');
  for (const f of steeringFiles) {
    errors.push(...validateSteeringFile(f, readFileSync(join(steeringRoot, f), 'utf8')));
  }

  if (errors.length) {
    console.error('VALIDATION FAILED:\n' + errors.map((e) => ' - ' + e).join('\n'));
    process.exit(1);
  }
  console.log('validation passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
