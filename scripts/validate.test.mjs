// (c) JFrog Ltd. (2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractFrontmatter,
  parseField,
  hasNonEmptyDescription,
  validateSkillDir,
  validatePower,
  validateSteeringFile,
  validateMcpJson,
} from './validate.mjs';
import { installAdditive } from './install-cli.mjs';
import { installScripts } from './install-scripts.mjs';
import { rewriteRefPointers, rewriteScriptPointers, assertNoDeadRefPointers } from './gen-steering.mjs';

function writeSkill(root, dir, body) {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'SKILL.md'), body);
}

test('extractFrontmatter returns the block between --- fences', () => {
  assert.equal(extractFrontmatter('---\nname: x\n---\nbody'), 'name: x');
  assert.equal(extractFrontmatter('no frontmatter'), null);
});

test('parseField reads an inline scalar', () => {
  assert.equal(parseField('name: jfrog', 'name'), 'jfrog');
  assert.equal(parseField('other: y', 'name'), null);
});

test('hasNonEmptyDescription accepts inline and block scalars, rejects missing/empty', () => {
  assert.equal(hasNonEmptyDescription('description: hello'), true);
  assert.equal(hasNonEmptyDescription('description: >-\n  wrapped text'), true);
  assert.equal(hasNonEmptyDescription('name: x'), false);
  assert.equal(hasNonEmptyDescription('description:\n'), false);
  assert.equal(hasNonEmptyDescription('description: >-\n'), false);
  assert.equal(hasNonEmptyDescription('description: |\n'), false);
});

test('hasNonEmptyDescription rejects empty quoted scalars and accepts quoted text', () => {
  assert.equal(hasNonEmptyDescription('description: ""'), false);
  assert.equal(hasNonEmptyDescription("description: ''"), false);
  assert.equal(hasNonEmptyDescription('description: "   "'), false);
  assert.equal(hasNonEmptyDescription('description: "hello"'), true);
  assert.equal(hasNonEmptyDescription("description: 'hello'"), true);
});

test('validateSkillDir flags an empty quoted-scalar description', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  writeSkill(root, 'jfrog', '---\nname: jfrog\ndescription: ""\n---\nbody');
  assert.ok(validateSkillDir(root, 'jfrog').some((e) => e.includes('description')));
});

test('validateSkillDir passes a well-formed skill', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  writeSkill(root, 'jfrog', '---\nname: jfrog\ndescription: does things\n---\nbody');
  assert.deepEqual(validateSkillDir(root, 'jfrog'), []);
});

test('validateSkillDir flags a name/dir mismatch and missing description', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  writeSkill(root, 'jfrog', '---\nname: wrong\n---\nbody');
  const errors = validateSkillDir(root, 'jfrog');
  assert.ok(errors.some((e) => e.includes('name')));
  assert.ok(errors.some((e) => e.includes('description')));
});

test('validateSkillDir flags an empty block-scalar description', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  writeSkill(root, 'jfrog', '---\nname: jfrog\ndescription: >-\n---\nbody');
  const errors = validateSkillDir(root, 'jfrog');
  assert.ok(errors.some((e) => e.includes('description')));
});

test('validatePower requires frontmatter with name and description', () => {
  assert.deepEqual(validatePower('---\nname: jfrog\ndescription: d\n---\nbody'), []);
  assert.ok(validatePower('no frontmatter').some((e) => e.includes('frontmatter')));
  assert.ok(validatePower('---\ndescription: d\n---').some((e) => e.includes('name')));
  assert.ok(validatePower('---\nname: jfrog\n---').some((e) => e.includes('description')));
});

test('validateSteeringFile requires a valid inclusion mode and a description', () => {
  assert.deepEqual(validateSteeringFile('jfrog.md', '---\ninclusion: auto\nname: jfrog\ndescription: d\n---\nx'), []);
  assert.deepEqual(validateSteeringFile('r.md', '---\ninclusion: manual\ndescription: d\n---\nx'), []);
  assert.ok(validateSteeringFile('x.md', 'no frontmatter').some((e) => e.includes('frontmatter')));
  assert.ok(validateSteeringFile('x.md', '---\ninclusion: bogus\ndescription: d\n---').some((e) => e.includes('inclusion')));
  assert.ok(validateSteeringFile('x.md', '---\ninclusion: auto\n---').some((e) => e.includes('description')));
});

// mcp.json ships with the power; it must stay valid JSON with the jfrog server's url wired to the
// ${JFROG_PLATFORM_URL} env-var placeholder (this file was deleted once already in this repo's history).
test('validateMcpJson requires valid JSON and a properly-wired mcpServers.jfrog.url', () => {
  assert.deepEqual(
    validateMcpJson('{"mcpServers":{"jfrog":{"url":"https://${JFROG_PLATFORM_URL}/mcp"}}}'),
    []
  );
  assert.ok(validateMcpJson(null).some((e) => e.includes('missing')));
  assert.ok(validateMcpJson('{ not json').some((e) => e.includes('invalid JSON')));
  assert.ok(validateMcpJson('{"mcpServers":{}}').some((e) => e.includes('mcpServers.jfrog.url')));
  assert.ok(
    validateMcpJson('{"mcpServers":{"jfrog":{"url":"https://YOUR_JFROG_PLATFORM_URL/mcp"}}}').some((e) =>
      e.includes('must look like')
    )
  );
});

