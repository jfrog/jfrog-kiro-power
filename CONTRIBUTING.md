# Contributing

Thanks for your interest in contributing to **JFrog Kiro Power**.

## Before you contribute

### 1) Sign the JFrog Contributor License Agreement (CLA)

All contributions require a signed CLA.

- JFrog CLA: https://jfrog.com/cla/

Our GitHub checks will guide you through the signing process on your first pull request.

## How to contribute

### Reporting issues

- Use GitHub Issues to report bugs or request enhancements.
- Include clear reproduction steps, expected vs actual behavior, and any relevant logs or screenshots.

### Submitting pull requests

1. Fork the repo and create a feature branch.
2. Make your change with a clear, focused scope.
3. Update documentation as needed (README/POWER docs).
4. Open a pull request with:
   - What changed and why
   - How you tested (or why no test applies)

## Testing local changes

The power ships JFrog knowledge as `steering/` files, **generated from the embedded `skills/` tree**. Two
things to know before testing.

### Local folder import ≠ GitHub install

Kiro adds a power in two ways, and they are not equivalent:

- **Local folder import** (Powers → Add Custom Power → *Import from a folder*): Kiro references the power
  **in place** from your path. It does **not** copy files into `~/.kiro/powers/installed/`, so the
  `kiro_powers` activation tool fails with "Power not installed" — this is **expected** for local imports,
  not a bug. Use this mode for **fast iteration**.
- **GitHub install** (Import from GitHub): Kiro **copies** `POWER.md` + `steering/` into
  `~/.kiro/powers/installed/jfrog/`, and activation works. Use this for **production-style testing**.

### Iterating on steering without a full install

1. Add the power via *Import from a folder* pointed at your checkout.
2. In a Kiro chat, load the steering manually: `#jfrog` (foundational) or `#jfrog-references` (deep
   API/AQL). This uses the exact content the power ships.
3. Edit `steering/` (or the generators — see below), reload Kiro, and re-test with `#jfrog`.
4. Before opening a PR, do a **GitHub install from your fork** to confirm activation works end-to-end.

Optional local dev workaround to make `kiro_powers` activation work without GitHub — stage the installed
dir to mirror a GitHub install:

```bash
mkdir -p ~/.kiro/powers/installed/jfrog
cp POWER.md ~/.kiro/powers/installed/jfrog/
rm -rf ~/.kiro/powers/installed/jfrog/steering && cp -R steering ~/.kiro/powers/installed/jfrog/
# then fully quit & reopen Kiro
```

### Changing skills or steering

- **Do not hand-edit `skills/`** — it is vendored byte-for-byte from
  [`jfrog/jfrog-skills`](https://github.com/jfrog/jfrog-skills) at a pinned tag (parity with the other
  JFrog agent plugins). To change skill content, bump the pin (see [VENDOR.md](./VENDOR.md)).
- **Do not hand-edit `steering/`** — it is generated. Run `npm run gen-steering` and commit the result.
- After any pin bump: `npm run sync-skills && npm run gen-steering`, then commit both `skills/` and
  `steering/`.
- Before pushing: `npm test` and `npm run validate` must pass; `npm run verify-install` checks your
  local `jf` CLI + server prerequisites.

## Security issues

If you discover a security vulnerability, please do **not** open a public issue.
Follow [JFrog’s responsible disclosure process](https://jfrog.com/trust/report-vulnerability/) (or contact your JFrog security point-of-contact).

## License

By contributing, you agree that your contributions will be licensed under the project license (Apache-2.0).
