# JFrog Kiro Power

This repository has the JFrog [Kiro Power](https://kiro.dev/powers/) sources.

The power enables AI-assisted workflows on the JFrog Platform — searching artifacts, managing repositories, handling users and groups, setting up projects, and querying security metadata.

## How it works

The power uses three layers, in priority order:

1. **JFrog MCP server** — the primary interface. When connected, Kiro uses MCP tools directly for supported operations (no credentials needed beyond the initial OAuth login).
2. **JFrog CLI (`jf api`)** — complements MCP for operations not covered by MCP tools, and acts as the fallback when MCP is not connected. Auth is handled automatically by `jf config` — no environment variables or `.env` file needed.
3. **`curl` REST API** — last resort only, when the JFrog CLI is not installed or is below v2.100.0. Requires a `.env` file with credentials.

## Installing

### 1. Clone this repository

```bash
git clone <this-repo-url>
cd <repo-folder>
```

### 2. Update the MCP server URL

Edit `powers/jfrog/mcp.json` and set your JFrog Platform URL:

```json
{
  "mcpServers": {
    "jfrog": {
      "url": "https://YOUR_JFROG_PLATFORM_URL/mcp"
    }
  }
}
```

### 3. Install the JFrog CLI (v2.100.0+)

The JFrog CLI is used for all REST API calls not covered by MCP tools. It handles authentication automatically via `jf config`, so no `.env` file is needed for day-to-day use.

```bash
# macOS
brew install jfrog-cli

# Linux
curl -fL https://install-cli.jfrog.io | sh
```

Configure it for your JFrog instance:

```bash
jf config add <server-id> \
  --url=https://YOUR_JFROG_PLATFORM_URL \
  --access-token=YOUR_TOKEN \
  --interactive=false

jf config use <server-id>
```

Generate a token from: `https://<your-platform>/ui/admin/configuration/security/access_tokens`

### 4. Enable MCP in Kiro

MCP support must be enabled in Kiro before the JFrog MCP server can connect.

1. Open Kiro Settings (`Cmd+,` on macOS / `Ctrl+,` on Linux/Windows)
2. Search for **MCP** and enable the **Model Context Protocol** setting
3. Restart Kiro if prompted

### 5. Install the power in Kiro

1. Open Kiro and click the **Powers** icon in the sidebar
2. Click **Add Custom Power**
3. Select **Local Directory**
4. Paste the absolute path to the power directory:
   ```
   /path/to/this/repo
   ```
5. Click **Add**

The power will appear in your Installed Powers list.

## Authentication

### MCP (primary)

The JFrog MCP server uses **OAuth**. No token is needed in `mcp.json` — when Kiro first uses the MCP server, it will open a browser window for you to log in to your JFrog Platform. After that, authentication is handled automatically.

> **Prerequisite:** A Platform Admin must enable the MCP server on your JFrog instance before the OAuth flow will work. Check under Platform → Integrations -> JFrog MCP Server.

### JFrog CLI (secondary — no `.env` needed)

Once `jf config` is set up (step 3 above), the CLI handles auth for all `jf api` calls automatically. No environment variables or `.env` file are required.

### `curl` REST API (last resort)

Only needed when the JFrog CLI is not available or is below v2.100.0. Create a `.env` file in your project root:

```
JFROG_URL=https://mycompany.jfrog.io
JFROG_ACCESS_TOKEN=eyJ...
```

> Keep `.env` out of version control — it's already in `.gitignore`.

## Testing

### Try the power

Once installed, open a new agent chat in Kiro and try natural language requests like:

- *"Search for artifacts named myapp in Artifactory"*
- *"Create a project called myteam with npm repositories"*
- *"List all users on my JFrog platform"*
- *"Show me the Xray scan results for this artifact"*
- *"Upload this jar to libs-release-local"*

### Update after changes

If you edit files in this repository, changes don't apply automatically. To reload:

1. Open the Powers panel in Kiro
2. Find the JFrog power in Installed Powers
3. Click **Check for Updates** → **Install Updates**