// The CLI installer's additive copy is the primary path: it must land the vendored skills/ into
// <dest> (skills only — steering is the IDE power's channel, not the CLI's) and be idempotent
// (a re-run yields byte-identical files).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsSrc = join(repoRoot, 'skills');

test('installAdditive copies all skills into <dest> and does not write steering', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'kiro-additive-'));
  const { skills } = await installAdditive({ skillsSrc, dest });

  assert.ok(skills.includes('jfrog'), 'jfrog skill should be among the copied skills');
  assert.ok(existsSync(join(dest, 'skills', 'jfrog', 'SKILL.md')), 'jfrog/SKILL.md must land');
  for (const name of skills) {
    assert.ok(existsSync(join(dest, 'skills', name)), `skill dir ${name} must land`);
  }
  assert.ok(!existsSync(join(dest, 'steering')), 'CLI install must NOT create a steering/ dir');
});

test('installAdditive is idempotent (re-run -> byte-identical files)', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'kiro-additive-idem-'));
  await installAdditive({ skillsSrc, dest });
  const snap = (p) => readFileSync(p, 'utf8');
  const skillBefore = snap(join(dest, 'skills', 'jfrog', 'SKILL.md'));

  await installAdditive({ skillsSrc, dest }); // second run

  assert.equal(snap(join(dest, 'skills', 'jfrog', 'SKILL.md')), skillBefore, 'skill file unchanged on re-run');
});

// gen-steering must render Power-safe steering: on-disk `references/<x>.md` and `scripts/*` pointers
// don't exist in a Power-only install, so reference pointers are redirected to the bundled
// `#<name>-references` steering. rewriteRefPointers does that redirect; assertNoDeadRefPointers is the
// build guard that fails if any reference pointer slips through (e.g. a future skill's new file).
test('rewriteRefPointers redirects references/<x>.md to the bundled #<name>-references steering', () => {
  const out = rewriteRefPointers('read `references/artifactory-aql-syntax.md` for AQL', 'jfrog');
  assert.match(out, /`artifactory-aql-syntax` section of the `#jfrog-references` steering/);
  assert.doesNotMatch(out, /references\/[a-z0-9._-]+\.md/i, 'no bare references/<x>.md pointer remains');
});

test('rewriteRefPointers handles <skill_path>/references and the references/*.md glob', () => {
  assert.doesNotMatch(
    rewriteRefPointers('see `<skill_path>/references/jfrog-login-flow.md`', 'jfrog'),
    /references\/[a-z0-9._-]+\.md/i
  );
  for (const glob of ['examples in `references/*.md` omit it', 'in the other `references/*` files']) {
    const out = rewriteRefPointers(glob, 'jfrog');
    assert.match(out, /`#jfrog-references` steering/);
    assert.doesNotMatch(out, /references\/\*/, 'the references glob is rewritten');
  }
});

test('rewriteRefPointers uses the skill name for the bundle and leaves non-reference text intact', () => {
  assert.match(
    rewriteRefPointers('read `references/discovering-skills.md`', 'jfrog-ai-catalog-skills'),
    /`#jfrog-ai-catalog-skills-references` steering/
  );
  const untouched = 'run `jf rt ping` and read the docs at https://example.com/references/guide';
  assert.equal(rewriteRefPointers(untouched, 'jfrog'), untouched, 'URLs / non-target text are not rewritten');
});

// Some skills reference ANOTHER skill's references/SKILL.md (e.g. jfrog-setup-package-managers pointing
// back at the base `jfrog` skill). These must redirect to the OTHER skill's bundle/steering, not the
// current skill's — using the current skill's name here would misattribute the section.
test('rewriteRefPointers redirects cross-skill references/<x>.md to the OTHER skill\'s bundle', () => {
  const out = rewriteRefPointers(
    'see [`../jfrog/references/jfrog-login-flow.md`](../jfrog/references/jfrog-login-flow.md)',
    'jfrog-setup-package-managers'
  );
  assert.match(out, /`jfrog-login-flow` section of the `#jfrog-references` steering/);
  assert.doesNotMatch(out, /\.\.\/jfrog\/references/, 'no residual ../jfrog/references pointer remains');
  const nested = rewriteRefPointers(
    'see [`../../jfrog/references/jfrog-login-flow.md`](../../jfrog/references/jfrog-login-flow.md)',
    'jfrog-setup-package-managers'
  );
  assert.match(nested, /`#jfrog-references` steering/);
});

