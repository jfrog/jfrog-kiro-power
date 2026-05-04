---
name: "JFrog"
displayName: "JFrog Platform"
description: "Work with the JFrog Platform to manage Artifactory repositories, artifacts, users, groups, and projects. Uses the JFrog MCP server when connected, and the JFrog CLI (jf api) for operations not covered by MCP or when MCP is unavailable."
keywords: ["jfrog", "artifactory", "artifact", "repository", "xray", "devops", "binary-management"]
author: "JFrog"
---

# JFrog Platform

> ⚠️ **Setup required before first use**
>
> Edit `mcp.json` and replace `YOUR_JFROG_PLATFORM_URL` with your JFrog Platform hostname (e.g. `mycompany.jfrog.io`).
> See the [MCP Config Placeholders](#mcp-config-placeholders) section below for details.

## Overview

The JFrog Platform is the universal binary management and DevSecOps solution used by developers, DevOps engineers, platform administrators, and security engineers to manage software artifacts across the entire SDLC.

This power enables AI-assisted workflows on the JFrog Platform — searching artifacts, managing repositories, handling users and groups, setting up projects, and querying security metadata. It uses the **JFrog MCP server** when connected, and falls back to the **JFrog CLI `jf api`** (v2.100.0+) for REST API calls not covered by MCP.

All HTTP traffic to JFrog Platform APIs goes through the `jf` CLI (`jf api`) — no standalone `curl` is required or used for any JFrog interaction.

Current scope: **Artifactory** (users, groups, projects, repositories, artifacts). Xray security metadata is included where available on artifacts.

## Available Steering Files

- **artifactory-search** — Searching artifacts, users, groups, and projects (AQL, REST API patterns)
- **artifactory-artifacts** — Uploading, downloading, and querying artifact metadata including Xray scan results
- **artifactory-admin** — Creating projects, repositories, users, groups, and managing memberships

## Tool Selection Strategy

Use tools in this priority order:

1. **JFrog MCP** — use MCP tools if the server is connected and the operation is covered
2. **JFrog CLI `jf api`** — for any REST API call not covered by MCP; requires CLI v2.100.0+

Never use `curl` for JFrog API calls. The CLI handles auth automatically from `jf config`, avoids exposing tokens in shell commands, and is the only supported fallback.

When MCP is connected, always check whether a tool exists for the operation before reaching for `jf api`. The MCP server evolves continuously — new tools are added over time, so rely on the live tool list rather than any static reference.

## Server Selection Rules

Exactly one server must be resolved before any operation. These rules are strict:

1. **User named a specific server** — use that server only. Pass `--server-id <id>` to every `jf` command. Do not touch any other configured server.
2. **User did not name a server** — use the current default server only. Determine it via `jf config show` (the entry marked as default). If no default is set, stop and ask the user which server to use.
3. **Verify before executing** — confirm the server exists in `jf config show` before running any command against it.

If the resolved server produces any error (auth failure, network error, not found), **stop and report the error to the user**. Do not try other configured servers, do not iterate through the server list, and do not silently switch servers.

## Authentication & Prerequisites

### JFrog CLI Setup

**Minimum version: 2.100.0** (required for `jf api`).

#### Install

```bash
# macOS
brew install jfrog-cli

# Linux
curl -fL https://install-cli.jfrog.io | sh
```

#### Verify version

```bash
jf --version
```

Minimum required: `2.100.0`. If below this version, stop and ask the user to upgrade.

#### Configure a server

```bash
# Add server (non-interactive)
jf config add <server-id> \
  --url=https://<your-jfrog-server-subdomain>.jfrog.io \
  --access-token=<token> \
  --interactive=false

# Set as default
jf config use <server-id>

# Verify
OUT=/tmp/jf-version-$$.json
jf api /artifactory/api/system/version > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

Credentials are encrypted at rest by `jf config`. Never store tokens in files or environment variable profiles.

### MCP Configuration

The JFrog MCP server is configured in this power's `mcp.json` and connects to:

```
https://<your-jfrog-server-subdomain>.jfrog.io/mcp
```

OAuth authorization is triggered automatically by the MCP client on first use. No additional setup is required when the MCP server is connected.

## MCP Config Placeholders

Before using this power, replace the following placeholder in `mcp.json` with your actual value:

- **`YOUR_JFROG_PLATFORM_URL`**: Your JFrog Platform subdomain hostname (e.g. `mycompany.jfrog.io`).
  - **How to get it:**
    1. Log in to your JFrog Platform instance
    2. The hostname is the subdomain in your browser's address bar: `https://<subdomain>.jfrog.io`
    3. Replace `YOUR_JFROG_PLATFORM_URL` with that subdomain, e.g. `mycompany.jfrog.io`

After replacing, your `mcp.json` should look like:
```json
{
  "mcpServers": {
    "jfrog": {
      "url": "https://mycompany.jfrog.io/mcp"
    }
  }
}
```

> **Tip:** You can find and edit `mcp.json` directly in the Powers UI — click the gear icon next to the JFrog power after installation.

## `jf api` Usage

`jf api` is the sole way to call JFrog Platform REST APIs when MCP is not available. It uses credentials from `jf config` — no token in the command line.

### Syntax

```bash
jf api <path> [flags]
```

- `<path>` is the API path including the product prefix (e.g. `/artifactory/api/repositories`, `/access/api/v2/users`)
- **stdout**: response body (JSON or text)
- **stderr**: `[Info] Http Status: NNN` on every call; non-2xx also adds `[Warn] jf api: <method> <url> returned NNN`
- **exit code**: 0 on 2xx, non-zero otherwise

### Product prefix table

`jf api` requires the full path including the product prefix — omitting it returns 404.

| Product | Path prefix |
|---------|-------------|
| Artifactory | `/artifactory/api/...` |
| Xray | `/xray/api/...` |
| Access (users, groups, tokens, permissions, projects) | `/access/api/...` |
| Evidence | `/evidence/api/...` |
| Release Lifecycle | `/lifecycle/api/...` |
| Distribution | `/distribution/api/...` |

### Safe response pattern

**Never pipe `jf api` directly to `jq`** — a wrong filter loses the response body. Always save to a file first, then parse:

```bash
OUT=/tmp/jf-projects-$$.json
jf api /access/api/v1/projects > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

Use `$$` (the shell PID) in filenames to prevent collisions. **Always echo the expanded path** so it can be reused across shell calls — each shell invocation has a different PID, so `$$` expands to a different value each time.

For error checking:

```bash
OUT=/tmp/jf-repos-$$.json
ERR=/tmp/jf-repos-err-$$.log
jf api /artifactory/api/repositories > "$OUT" 2> "$ERR"
if [ $? -eq 0 ]; then
  jq '.' "$OUT"
else
  echo "ERROR:"
  cat "$ERR"
  cat "$OUT"
fi
```

### Methods, headers, and body

```bash
# GET (default)
jf api /artifactory/api/repositories

# POST JSON inline
jf api /access/api/v2/groups -X POST -H "Content-Type: application/json" \
  -d '{"name":"dev-team","description":"Dev team"}'

# POST JSON from file
jf api /access/api/v2/users -X POST -H "Content-Type: application/json" --input ./user.json

# PUT
jf api /artifactory/api/repositories/my-repo -X PUT -H "Content-Type: application/json" \
  -d '{"key":"my-repo","rclass":"local","packageType":"npm"}'

# DELETE
jf api /artifactory/api/repositories/my-repo -X DELETE

# Explicit server
jf api /artifactory/api/system/version --server-id=<server-id>
```

## Platform Conventions

- Always create and manage repositories within a JFrog Project unless the user explicitly opts out.
- Project key format: 2–32 lowercase alphanumeric characters and hyphens, must start with a letter, no leading/trailing hyphens.
- Use virtual repository endpoints for all client reads and writes.
- For each package type, create and wire a remote + local + virtual set.
- Create repositories in this order: remote → local → virtual.
- Standard repository naming: `{project-key}-{ecosystem}-{type}` (e.g. `myproj-npm-local`, `myproj-npm-remote`, `myproj-npm`)

## System Repositories

Artifactory maintains several system repositories for internal platform metadata. **Exclude these from reporting, scanning, or auditing** — they contain platform metadata, not user artifacts:

| Pattern | Purpose |
|---------|---------|
| `release-bundles` | Release Bundles V1 metadata |
| `release-bundles-v2` | Release Bundles V2 metadata |
| `artifactory-build-info` | Default build info storage |
| `*-release-bundles` | Project-scoped Release Bundles V1 |
| `*-release-bundles-v2` | Project-scoped Release Bundles V2 |
| `*-build-info` | Project-scoped build info storage |
| `*-application-versions` | AppTrust application version metadata |

## Cautious Execution

Do not run commands speculatively. Before executing any JFrog CLI command or API call:

1. Confirm the operation is needed to fulfill the user's request
2. Resolve the target server using the **Server selection rules** above
3. For mutating operations (create, update, delete, upload), confirm with the user unless the intent is clearly implied
4. Prefer read operations first to understand current state before making changes
5. **Never invent preparatory mutations.** If an operation fails because a precondition is not met (artifact missing, repo doesn't exist), stop and report the gap to the user. Do not perform copy, move, upload, or create-repo to satisfy the precondition unless the user explicitly asks.

## Destructive Operations

Any operation that deletes a JFrog object (project, repository, user, group, artifact) requires **explicit user confirmation** before execution. Present exactly what will be deleted and wait for approval. Do not proceed if the user declines or is ambiguous.

## Shell Variable Safety

**Never** use `USERNAME` as a shell variable — it is a reserved OS environment variable on macOS and Linux. Use `JFROG_USER_NAME` or `UNAME` instead.

## Gotchas

- **Never pipe `jf api` directly to `jq`** — save the response to a file first (see Safe response pattern above).
- **`jf api` requires the product prefix** in the path (`/artifactory/...`, `/xray/...`, `/access/...`). Omitting it returns 404.
- **`jf api` stdout vs stderr** — body goes to stdout, status info goes to stderr. Never use `2>&1 | jq` — stderr corrupts the JSON.
- **`$$` in filenames** — each shell invocation has a different PID. Always echo the expanded path so it can be reused in subsequent calls.
- **Remote repo `-cache` suffix** — remote repo artifacts are stored in `<repo-key>-cache`. AQL queries and property operations must target the cache repo, not the remote repo key. The remote key is only for configuration.
- **Do not use `jf rt search`** — it generates unscoped AQL internally and can time out on large instances. Always use a direct AQL query via `jf api /artifactory/api/search/aql`.
- **Unscoped build listing can time out** — never call `GET /artifactory/api/build` without `?project=` or `?buildRepo=` on large instances. See the build info section in `artifactory-artifacts.md`.
- **401 on `jf api`** — the configured token may have expired. Ask the user to re-run `jf config add` with a new token for the same server. Do not try a different server.
- **403 on `jf api`** — the token lacks required permissions. If the response body is HTML, it may be rate limiting — add `sleep 1` between calls.
- **409 Conflict** — resource already exists. Safe to treat as success for idempotent create operations.

## Troubleshooting

### JFrog CLI Not Found or Too Old
- Install: `brew install jfrog-cli` (macOS) or `curl -fL https://install-cli.jfrog.io | sh` (Linux)
- Minimum version 2.100.0 is required for `jf api`
- Run `jf --version` to confirm

### MCP Server Not Responding
- Verify the MCP URL is correct: `https://<your-jfrog-server-subdomain>.jfrog.io/mcp`
- Ensure the JFrog Platform Admin has enabled the MCP server
- Complete OAuth authorization if prompted
- Fall back to `jf api` if MCP remains unavailable

### Authentication Failures
- Ensure the token is a Platform Admin token
- Check token expiry
- Re-run `jf config add` with a new token: `jf config add <server-id> --url=https://<host> --access-token=<token> --interactive=false`
- Generate a new token from: `https://<your-jfrog-server-subdomain>.jfrog.io/ui/admin/configuration/security/access_tokens`

### `jf api` Returns Empty or Unexpected Output
- Check that the product prefix is correct in the path
- Verify the server is reachable: `jf api /artifactory/api/system/ping`
- Check `jf config show` to confirm the correct server is active

## Official Documentation

- [Install JFrog CLI](https://docs.jfrog.com/integrations/docs/download-and-install-the-jfrog-cli)
- [JFrog CLI Documentation](https://docs.jfrog.com/integrations/docs/jfrog-cli)
- [JFrog MCP Server Setup](https://docs.jfrog.com/integrations/docs/add-the-jfrog-mcp-server-to-an-mcp-client)
- [Artifactory REST APIs](https://docs.jfrog.com/artifactory/reference)
- [Access REST APIs](https://docs.jfrog.com/administration/reference)
- [Xray REST APIs](https://docs.jfrog.com/security/reference)
- [JFrog Projects](https://docs.jfrog.com/projects/docs/projects)
