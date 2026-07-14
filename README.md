# JFrog for Kiro

This repository holds the JFrog integration for Kiro's **two** surfaces, both driven by the same
vendored JFrog [Agent Skills](https://kiro.dev/docs/skills/):

- **IDE Power** — for the Kiro **IDE** (Powers panel). Ships `POWER.md` + `steering/`.
- **CLI** — for **`kiro-cli`** (the terminal agent). Installs the JFrog skills + steering into `~/.kiro/`
  so JFrog composes into any session (additive, like the IDE).

Both enable AI-assisted JFrog Platform workflows — searching artifacts, managing repositories, handling
users/groups, setting up projects, checking package safety, and querying security metadata.

> **Phase 1 — skills only.** Both surfaces ship the JFrog skill knowledge and drive the platform through
> the `jf` CLI. The JFrog remote **MCP server** and **Agent Guard** arrive in later phases.

## How skills are delivered on Kiro

A Kiro Power packages `POWER.md` + `mcp.json` + `steering/` — it **cannot** bundle a `skills/` directory.
So the canonical JFrog skills are delivered two ways:

1. **Bundled steering (default, no fetch).** The skills are **embedded** in this repo under `skills/`
   (vendored and pinned from [`jfrog/jfrog-skills`](https://github.com/jfrog/jfrog-skills)) and rendered
   into `steering/` files that ship *inside* the power. On install, Kiro loads them automatically — the
   knowledge works immediately, offline, with no download. Deep reference material is bundled as
   `#jfrog-references` / `#jfrog-ai-catalog-skills-references` (the render redirects there instead of the
   on-disk `references/*.md` files a power can't carry).
2. **Real Agent Skills (optional).** The bundled steering carries knowledge only — a power can't bundle a
   skill's **runnable helper scripts** or `/`-invoke. If you want those, an optional onboarding step
   installs the real skills into `.kiro/skills/` from the same pinned version. This is the only step that
   touches the network.

Everything ships pinned and reproducible for a given power version; see [VENDOR.md](./VENDOR.md).

### The three skills

- **`jfrog`** — interact with the JFrog Platform via the JFrog CLI and REST/GraphQL APIs (Artifactory,
  Xray, builds, permissions, projects, release lifecycle, advanced security, and more).
- **`jfrog-package-safety-and-download`** — check package safety/curation status and download packages
  through JFrog.
- **`jfrog-ai-catalog-skills`** — discover, install, manage, and publish agent skills hosted in the JFrog
  AI Catalog via `jf skills`.

## Installing

### 1. Install the JFrog CLI (v2.100.0+)

```bash
# macOS
brew install jfrog-cli
# Linux
curl -fL https://install-cli.jfrog.io | sh
```

Configure it for your JFrog instance (`<server-id>` is a local name you choose):

```bash
jf config add <server-id> \
  --url=https://YOUR_JFROG_PLATFORM_URL \
  --access-token=YOUR_TOKEN \
  --interactive=false

jf config use <server-id>
```

Generate a token from `https://<your-platform>/ui/admin/configuration/security/access_tokens`.

### 2. Install the power in Kiro

1. Open Kiro and click the **Powers** icon in the sidebar
2. Click **Add Custom Power** → **Import power from GitHub**
3. Enter the repository URL: `https://github.com/jfrog/jfrog-kiro-power`
4. Hit **enter**

The JFrog steering ships with the power and loads automatically — nothing else is required to start using
it.

> **Smoothest activation:** install from **GitHub** rather than a local folder. Kiro copies the power's
> `POWER.md` + `steering/` into `~/.kiro/powers/installed/jfrog/`, so the agent reliably activates it.
> A local **folder** import is referenced in place and may not populate `installed/`, which can prevent
> activation — see [Troubleshooting Installation](POWER.md#troubleshooting-installation) in POWER.md.

Verify your prerequisites (JFrog CLI ≥ 2.100.0 and a configured server):

```bash
npm run verify-install                 # macOS/Linux
pwsh scripts/verify-install.ps1        # Windows
```

### 3. (Optional) Install the real Agent Skills

Only if you want the skills in Kiro's skill UI / `/`-invoke.

**Preferred — from a checkout of this repo (cross-platform, dependency-free, no external `tar`/`curl`):**

```bash
npm run install-skills            # into ./.kiro/skills  (this workspace)
npm run install-skills -- --global # into ~/.kiro/skills  (all workspaces)
```

**Without this repo — self-contained (also in POWER.md → Onboarding):**

*macOS / Linux:*

```bash
TMP="$(mktemp -d)"
curl -fsSL https://codeload.github.com/jfrog/jfrog-skills/tar.gz/v0.16.0 | tar -xz -C "$TMP"
mkdir -p .kiro/skills && cp -R "$TMP"/jfrog-skills-*/skills/* .kiro/skills/ && rm -rf "$TMP"
```

*Windows (PowerShell — `.zip` + built-in `Expand-Archive`, no `tar` needed):*

```powershell
$tmp = Join-Path $env:TEMP ([guid]::NewGuid()); New-Item -ItemType Directory -Force $tmp | Out-Null
Invoke-WebRequest https://codeload.github.com/jfrog/jfrog-skills/zip/v0.16.0 -OutFile "$tmp\s.zip"
Expand-Archive "$tmp\s.zip" -DestinationPath $tmp -Force
New-Item -ItemType Directory -Force .kiro\skills | Out-Null
Copy-Item "$tmp\jfrog-skills-*\skills\*" .kiro\skills\ -Recurse -Force; Remove-Item $tmp -Recurse -Force
```

## Authentication

Once `jf config` is set up (step 1), the JFrog CLI handles auth for all `jf` subcommands and `jf api`
calls automatically — no environment variables or `.env` file required.

## Testing

Once installed, open a new agent chat in Kiro and try:

- *"Search for artifacts named myapp in Artifactory"*
- *"Is lodash 4.17.21 safe to use, and download it through JFrog"*
- *"Create a project called myteam with npm repositories"*
- *"Show me the Xray scan results for this artifact"*

## JFrog for the CLI (`kiro-cli`)

`kiro-cli` (the terminal agent) is a **separate runtime** from the IDE — it does not read
`~/.kiro/powers/`, so it can't consume the IDE power. Its **additive** mechanism is skills
(`~/.kiro/skills/`) + global steering (`~/.kiro/steering/`): the default agent auto-loads both, so JFrog
**composes into any session** — the default agent, or your own custom agent (which inherits default
skills/steering). This mirrors the IDE, where many powers compose in one session.

> **Additive, not a replacement.** A `kiro-cli --agent` is *singular per session*, so the install never
> registers JFrog as "the agent" (that would replace your own). It only adds the JFrog skills + steering,
> so `kiro-cli chat` composes JFrog alongside whatever else you use.

**Easiest — one command, no checkout:**

```bash
curl -fsSL https://raw.githubusercontent.com/jfrog/jfrog-kiro-power/align-with-fleet/scripts/bootstrap-cli.sh | bash
```

**From a checkout of this repo (equivalent):**

```bash
npm run install-cli                  # additive: skills + steering -> ~/.kiro (global)
npm run install-cli -- --workspace   # scope into ./.kiro instead
```

Both copy the embedded JFrog skills into `~/.kiro/skills/` (knowledge + helper scripts) **and** the JFrog
steering into `~/.kiro/steering/`. Installs are **idempotent** — re-running produces identical files and
never touches steering files this repo doesn't own. Offline/local bootstrap:
`KIRO_POWER_SRC=<checkout> bash scripts/bootstrap-cli.sh`.

Use it — no `--agent` needed:

```bash
kiro-cli chat            # then just ask a JFrog question ("How many repositories are in Artifactory?")
```

JFrog work runs through the **`jf` CLI** (never `curl`). For headless/CI runs, trust the shell tool:
`kiro-cli chat --no-interactive --trust-tools=execute_bash "…"`.

> **`shell` vs `execute_bash`:** they name the same tool — the runtime id used by `--trust-tools` is
> `execute_bash`; some configs use the friendly alias `shell`. Different spellings, same capability.

**Uninstall:** `rm -f ~/.kiro/steering/jfrog*.md` and `rm -rf ~/.kiro/skills/jfrog*` (every JFrog steering
file and skill dir is `jfrog*`-prefixed, so this leaves any of your own files untouched).

> Phase 1 = skills only (no MCP), matching the IDE power.

## Development

### Local folder import vs. GitHub install

Kiro can add this power two ways, and they behave differently — this matters when developing:

| | **Local folder import** (Add Custom Power → *Import from a folder*) | **GitHub install** (Import from GitHub) |
|---|---|---|
| Where files live | referenced **in place** from your repo path | **copied** into `~/.kiro/powers/installed/jfrog/` |
| `~/.kiro/powers/installed/` populated? | ❌ no | ✅ yes |
| `kiro_powers` activation tool | ❌ fails ("Power not installed") | ✅ works |
| Best for | **fast local iteration** on `POWER.md` / `steering/` | **production-style testing** and real users |

**Key point:** a local folder import is for **development/iteration only**. Because it isn't copied into
`installed/`, the `kiro_powers` activation tool fails — that is **expected**, not a bug in the power.

**Iterating on steering locally** without a full install: in a chat, load the steering manually with
`#jfrog` (foundational) or `#jfrog-references` (deep API/AQL), verify your change, edit the files, and
reload Kiro. This exercises the exact steering content the power ships.

**For real testing / users:** install from **GitHub** so Kiro copies the assets into `installed/` and
activation works reliably. See [Troubleshooting Installation](POWER.md#troubleshooting-installation).

### Build tasks

> The skills are **embedded** in this repo (`skills/`) and rendered into the shipped `steering/`. Users
> never fetch to use the power — the steering is bundled. The `sync-skills` and `gen-steering` tasks are
> **maintainer/CI build-time** tools.

- `npm run sync-skills` — (maintainers) re-vendor the embedded skills from `jfrog/jfrog-skills` at the
  pinned tag (see [VENDOR.md](./VENDOR.md))
- `npm run gen-steering` — (maintainers) regenerate `steering/` from the embedded `skills/`
- `npm run install-skills` — install the JFrog Agent Skills into `.kiro/skills` (`--global` for `~/.kiro/skills`)
- `npm run install-cli` — additive install of the JFrog skills + steering for `kiro-cli`
  (see [JFrog for the CLI](#jfrog-for-the-cli-kiro-cli))
- `npm run verify-install` — check prerequisites (`jf` CLI ≥ 2.100.0 + a configured server); Windows:
  `pwsh scripts/verify-install.ps1`
- `npm run validate` — lint skill frontmatter, POWER.md, and steering
- `npm test` — run the validator unit tests

> After bumping the pin: run `npm run sync-skills` **and** `npm run gen-steering`, then commit both
> `skills/` and `steering/`.

## Contributing

Contributions are welcome! See [CONTRIBUTING](CONTRIBUTING.md).

## License and Support

- Licensed under the [Apache License 2.0](LICENSE).
- Get support by opening an issue in this repository or reaching out to support@jfrog.com.