test('rewriteRefPointers redirects the cross-skill references glob/ellipsis mention', () => {
  const out = rewriteRefPointers('out of scope: CLI install/login (`../jfrog/references/…`).', 'jfrog-setup-package-managers');
  assert.match(out, /`#jfrog-references` steering/);
  assert.doesNotMatch(out, /\.\.\/jfrog\/references/);
});

test('rewriteRefPointers redirects cross-skill SKILL.md pointers (with or without an anchor)', () => {
  const out = rewriteRefPointers(
    'read [`../jfrog/SKILL.md`](../jfrog/SKILL.md) first',
    'jfrog-mcp-management'
  );
  assert.match(out, /`#jfrog` steering/);
  assert.doesNotMatch(out, /SKILL\.md/);
  const anchored = rewriteRefPointers(
    'see the [server selection rules](../jfrog/SKILL.md#server-selection-rules-mandatory)',
    'jfrog-mcp-management'
  );
  assert.match(anchored, /`#jfrog` steering/);
  assert.doesNotMatch(anchored, /SKILL\.md/);
});

test('assertNoDeadRefPointers throws on a residual references/<x>.md and passes clean text', () => {
  assert.throws(
    () => assertNoDeadRefPointers('jfrog.md', 'stray `references/xray-entities.md` link'),
    /unrewritten reference pointer/
  );
  assert.throws(
    () => assertNoDeadRefPointers('jfrog.md', 'stray `references/*` dir mention'),
    /unrewritten reference pointer/
  );
  assert.doesNotThrow(() =>
    assertNoDeadRefPointers('jfrog.md', 'load the `#jfrog-references` steering — all clean here')
  );
});

// gen-steering redirects in-skill script pointers to the concrete on-disk path that install-scripts fills
// (~/.kiro/jfrog-scripts/<name>/<script>), so the always-loaded steering can run them without a registered
// skill. Both `<skill_path>/scripts/<file>` and bare `scripts/<file>` must be rewritten.
test('rewriteScriptPointers redirects <skill_path>/scripts and bare scripts/ to ~/.kiro/jfrog-scripts', () => {
  assert.equal(
    rewriteScriptPointers('bash <skill_path>/scripts/check-environment.sh <model>', 'jfrog'),
    'bash ~/.kiro/jfrog-scripts/jfrog/check-environment.sh <model>'
  );
  assert.equal(
    rewriteScriptPointers('written by `scripts/check-environment.sh`', 'jfrog'),
    'written by `~/.kiro/jfrog-scripts/jfrog/check-environment.sh`'
  );
  assert.match(
    rewriteScriptPointers('run scripts/jfrog-login-save-credentials.sh', 'jfrog-ai-catalog-skills'),
    /~\/\.kiro\/jfrog-scripts\/jfrog-ai-catalog-skills\/jfrog-login-save-credentials\.sh/
  );
});

test('rewriteScriptPointers redirects a cross-skill scripts/<file> to the OTHER skill\'s install path', () => {
  const out = rewriteScriptPointers(
    'mirrors `../../jfrog/scripts/check-environment.sh` detect_harness()',
    'jfrog-mcp-management'
  );
  assert.equal(out, 'mirrors `~/.kiro/jfrog-scripts/jfrog/check-environment.sh` detect_harness()');
});

// install-scripts must land ONLY the scripts/ contents (no SKILL.md, no references) into <dest>/<skill>/.
test('installScripts copies only scripts, never SKILL.md or references', async () => {
  const src = mkdtempSync(join(tmpdir(), 'src-skills-'));
  // fake extracted skills tree: one skill with scripts + references + SKILL.md, one with no scripts
  mkdirSync(join(src, 'jfrog', 'scripts'), { recursive: true });
  mkdirSync(join(src, 'jfrog', 'references'), { recursive: true });
  writeFileSync(join(src, 'jfrog', 'SKILL.md'), '---\nname: jfrog\n---\nbody');
  writeFileSync(join(src, 'jfrog', 'scripts', 'check-environment.sh'), '#!/bin/bash\necho ok');
  writeFileSync(join(src, 'jfrog', 'references', 'x.md'), '# ref');
  mkdirSync(join(src, 'jfrog-package-safety-and-download'), { recursive: true });
  writeFileSync(join(src, 'jfrog-package-safety-and-download', 'SKILL.md'), '---\nname: p\n---\nb');

  const dest = mkdtempSync(join(tmpdir(), 'jfrog-scripts-'));
  const installed = await installScripts({ srcSkillsDir: src, dest });

  assert.deepEqual(installed, ['jfrog'], 'only the skill that has scripts is installed');
  assert.ok(existsSync(join(dest, 'jfrog', 'check-environment.sh')), 'script file lands');
  assert.ok(!existsSync(join(dest, 'jfrog', 'SKILL.md')), 'no SKILL.md written');
  assert.ok(!existsSync(join(dest, 'jfrog', 'references')), 'no references written');
  assert.ok(!existsSync(join(dest, 'jfrog-package-safety-and-download')), 'skill with no scripts is skipped');
});
