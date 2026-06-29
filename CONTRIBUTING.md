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

## Releasing

Releases are automated by `.github/workflows/release.yml`. To cut a release, push (or merge) a commit to `main` whose message contains `[major]`, `[minor]`, or `[patch]`:

- `[patch]` — bug fixes; bumps `X.Y.Z` → `X.Y.Z+1`
- `[minor]` — new features; bumps `X.Y.Z` → `X.Y+1.0`
- `[major]` — breaking changes; bumps `X.Y.Z` → `X+1.0.0`

The workflow:
1. Bumps the `VERSION` file
2. Commits and pushes the bump to `main`
3. Creates a `vX.Y.Z` git tag
4. Publishes a GitHub Release with a repo zip attached

**Prerequisite:** `github-actions[bot]` must be allowed to push to `main`. In the repository's branch protection (or ruleset) settings, add `github-actions[bot]` to the bypass list.

## Security issues

If you discover a security vulnerability, please do **not** open a public issue.
Follow [JFrog's responsible disclosure process](https://jfrog.com/trust/report-vulnerability/) (or contact your JFrog security point-of-contact).

## License

By contributing, you agree that your contributions will be licensed under the project license (Apache-2.0).
