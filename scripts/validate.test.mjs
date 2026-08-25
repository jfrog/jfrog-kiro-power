// (c) JFrog Ltd. (2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { gzipSync } from 'node:zlib';
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
import { installAdditive, resolveKiroDest, expandHome, provisionMcp, resolvePlatformUrl } from './install-cli.mjs';
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { installScripts } from './install-scripts.mjs';
import {
  rewriteRefPointers,
  rewriteScriptPointers,
  assertNoDeadRefPointers,
  collapseSelfReferentialLinks,
} from './gen-steering.mjs';
import { syncPin } from './sync-pin.mjs';
import { extractTarToDir, fetchTarGz } from './lib/targz.mjs';

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

// The jfrog MCP entry connects via OAuth, not a static bearer token — a `headers`/Authorization block or
// `oauth: false` would silently regress it back to token auth (see the opencode-jfrog-plugin precedent of
// removing exactly this), so the validator must fail the build if either reappears.
test('validateMcpJson rejects a bearer-token regression (headers or oauth:false on the jfrog entry)', () => {
  assert.ok(
    validateMcpJson(
      '{"mcpServers":{"jfrog":{"url":"https://${JFROG_PLATFORM_URL}/mcp","headers":{"Authorization":"Bearer ${TOKEN}"}}}}'
    ).some((e) => e.includes('headers') && e.includes('OAuth')),
    'a headers block must be flagged'
  );
  assert.ok(
    validateMcpJson('{"mcpServers":{"jfrog":{"url":"https://${JFROG_PLATFORM_URL}/mcp","oauth":false}}}').some(
      (e) => e.includes('oauth: false')
    ),
    'oauth:false must be flagged'
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

// KIRO_HOME must win over the default ~/.kiro so a user running both the IDE and kiro-cli with a
// dedicated CLI profile (README "Running both surfaces on one machine") actually gets skills written
// there instead of ~/.kiro — otherwise the documented workaround is a no-op (this was the bug: neither
// install-cli.mjs nor bootstrap-cli.sh read KIRO_HOME at all). --workspace always wins regardless.
test('resolveKiroDest: default -> ~/.kiro, KIRO_HOME overrides it, --workspace wins over both', () => {
  const home = '/home/u';
  const cwd = '/work/proj';
  assert.equal(resolveKiroDest({ workspace: false, cwd, home, env: {} }), join(home, '.kiro'));
  assert.equal(
    resolveKiroDest({ workspace: false, cwd, home, env: { KIRO_HOME: '/home/u/.kiro-cli' } }),
    '/home/u/.kiro-cli'
  );
  assert.equal(
    resolveKiroDest({ workspace: true, cwd, home, env: { KIRO_HOME: '/home/u/.kiro-cli' } }),
    join(cwd, '.kiro')
  );
});

test('expandHome expands a leading ~ since env vars are not shell-expanded', () => {
  assert.equal(expandHome('~'), homedir());
  assert.equal(expandHome('~/foo'), join(homedir(), 'foo'));
  assert.equal(expandHome('/already/absolute'), '/already/absolute');
});

// provisionMcp must never overwrite an existing `jfrog` entry and must not throw when kiro-cli is
// absent — the MCP step is a bonus on top of skills, not a hard requirement.
test('provisionMcp adds the jfrog entry via `kiro-cli mcp add` with the resolved url and no --force', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push([cmd, args]); return ''; };
  const result = provisionMcp({ scope: 'global', env: { JFROG_PLATFORM_URL: 'my.jfrog.io' }, exec });

  assert.equal(result, 'added');
  assert.deepEqual(calls[0][1], ['--version']);
  assert.deepEqual(calls[1], [
    'kiro-cli',
    ['mcp', 'add', '--name', 'jfrog', '--url', 'https://my.jfrog.io/mcp', '--scope', 'global'],
  ]);
  assert.ok(!calls[1][1].includes('--force'), 'must never force-overwrite an existing jfrog entry');
});

test('provisionMcp strips a scheme prefix and trailing slash from JFROG_PLATFORM_URL before constructing the url', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push([cmd, args]); return ''; };
  provisionMcp({ scope: 'global', env: { JFROG_PLATFORM_URL: 'https://my.jfrog.io/' }, exec });
  assert.deepEqual(calls[1][1][5], 'https://my.jfrog.io/mcp', 'scheme and trailing slash must be stripped');
});

test('provisionMcp returns "no-platform-url" when JFROG_PLATFORM_URL is not set', () => {
  const exec = () => '';
  assert.equal(provisionMcp({ scope: 'global', env: {}, exec }), 'no-platform-url');
});

