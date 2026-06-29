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

To cut a release:

1. In your PR, bump the `VERSION` file to the new version (e.g. `0.1.1`).
2. Merge to `main` with `[major]`, `[minor]`, or `[patch]` anywhere in the commit message.

The release workflow then reads `VERSION`, creates a `vX.Y.Z` git tag, and publishes a GitHub Release with a repo zip attached. No bot push to `main` — the version bump is part of the PR itself.

## Security issues

If you discover a security vulnerability, please do **not** open a public issue.
Follow [JFrog's responsible disclosure process](https://jfrog.com/trust/report-vulnerability/) (or contact your JFrog security point-of-contact).

## License

By contributing, you agree that your contributions will be licensed under the project license (Apache-2.0).
