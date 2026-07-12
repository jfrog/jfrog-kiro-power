import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractFrontmatter,
  parseField,
  hasNonEmptyDescription,
  validateSkillDir,
  validatePower,
  validateSteeringFile,
} from './validate.mjs';

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
