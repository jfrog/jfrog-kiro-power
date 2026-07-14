import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
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
  validateAgentConfig,
} from './validate.mjs';
import { installAdditive } from './install-cli-agent.mjs';

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

test('validateAgentConfig requires name, description, prompt, and a non-empty tools array', () => {
  assert.deepEqual(
    validateAgentConfig({ name: 'jfrog', description: 'd', prompt: 'file://x', tools: ['shell'] }),
    []
  );
  assert.ok(validateAgentConfig({}).some((e) => e.includes('name')));
  assert.ok(validateAgentConfig({ name: 'jfrog', prompt: 'p', tools: ['shell'] }).some((e) => e.includes('description')));
  assert.ok(validateAgentConfig({ name: 'jfrog', description: 'd', tools: ['shell'] }).some((e) => e.includes('prompt')));
  assert.ok(validateAgentConfig({ name: 'jfrog', description: 'd', prompt: 'p', tools: [] }).some((e) => e.includes('tools')));
});

// The CLI installer's additive copy is the primary path: it must land the vendored skills/ AND the
// generated steering/ into <dest>, and be idempotent (a re-run yields byte-identical files).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsSrc = join(repoRoot, 'skills');
const steeringSrc = join(repoRoot, 'steering');

test('installAdditive copies all skills and steering into <dest>', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'kiro-additive-'));
  const { skills, steering } = await installAdditive({ skillsSrc, steeringSrc, dest });

  assert.ok(skills.includes('jfrog'), 'jfrog skill should be among the copied skills');
  assert.ok(existsSync(join(dest, 'skills', 'jfrog', 'SKILL.md')), 'jfrog/SKILL.md must land');
  for (const name of skills) {
    assert.ok(existsSync(join(dest, 'skills', name)), `skill dir ${name} must land`);
  }

  const srcSteering = readdirSync(steeringSrc).filter((f) => f.endsWith('.md'));
  assert.deepEqual(steering.slice().sort(), srcSteering.slice().sort(), 'all steering files reported');
  for (const f of srcSteering) {
    assert.ok(existsSync(join(dest, 'steering', f)), `steering/${f} must land`);
  }
});

test('installAdditive is idempotent (re-run -> byte-identical files)', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'kiro-additive-idem-'));
  await installAdditive({ skillsSrc, steeringSrc, dest });
  const snap = (p) => readFileSync(p, 'utf8');
  const skillBefore = snap(join(dest, 'skills', 'jfrog', 'SKILL.md'));
  const steerFile = readdirSync(join(dest, 'steering')).find((f) => f.endsWith('.md'));
  const steerBefore = snap(join(dest, 'steering', steerFile));

  await installAdditive({ skillsSrc, steeringSrc, dest }); // second run

  assert.equal(snap(join(dest, 'skills', 'jfrog', 'SKILL.md')), skillBefore, 'skill file unchanged on re-run');
  assert.equal(snap(join(dest, 'steering', steerFile)), steerBefore, 'steering file unchanged on re-run');
});
