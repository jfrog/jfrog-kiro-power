# JFrog Kiro Power

This repository has the JFrog [Kiro Power](https://kiro.dev/powers/) sources.

The power enables AI-assisted workflows on the JFrog Platform — searching artifacts, managing repositories, handling users and groups, setting up projects, and querying security metadata.

## How it works

The power uses three tiers, in priority order:

1. **JFrog MCP server** — the primary interface. When connected, Kiro uses MCP tools directly for supported operations (no credentials needed beyond the initial OAuth login).
2. **JFrog CLI subcommands** — dedicated commands such as `jf rt upload`, `jf rt download`, and `jf rt build-publish` for operations not covered by MCP tools.
3. **JFrog CLI (`jf api`)** — REST API fallback for calls with no dedicated subcommand. Requires CLI v2.100.0+. Auth is handled automatically by `jf config` — no environment variables or `.env` file needed.

Never use `curl` for JFrog API calls.

## Installing

### 1. Install the JFrog CLI (v2.100.0+)

The JFrog CLI is used for all REST API calls not covered by MCP tools. It handles authentication automatically via `jf config`, so no `.env` file is needed for day-to-day use.

```bash
# macOS
brew install jfrog-cli

# Linux
curl -fL https://install-cli.jfrog.io | sh
```

Configure it for your JFrog instance:

> **Note:** `<server-id>` is a unique name you choose to identify this JFrog instance locally (e.g. `my-jfrog` or `acme-platform`). It is only used by the CLI to reference this configuration — it does not need to match anything on the JFrog Platform.

```bash
jf config add <server-id> \
  --url=https://YOUR_JFROG_PLATFORM_URL \
  --access-token=YOUR_TOKEN \
  --interactive=false

jf config use <server-id>
```

Generate a token from: `https://<your-platform>/ui/admin/configuration/security/access_tokens`

### 2. Enable MCP in Kiro

MCP support must be enabled in Kiro before the JFrog MCP server can connect.

1. Open Kiro Settings (`Cmd+,` on macOS / `Ctrl+,` on Linux/Windows)
2. Search for **MCP** and enable the **Model Context Protocol** setting
3. Restart Kiro if prompted

### 3. Install the power in Kiro

1. Open Kiro and click the **Powers** icon in the sidebar
2. Click **Add Custom Power**
3. Select **Import power from GitHub**
4. Enter the repository URL:
   ```
   https://github.com/jfrog/jfrog-kiro-power
   ```
5. Hit the **enter** key

The power will appear in your Installed Powers list.

> **Note:** If the JFrog MCP server does not appear after installing the power, a full Kiro restart is required. Close and reopen Kiro completely — a simple reload is not always sufficient.

### 4. Set your JFrog Platform URL

After installation, configure the MCP server URL for your JFrog instance:

1. In the Powers panel, find the **JFrog** power and click it. In the power tab, in the **MCP Configuration**, click **open powers config**
2. Update the `url` field, replacing `YOUR_JFROG_PLATFORM_URL` with your actual platform hostname:

```json
{
  "mcpServers": {
    "jfrog": {
      "url": "https://YOUR_JFROG_PLATFORM_URL/mcp"
    }
  }
}
```

Alternatively, you can use the **Try It** button in the Powers panel to send a test request — Kiro will instruct you to set the URL if it hasn't been configured yet.

## Authentication

### MCP (primary)

The JFrog MCP server uses **OAuth**. No token is needed in `mcp.json` — when Kiro first uses the MCP server, it will open a browser window for you to log in to your JFrog Platform. After that, authentication is handled automatically.

> **Prerequisite:** A Platform Admin must enable the MCP server on your JFrog instance before the OAuth flow will work. Check under Platform → Integrations -> JFrog MCP Server.

### JFrog CLI (secondary — no `.env` needed)

Once `jf config` is set up (step 1 above), the CLI handles auth for all `jf` subcommands and `jf api` calls automatically. No environment variables or `.env` file are required.

## Testing

### Try the power

Once installed, open a new agent chat in Kiro and try natural language requests like:

- *"Search for artifacts named myapp in Artifactory"*
- *"Create a project called myteam with npm repositories"*
- *"List all users on my JFrog platform"*
- *"Show me the Xray scan results for this artifact"*
- *"Upload this jar to libs-release-local"*

### Update the power

When new versions are published to the GitHub repository, you can pull them in without reinstalling:

1. Open the Powers panel in Kiro
2. Find the **JFrog** power in Installed Powers
3. Click **Check for Updates** → **Install Updates**

## Contributing

Contributions are welcome! See [CONTRIBUTING](CONTRIBUTING.md) for details.

## License and Support

- This project is licensed under the [Apache License 2.0](LICENSE).
- Get support by opening an issue in this repository or reaching out to support@jfrog.com.