test('provisionMcp reports "skipped" when the jfrog entry already exists (kiro-cli mcp add exits non-zero)', () => {
  const exec = (cmd, args) => {
    if (args[0] === 'mcp') { const e = new Error(); e.stderr = Buffer.from("already exists"); throw e; }
    return '';
  };
  assert.equal(provisionMcp({ scope: 'global', env: { JFROG_PLATFORM_URL: 'my.jfrog.io' }, exec }), 'skipped');
});

test('provisionMcp reports "error" and forwards stderr for genuine failures', () => {
  const exec = (cmd, args) => {
    if (args[0] === 'mcp') { const e = new Error(); e.stderr = Buffer.from('unknown flag --scope'); throw e; }
    return '';
  };
  const errors = [];
  const result = provisionMcp({ scope: 'global', env: { JFROG_PLATFORM_URL: 'my.jfrog.io' }, exec, onError: (m) => errors.push(m) });
  assert.equal(result, 'error');
  assert.ok(errors[0].includes('unknown flag'));
});

test('provisionMcp reports "unavailable" instead of throwing when kiro-cli is not on PATH', () => {
  const exec = () => { throw new Error('command not found: kiro-cli'); };
  assert.equal(provisionMcp({ scope: 'workspace', env: { JFROG_PLATFORM_URL: 'my.jfrog.io' }, exec }), 'unavailable');
});

test('provisionMcp expands a leading ~ in KIRO_HOME before passing to kiro-cli', () => {
  const envsSeen = [];
  const exec = (cmd, args, opts) => { envsSeen.push(opts?.env?.KIRO_HOME); return ''; };
  provisionMcp({ scope: 'global', env: { JFROG_PLATFORM_URL: 'my.jfrog.io', KIRO_HOME: '~/.kiro-cli' }, exec });
  assert.ok(envsSeen[0] && !envsSeen[0].startsWith('~'));
});

// resolvePlatformUrl is the single source of truth for turning JFROG_PLATFORM_URL into an mcp url —
// provisionMcp uses it to build the --url argument AND to render the "added" log line, so the two
// can no longer disagree the way the old duplicated regexes did.
test('resolvePlatformUrl keeps an explicit http scheme, strips a case-insensitive https scheme and all trailing slashes', () => {
  assert.equal(resolvePlatformUrl('my.jfrog.io'), 'https://my.jfrog.io/mcp');
  assert.equal(resolvePlatformUrl('HTTPS://my.jfrog.io///'), 'https://my.jfrog.io/mcp');
  assert.equal(
    resolvePlatformUrl('http://my.jfrog.io'),
    'http://my.jfrog.io/mcp',
    'an http-only platform must not be upgraded to https'
  );
});

// A `shell: true` execFileSync on Windows joins argv into one unescaped command line, so a metacharacter
// in JFROG_PLATFORM_URL (never validated elsewhere) would run as a command. Userinfo would also leak
// into the process argv and the printed log line. Reject all of it before a url is ever built.
test('resolvePlatformUrl rejects an empty host, embedded userinfo, and shell metacharacters', () => {
  assert.equal(resolvePlatformUrl('https://'), null, 'https:// alone leaves an empty host');
  assert.equal(resolvePlatformUrl('/'), null);
  assert.equal(resolvePlatformUrl('http://user:pass@my.jfrog.io'), null, 'userinfo must not reach the command line');
  assert.equal(
    resolvePlatformUrl('my.jfrog.io & rm -rf /'),
    null,
    'a shell metacharacter must be rejected before shell:true on Windows sees it'
  );
});

test('provisionMcp reports "invalid-platform-url" instead of registering a broken entry', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push([cmd, args]); return ''; };
  const result = provisionMcp({ scope: 'global', env: { JFROG_PLATFORM_URL: 'https:///' }, exec });
  assert.equal(result, 'invalid-platform-url');
  assert.equal(calls.length, 1, 'only the --version probe runs; kiro-cli mcp add must never see a broken url');
});

// bootstrap-cli.sh has its own, separately-written copy of this same host-cleaning logic (it can't
// import resolvePlatformUrl — it's a shell script), and the two already diverged once on the skip
// message (commit 716b795). Run the real script against a fake kiro-cli on PATH and assert its
// --url argument matches resolvePlatformUrl's rules exactly, so a future edit to either side that
// breaks parity fails this test instead of shipping two installers that write different urls.
function withFakeKiroCli(fn) {
  const bin = mkdtempSync(join(tmpdir(), 'fake-kiro-cli-'));
  const script = join(bin, 'kiro-cli');
  writeFileSync(
    script,
    '#!/usr/bin/env bash\ncase "$1" in\n  --version) exit 0 ;;\n' +
      '  mcp) if [ "$2" = "add" ]; then echo "MCP_ADD $*"; exit 0; fi ;;\nesac\nexit 1\n'
  );
  chmodSync(script, 0o755);
  return fn(bin);
}

