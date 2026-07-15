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
} from './validate.mjs';
import { installAdditive } from './install-cli.mjs';
import { rewriteRefPointers, assertNoDeadRefPointers } from './gen-steering.mjs';

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
