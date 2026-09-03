# JFrog Plugin for Kiro

JFrog plugin for [Kiro](https://kiro.dev): artifact management, security scanning, supply-chain best practices, and Agent Guard.

Works in both the **Kiro IDE** (as a Power) and **`kiro-cli`** (as additive skills). One install flow covers both.

## Skills

| Skill | Description |
| --- | --- |
| `jfrog` | JFrog Platform operations via CLI and APIs (Artifactory, Xray, access, projects, and more). |
| `jfrog-init` | Plugin readiness / setup (detect CLI, config, MCP, and related bootstrap steps). |
| `jfrog-mcp-management` | Install, list, and remove MCP servers through JFrog Agent Guard; browse the JFrog MCP catalog. |
| `jfrog-ai-catalog-skills` | Discover, install, manage, and publish agent skills from the JFrog AI Catalog via `jf skills`. |
| `jfrog-setup-package-managers` | Bind package managers (npm, pip, Maven, Go, and more) to JFrog Artifactory via `jf setup`. |
| `jfrog-reference-architecture` | JFrog Platform topology, sizing, deployment patterns, and multi-site guidance. |
| `jfrog-package-safety-and-download` | Check package safety and download via Artifactory. |

After install, use them as `/jfrog`, `/jfrog-init`, etc. in the IDE or `kiro-cli`.

Skill content is vendored under `skills/` — see [VENDOR.md](VENDOR.md).

## JFrog MCP

The plugin registers a remote JFrog MCP server pre-wired at `https://${JFROG_PLATFORM_URL}/mcp` (OAuth, no API keys). Set `JFROG_PLATFORM_URL` to your platform host and the connection is automatic on first use.

---

Before installing, make sure you have:

- **Kiro** — IDE installed from [kiro.dev](https://kiro.dev), and/or `kiro-cli` for terminal use.
- **JFrog CLI** (≥ 2.100.0) — with a configured server (`jf config add`). See [Authentication](#authentication).
- **`JFROG_PLATFORM_URL`** — environment variable set to your JFrog platform host only (e.g. `mycompany.jfrog.io`). Required for the MCP server entry.
- **Skill runtime requirements** — `jf` CLI, `jq`, and `curl` on `PATH`. For minimum versions, see the upstream skills [Requirements](https://github.com/jfrog/jfrog-skills).

---

## Installation

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

### 2. Install the Power in Kiro IDE

1. Open Kiro and click the **Powers** icon in the sidebar
2. Click **Add Custom Power** → **Import power from GitHub**
3. Enter the repository URL: `https://github.com/jfrog/jfrog-kiro-power`

The Power ships `POWER.md` + `mcp.json` + `steering/`. Steering loads automatically and provides JFrog knowledge via natural language.

> **Install from GitHub** rather than a local folder. Kiro copies the Power into
> `~/.kiro/powers/installed/jfrog-kiro-power/`, which is required for reliable activation.

4. **Install the JFrog skills** — the Power provides knowledge but does not register `/jfrog` slash commands. Those come from **skills**. Open a terminal and run (macOS / Linux):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/jfrog/jfrog-kiro-power/main/scripts/bootstrap-cli.sh | bash
   ```

   This copies skills into `~/.kiro/skills/` (read by both IDE and `kiro-cli`). Windows: clone this repo and run `npm run install-cli` instead.

5. **Run `/jfrog-init`** in a Kiro chat — it checks CLI, server config, and MCP registration, and walks you through anything missing. Restart Kiro afterwards so the MCP entry reloads.

### Notes

> **`kiro-cli` users:** to avoid loading JFrog twice when using both IDE and CLI, give the CLI its own
> profile: `KIRO_HOME=~/.kiro-cli curl -fsSL ... | bash`, or scope to a workspace: `| bash -s -- --workspace`.

> **Helper scripts (on demand).** The bootstrap copies skills including their `scripts/` subdirectories.
> If you installed the Power without step 4, some requests that need a runnable helper script
> (login, environment-check) will fetch just the scripts on demand into `~/.kiro/jfrog-scripts/`.
> This is automatic — if the fetch fails (offline), it retries next time. Manual install from a
> checkout of this repo:
>
> ```bash
> npm run install-scripts                # -> ~/.kiro/jfrog-scripts   (global)
> npm run install-scripts -- --workspace # -> ./.kiro/jfrog-scripts   (this workspace)
> ```

---

## Using `kiro-cli`

`kiro-cli` is a **separate application** from the Kiro IDE — install it from [kiro.dev](https://kiro.dev).

1. **Install the JFrog skills** (skip if already done during [IDE setup](#2-install-the-power-in-kiro-ide)):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/jfrog/jfrog-kiro-power/main/scripts/bootstrap-cli.sh | bash
   ```

2. **Start a session** — no `--agent` flag needed, the install is additive:

   ```bash
   kiro-cli chat
   ```

For headless/CI runs:

```bash
kiro-cli chat --no-interactive --trust-tools=execute_bash "List my Artifactory repositories"
```

If you use both the IDE and `kiro-cli`, give the CLI its own profile (`KIRO_HOME=~/.kiro-cli`) to avoid loading JFrog from both steering and skills — see the [install notes](#notes).

---

## Verify

Verification is a required install step, not a troubleshooting fallback:

1. `/jfrog-init` — the readiness walk completes without blocking errors (checks CLI, server, MCP).
2. **Powers panel** (IDE) — `jfrog-kiro-power` is listed.
3. **Slash commands** (IDE or `kiro-cli`) — type `/jfrog` and confirm the JFrog skills appear.
4. **MCP** — Kiro connects to the JFrog MCP server (OAuth sign-in on first use).

If any check fails, see [Recovery](#recovery).

---

## Recovery

| Symptom | Do this | Do **not** do this |
| --- | --- | --- |
| No `/jfrog` slash commands in IDE | Run the [bootstrap one-liner](#2-install-the-power-in-kiro-ide) (step 4) to install skills into `~/.kiro/skills/`, then reload Kiro. | Assume the Power alone provides `/`-invoke — it ships steering only. |
| `/jfrog-init` stopped at CLI/auth | Follow the skill prompt (`jf config add`, web login, or token path), then **re-run `/jfrog-init`**. | Skip init and only export env vars. |
| MCP missing after install | Confirm `JFROG_PLATFORM_URL` is set to host only (no `https://`, no trailing `/`), re-run `/jfrog-init`, **restart Kiro**. | Set env vars mid-session and expect MCP to appear. |
| Power not activating | Reinstall from **GitHub** (not local folder). Local imports reference in place and may not populate `installed/`. | Debug a local-folder import in production. |

---

## Authentication

Configure the JFrog CLI so the skills can reach your platform:

```bash
jf login              # browser-based setup
# or
jf config add         # interactive prompts for URL + token
```

The MCP server uses **OAuth** — Kiro opens a browser sign-in on first use and caches the session. No bearer token or `.env` file is needed.

---

## Usage

Once configured, interact with the JFrog plugin through natural language. Examples are grouped by capability.

### JFrog Platform skill

| Ask the agent… | What happens |
| --- | --- |
| "List my Artifactory repositories." | Returns repositories via the JFrog CLI. |
| "Upload this build to Artifactory." | Publishes build artifacts and metadata. |
| "Run a security audit on this project." | Runs an Xray / Advanced Security audit and summarizes findings. |
| "Show me details on CVE-2021-23337." | Looks up CVE details in JFrog Advanced Security. |
| "Create a scoped access token for CI." | Creates an access token with the requested scope. |
| "Promote this release bundle to production." | Uses Lifecycle / Distribution APIs to promote the bundle. |

### Package curation skill

| Ask the agent… | What happens |
| --- | --- |
| "Is `lodash@4.17.21` safe to install?" | Checks JFrog Public Catalog signals and curation policy for the package. |
| "Is this Maven package approved for use?" | Checks curation entitlement and policy for the requested package. |
| "Download `requests` via JFrog." | Resolves the package through an Artifactory remote cache or curation-aware package manager. |

### MCP server management (Agent Guard)

| Ask the agent… | What happens |
| --- | --- |
| "Which MCP servers can I install?" | Returns all MCP servers approved for your current project. |
| "What MCP servers do I already have?" | Returns only the MCP servers already installed on your machine. |
| "Add the GitHub MCP server." | Installs an approved MCP server and syncs its tool policies locally. |
| "Remove the Slack MCP server." | Removes the server and its stored credentials from your local setup. |

---

## Uninstall

```bash
rm -rf ~/.kiro/skills/jfrog*
```

Every JFrog skill dir is `jfrog*`-prefixed, so this leaves your other skills untouched. If you installed with a custom `KIRO_HOME`, use `rm -rf "$KIRO_HOME/skills/jfrog*"` instead.

---

## Troubleshooting

See the [JFrog MCP Registry troubleshooting guide](https://docs.jfrog.com/ai-ml/docs/mcp-registry-troubleshooting).

---

## Development

### Build tasks

The skills are embedded in this repo (`skills/`) and rendered into `steering/`. Users never fetch to use the power — the steering is bundled. These tasks are for **maintainers**:

- `npm run sync-skills` — re-vendor skills from `jfrog/jfrog-skills` at the pinned tag (see [VENDOR.md](./VENDOR.md))
- `npm run gen-steering` — regenerate `steering/` from the embedded `skills/`
- `npm run install-scripts` — install JFrog helper scripts into `~/.kiro/jfrog-scripts`
- `npm run install-cli` — additive install of JFrog skills (equivalent to the bootstrap one-liner)
- `npm run verify-install` — check prerequisites (`jf` CLI ≥ 2.100.0 + a configured server)
- `npm run validate` — lint skill frontmatter, POWER.md, and steering
- `npm test` — run the validator unit tests

> After bumping the pin: run `npm run sync-skills` **and** `npm run gen-steering`, then commit both
> `skills/` and `steering/`.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and pull-request expectations.

## License

Licensed under the [Apache License 2.0](LICENSE).

- [Privacy Policy](https://jfrog.com/privacy-notice/)
- [Support](https://jfrog.com/support/)