function runBootstrap(extraEnv, bin) {
  const cwd = mkdtempSync(join(tmpdir(), 'bootstrap-cwd-'));
  return execFileSync('bash', ['-c', `bash ${join(repoRoot, 'scripts', 'bootstrap-cli.sh')} --workspace 2>&1`], {
    cwd,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KIRO_POWER_SRC: repoRoot, ...extraEnv },
    encoding: 'utf8',
  });
}

test('bootstrap-cli.sh resolves JFROG_PLATFORM_URL with the same rules as install-cli.mjs\'s resolvePlatformUrl', () => {
  withFakeKiroCli((bin) => {
    const upper = runBootstrap({ JFROG_PLATFORM_URL: 'HTTPS://my.jfrog.io/' }, bin);
    assert.match(upper, /mcp\s+jfrog -> https:\/\/my\.jfrog\.io\/mcp \(OAuth, workspace scope\)/);

    const httpOnly = runBootstrap({ JFROG_PLATFORM_URL: 'http://my.jfrog.io' }, bin);
    assert.match(
      httpOnly,
      /mcp\s+jfrog -> http:\/\/my\.jfrog\.io\/mcp \(OAuth, workspace scope\)/,
      'an explicit http scheme must be preserved, not upgraded to https'
    );

    const withUserinfo = runBootstrap({ JFROG_PLATFORM_URL: 'http://user:pass@my.jfrog.io' }, bin);
    assert.doesNotMatch(withUserinfo, /jfrog -> /, 'a host with embedded userinfo must be rejected, not passed to kiro-cli');
    assert.match(withUserinfo, /not a valid host/);

    const emptyHost = runBootstrap({ JFROG_PLATFORM_URL: 'https://' }, bin);
    assert.doesNotMatch(emptyHost, /jfrog -> /, 'an empty host must be rejected');
  });
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

// The guard also had a blind spot: it checked cross-skill scripts/<x> pointers but never an own-skill
// one, so a future skill whose script pointer slips past rewriteScriptPointers() would ship a dead path
// with no build failure to catch it. It must still accept the correctly-rewritten ~/.kiro/jfrog-scripts/
// path (which itself contains "scripts/") without false-positiving on that.
test('assertNoDeadRefPointers throws on a residual own-skill scripts/<x> pointer, passes the rewritten path', () => {
  assert.throws(
    () => assertNoDeadRefPointers('jfrog.md', 'run `scripts/check-environment.sh`'),
    /unrewritten reference pointer/
  );
  assert.throws(
    () => assertNoDeadRefPointers('jfrog.md', 'run `<skill_path>/scripts/check-environment.sh`'),
    /unrewritten reference pointer/
  );
  assert.doesNotThrow(() =>
    assertNoDeadRefPointers('jfrog.md', 'run `~/.kiro/jfrog-scripts/jfrog/check-environment.sh`')
  );
});

// Every generated file carries the GEN marker verbatim, which itself contains the literal substring
// "scripts/gen-steering.mjs" (this build tool's own path) — the own-skill scripts/<x> check above must
// not false-positive on that.
test('assertNoDeadRefPointers does not false-positive on the GEN marker\'s own scripts/gen-steering.mjs mention', () => {
  assert.doesNotThrow(() =>
    assertNoDeadRefPointers(
      'jfrog.md',
      '<!-- GENERATED by scripts/gen-steering.mjs from skills/ — do not edit by hand. -->\nclean body'
    )
  );
});

// gen-steering's pointer regexes also match a BARE (non-backticked) path, so a plain markdown link where
// the label and target are identical (common in upstream skill prose, e.g.
// `[references/x.md](references/x.md)`) would otherwise have both halves rewritten independently,
// producing a broken pseudo-link like `[the "x" section](the "x" section)`. collapseSelfReferentialLinks
// must run first to fold that down to a single mention before the pointer rewrites see it.
test('collapseSelfReferentialLinks folds a self-referential markdown link into one bare mention', () => {
  assert.equal(
    collapseSelfReferentialLinks('[references/x.md](references/x.md)'),
    'references/x.md'
  );
  const withRewrite = rewriteRefPointers(
    collapseSelfReferentialLinks('see [references/discovering-skills.md](references/discovering-skills.md)'),
    'jfrog-ai-catalog-skills'
  );
  assert.match(withRewrite, /`discovering-skills` section of the `#jfrog-ai-catalog-skills-references` steering/);
  // exactly one occurrence — not duplicated into a broken [text](text) pseudo-link
  assert.equal(withRewrite.match(/discovering-skills/g).length, 1);
});

test('collapseSelfReferentialLinks leaves a link with a differing label untouched', () => {
  const text = '[environment check](../jfrog/SKILL.md#environment-check)';
  assert.equal(collapseSelfReferentialLinks(text), text);
});

// The label and target don't have to agree on backtick style to mean the same pointer — this is the
// exact real-world shape found in skills/jfrog-ai-catalog-skills/SKILL.md.
test('collapseSelfReferentialLinks folds a link whose label is backticked but target is not', () => {
  const out = collapseSelfReferentialLinks('[`../jfrog/SKILL.md`](../jfrog/SKILL.md)');
  assert.equal(out, '`../jfrog/SKILL.md`');
  const rewritten = rewriteRefPointers(out, 'jfrog-ai-catalog-skills');
  assert.match(rewritten, /^the `#jfrog` steering$/, 'collapses to a single clean mention, not a duplicated pseudo-link');
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

// A bare `scripts/<file>` mention embedded inside an UNRELATED path (e.g. skill prose describing some
// other tool's directory layout) must be left untouched — it has nothing to do with this skill's own
// scripts/ dir, and rewriting it produces a nonsense mixed path like
// `modules/package-resolution/~/.kiro/jfrog-scripts/<name>/print-policy.mjs`.
test('rewriteScriptPointers leaves an unrelated embedded scripts/<file> path untouched', () => {
  const text = 'renderer is available on demand via `modules/package-resolution/scripts/print-policy.mjs`';
  assert.equal(rewriteScriptPointers(text, 'jfrog-setup-package-managers'), text);
});

// Same case as above, but with a hyphen immediately before `scripts/` instead of a slash (e.g. a
// `build-scripts/` directory some other tool uses) — a narrower gap in the same guard.
test('rewriteScriptPointers leaves a hyphen-adjacent unrelated scripts/<file> path untouched', () => {
  const text = 'see `build-scripts/print-policy.mjs` for details';
  assert.equal(rewriteScriptPointers(text, 'jfrog-setup-package-managers'), text);
});

test('rewriteScriptPointers redirects a cross-skill scripts/<file> to the OTHER skill\'s install path', () => {
  const out = rewriteScriptPointers(
    'mirrors `../../jfrog/scripts/check-environment.sh` detect_harness()',
    'jfrog-mcp-management'
  );
  assert.equal(out, 'mirrors `~/.kiro/jfrog-scripts/jfrog/check-environment.sh` detect_harness()');
});

// syncPin's prose rule must only touch a backticked semver that's explicitly called out as "the pinned
// version" — not any backticked vX.Y.Z-shaped string in the file. Otherwise an unrelated version mention
// added later (a kiro-cli tag, a jf CLI minimum version) would be silently overwritten on the next pin bump.
test('syncPin only rewrites a backticked semver anchored by "pinned version", not an unrelated one', () => {
  const text =
    'fetched from the same pinned version (`v0.19.0`) into place. ' +
    'Requires jf CLI `v2.100.0` or later — unrelated to the skills pin.';
  const out = syncPin(text, 'jfrog/jfrog-skills', 'v0.20.0');
  assert.match(out, /pinned version \(`v0\.20\.0`\)/, 'the anchored pin is updated');
  assert.match(out, /jf CLI `v2\.100\.0`/, 'an unrelated backticked semver elsewhere is left untouched');
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

// --- scripts/lib/targz.mjs — extractTarToDir handles untrusted, network-fetched archive content, so its
// path-traversal guard and symlink handling need direct regression coverage, not just "it currently looks
// right on inspection". Build minimal USTAR blocks by hand rather than depending on a real tarball.
function tarHeader({ name, size = 0, typeflag = '0', mode = 0o644 }) {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 'utf8');
  buf.write(mode.toString(8).padStart(7, '0') + '\0', 100, 'utf8');
  buf.write('0000000\0', 108, 'utf8'); // uid
  buf.write('0000000\0', 116, 'utf8'); // gid
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
  buf.write('00000000000\0', 136, 'utf8'); // mtime
  buf.write('        ', 148, 'utf8'); // chksum placeholder: 8 spaces, per the tar spec
  buf.write(typeflag, 156, 'utf8');
  buf.write('ustar\0', 257, 'utf8');
  buf.write('00', 263, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8');
  return buf;
}

function buildTar(entries) {
  const blocks = [];
  for (const e of entries) {
    const data = e.data ? Buffer.from(e.data, 'utf8') : Buffer.alloc(0);
    blocks.push(tarHeader({ name: e.name, size: data.length, typeflag: e.typeflag }));
    if (data.length) {
      const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
      data.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(1024)); // two all-zero blocks mark end-of-archive
  return Buffer.concat(blocks);
}

test('extractTarToDir extracts nested files and returns the single top-level dir', async () => {
  const destDir = mkdtempSync(join(tmpdir(), 'targz-happy-'));
  const tar = buildTar([{ name: 'repo-v1/skills/jfrog/SKILL.md', data: '# jfrog' }]);

  const top = await extractTarToDir(tar, destDir);

  assert.equal(top, join(destDir, 'repo-v1'));
  assert.equal(readFileSync(join(top, 'skills', 'jfrog', 'SKILL.md'), 'utf8'), '# jfrog');
});

// The tar-slip guard: an archive entry whose name resolves outside destDir via `..` must be skipped
// entirely, never written to disk outside the destination — this is the one module in the repo that
// writes untrusted, network-fetched content to a real filesystem path.
test('extractTarToDir refuses to write an entry that escapes destDir via ../ (path traversal)', async () => {
  const destDir = mkdtempSync(join(tmpdir(), 'targz-traversal-'));
  const tar = buildTar([
    { name: 'good/file.txt', data: 'ok' },
    { name: '../evil.txt', data: 'pwned' },
    { name: '../../also-evil.txt', data: 'pwned' },
  ]);

  await extractTarToDir(tar, destDir);

  assert.equal(readFileSync(join(destDir, 'good', 'file.txt'), 'utf8'), 'ok', 'legitimate entry still lands');
  assert.ok(!existsSync(join(destDir, '..', 'evil.txt')), 'entry escaping via ../ must not be written');
  assert.ok(!existsSync(join(destDir, '..', '..', 'also-evil.txt')), 'entry escaping via ../../ must not be written');
});

test('extractTarToDir skips symlink entries instead of following or recreating them', async () => {
  const destDir = mkdtempSync(join(tmpdir(), 'targz-symlink-'));
  const tar = buildTar([
    { name: 'evil-link', typeflag: '2' }, // typeflag '2' = symlink; linkname/target is irrelevant here
    { name: 'real-file.txt', data: 'ok' },
  ]);

  await extractTarToDir(tar, destDir);

  assert.ok(!existsSync(join(destDir, 'evil-link')), 'symlink entry is not materialized on disk');
  assert.equal(readFileSync(join(destDir, 'real-file.txt'), 'utf8'), 'ok', 'subsequent regular entry still lands');
});

// fetchTarGz runs unconditionally on every CI push/PR and release tag (the vendoring drift check), with
// no path filter — so a transient network blip must not fail an unrelated PR or block a release outright.
// Mock global fetch rather than hitting the real network; retryDelayMs: 0 keeps these tests instant.
function withMockFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = real;
  });
}

test('fetchTarGz retries a transient network error and succeeds once the fetch recovers', async () => {
  let calls = 0;
  await withMockFetch(async () => {
    calls++;
    if (calls < 3) throw new Error('ECONNRESET');
    return { ok: true, status: 200, arrayBuffer: async () => gzipSync(Buffer.from('tar-bytes')) };
  }, async () => {
    const { tar } = await fetchTarGz('jfrog/jfrog-skills', 'v1.0.0', { retryDelayMs: 0 });
    assert.equal(tar.toString(), 'tar-bytes');
    assert.equal(calls, 3, 'failed twice, succeeded on the third attempt');
  });
});

test('fetchTarGz retries a 500 response, then gives up after exhausting retries', async () => {
  let calls = 0;
  await withMockFetch(async () => {
    calls++;
    return { ok: false, status: 500 };
  }, async () => {
    await assert.rejects(
      () => fetchTarGz('jfrog/jfrog-skills', 'v1.0.0', { retries: 2, retryDelayMs: 0 }),
      /HTTP 500/
    );
    assert.equal(calls, 3, 'the initial attempt plus 2 retries, then it gives up');
  });
});

test('fetchTarGz fails immediately on a 404 instead of retrying a config error', async () => {
  let calls = 0;
  await withMockFetch(async () => {
    calls++;
    return { ok: false, status: 404 };
  }, async () => {
    await assert.rejects(
      () => fetchTarGz('jfrog/does-not-exist', 'v1.0.0', { retries: 3, retryDelayMs: 0 }),
      /HTTP 404/
    );
    assert.equal(calls, 1, 'a 404 means the repo/ref is wrong, so it does not retry');
  });
});
