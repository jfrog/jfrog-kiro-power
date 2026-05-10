# JFrog Artifactory — Search

Workflows for searching artifacts, users, groups, and projects on the JFrog Platform.

**Priority order:** MCP tools → `jf api` (CLI v2.100.0+).

**Never use `jf rt search`** — it generates unscoped AQL internally and can time out on large instances. Always use a direct AQL query via `jf api /artifactory/api/search/aql` or the `execute_aql_query` MCP tool.

**Always run shell commands via a script file** — write commands to a `.sh` file using `fs_write` under `./temp/`, then execute with `bash ./temp/script.sh`. Inline commands passed to `execute_bash` can produce garbled terminal echo output. `/tmp` is not writable by `fs_write` — always use `./temp/` inside the workspace (it is git-ignored). Delete the script file after use.

---

## Searching Artifacts

### MCP — AQL Search (preferred)

Use the `execute_aql_query` MCP tool for all artifact searches when MCP is connected.

```
Tool: execute_aql_query
Inputs:
  query       - AQL query string (required)
  domain      - "items" | "builds" | "archive.entries" | "build.promotions" | "releases" (optional)
  transitive  - search remote repos (optional boolean)
  limit       - max results (optional number)
  offset      - skip N results (optional number)
  include_fields - fields to return (optional string[])
  sort_by     - field to sort on (optional string)
  sort_order  - "asc" | "desc" (optional string)
```

Example — find latest JARs in a repo:
```
execute_aql_query({
  query: 'items.find({"repo":"libs-release-local","name":{"$match":"*.jar"}}).include("name","repo","path","size","sha256")',
  sort_by: "created",
  sort_order: "desc",
  limit: 50
})
```

### `jf api` — AQL Search (fallback)

Save the response to a file before parsing — never pipe `jf api` directly to `jq`:

```bash
OUT=/tmp/jf-aql-$$.json
jf api /artifactory/api/search/aql -X POST \
  -H "Content-Type: text/plain" \
  -d 'items.find({"repo":"libs-release-local","name":{"$match":"*.jar"}}).include("name","repo","path","size","sha256").limit(20)' \
  > "$OUT"
echo "$OUT"
jq '.results[]' "$OUT"
```

### `jf api` — Quick Name Search

```bash
OUT=/tmp/jf-search-$$.json
jf api "/artifactory/api/search/artifact?name=myapp&repos=libs-release-local" > "$OUT"
jq '.' "$OUT"
```

### `jf api` — Property Search

```bash
OUT=/tmp/jf-propsearch-$$.json
jf api "/artifactory/api/search/prop?build.name=myapp&repos=libs-release-local" > "$OUT"
jq '.' "$OUT"
```

### `jf api` — GAVC Search (Maven)

```bash
OUT=/tmp/jf-gavc-$$.json
jf api "/artifactory/api/search/gavc?g=com.example&a=myapp&v=1.0" > "$OUT"
jq '.' "$OUT"
```

---

## AQL — Artifactory Query Language

AQL is the most powerful search mechanism. Use `execute_aql_query` via MCP when available, `jf api` otherwise.

### Query structure

```
<domain>.find(<criteria>)
  .include(<fields>)
  .sort(<sort>)
  .offset(<n>)
  .limit(<n>)
  .distinct(<boolean>)
```

Only `.find()` is required. **The chain order is enforced by the server** — `.include()` must come before `.sort()`, `.sort()` before `.offset()`, etc. Putting them out of order produces a parse error.

### Before constructing a query

1. **Always set `.limit()`** — AQL has no built-in default limit; unbounded queries can time out or OOM.
2. **Never `.sort()` without a `repo` filter** — forces a full table scan. Sort client-side with `jq` instead. Also, sorting on cross-domain fields (e.g. `stat.downloads`) is silently ignored — always sort client-side for those.
3. **Always include mandatory fields** — `items` queries must include `"repo","path","name"`; `builds` queries must include `"name","number","repo"`. The server rejects queries missing these for non-admin users.
4. **`range.total` is not the true total** — it equals the returned count, not the total matching count. AQL has no count-only mode; paginate with `.offset()` to find the true total.
5. **AQL has no repo-type field** — to restrict to local repos, pre-query `GET /api/repositories?type=local` and add repo names to criteria, or filter client-side with `jq`.

### Common AQL Examples

**Find artifacts by name pattern in a repo:**
```
items.find({
  "repo": "libs-release-local",
  "name": {"$match": "*.jar"}
}).include("name", "repo", "path", "size", "sha256")
  .sort({"$desc": ["created"]})
  .limit(50)
```

**Find artifacts modified in the last 7 days (relative date):**
```
items.find({
  "repo": "libs-release-local",
  "modified": {"$last": "7d"},
  "type": "file"
}).include("name", "repo", "path", "modified", "size")
  .limit(100)
```

**Find artifacts created before 6 months ago:**
```
items.find({
  "repo": "libs-release-local",
  "created": {"$before": "6mo"},
  "type": "file"
}).include("name", "repo", "path", "created", "size")
  .limit(50)
```

**Find artifacts with specific properties (multi-property AND):**
```
items.find({"$and": [
  {"repo": "libs-release-local"},
  {"@release.status": "approved"},
  {"@qa.passed": "true"}
]}).include("name", "path", "repo")
```

**Find artifacts from a specific build (cross-domain):**
```
items.find({
  "artifact.module.build.name": "my-app",
  "artifact.module.build.number": "42"
}).include("name", "repo", "path", "sha256")
  .limit(50)
```

**Find large artifacts (>100MB):**
```
items.find({
  "repo": "libs-release-local",
  "size": {"$gt": "104857600"},
  "type": "file"
}).include("name", "path", "size")
  .limit(20)
```

**Find Docker images by tag pattern:**
```
items.find({
  "repo": "docker-local",
  "type": "file",
  "name": "manifest.json",
  "@docker.repoName": {"$match": "my-app*"}
}).include("name", "path", "@docker.repoName", "@docker.manifest")
  .limit(50)
```

Note: Use `"name":"manifest.json"` to list tags (one per tag). Use `"name":{"$match":"*manifest.json"}` when you need to include multi-arch `list.manifest.json` entries as well.

**Search across multiple repos (OR):**
```
items.find({
  "$or": [{"repo": "libs-release-local"}, {"repo": "libs-snapshot-local"}],
  "name": {"$match": "myapp-*"}
}).include("name", "repo", "path", "size")
  .limit(50)
```

**Find never-downloaded files (zero download count):**

Zero-download items lack a stats row — the `stat.downloads` filter won't match them. Filter client-side instead:

```bash
OUT=/tmp/jf-nodl-$$.json
jf api /artifactory/api/search/aql -X POST \
  -H "Content-Type: text/plain" \
  -d 'items.find({"repo":"my-repo","type":"file"}).include("repo","path","name","size","stat.downloads").limit(500)' \
  > "$OUT"
echo "$OUT"
jq '[.results[] | select((.stats[0].downloads // 0) == 0) | {repo, path, name, size}]' "$OUT"
```

**Find artifacts not downloaded in 90 days** (previously-downloaded items only — combine with the above for full coverage):

```
items.find({
  "repo": "my-repo",
  "type": "file",
  "stat.downloaded": {"$before": "90d"}
}).include("name", "repo", "path", "stat.downloaded", "size")
  .limit(100)
```

**Remote repository content** — always query the `-cache` repo, not the remote repo key:

```
items.find({"repo":"npm-remote-cache","name":{"$match":"*.tgz"}})
  .include("name","repo","path","size")
  .limit(50)
```

### AQL Operators Reference

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equals (default) | `{"name": "app.jar"}` |
| `$ne` | Not equals | `{"name": {"$ne": "test.jar"}}` |
| `$eqic` | Equals, case-insensitive | `{"name": {"$eqic": "README.md"}}` |
| `$gt` | Greater than | `{"size": {"$gt": "1000000"}}` |
| `$gte` | Greater than or equal | `{"created": {"$gte": "2024-01-01"}}` |
| `$lt` | Less than | `{"size": {"$lt": "5000"}}` |
| `$lte` | Less than or equal | `{"modified": {"$lte": "2025-01-01"}}` |
| `$match` | Wildcard (`*` and `?`) | `{"name": {"$match": "*.jar"}}` |
| `$matchic` | Wildcard match, case-insensitive | `{"name": {"$matchic": "*.JAR"}}` |
| `$nmatch` | Wildcard not-match | `{"name": {"$nmatch": "test*"}}` |
| `$last` | Within the last N period | `{"modified": {"$last": "7d"}}` |
| `$before` | Before the last N period | `{"created": {"$before": "3mo"}}` |
| `$or` | Logical OR | `{"$or": [{"repo": "a"}, {"repo": "b"}]}` |
| `$and` | Logical AND (explicit) | `{"$and": [{"size": {"$gt": "100"}}, {"size": {"$lt": "1000"}}]}` |

Relative date units: `d` (days), `w` (weeks), `mo` (months), `y` (years), `s` (seconds), `mi` (minutes).

String values in numeric comparisons must be quoted: `"size":{"$gt":"1000"}` not `"size":{"$gt":1000}`.

### Multi-property AND

To match items that have property A=1 **and** property B=2 (different property rows), use `$and` with `@` shorthand:

```
items.find({"$and":[
  {"@build.name":"my-build"},
  {"@build.number":"42"}
]})
```

Do **not** use `$msp` — it is unreliable and returns 0 results on many server versions even when matching items exist.

### AQL Gotchas

- **Chain order is enforced** — `.include()` before `.sort()` before `.offset()` before `.limit()`. Out-of-order produces a parse error.
- **Mandatory include fields** — `items` must include `"repo","path","name"`; `builds` must include `"name","number","repo"`. Omitting these causes server errors for non-admin users.
- **Remote repo content** — lives in `<repo>-cache`, not `<repo>`. Always query the cache repo.
- **`stat.downloads` filters skip zero-download items** — items with no downloads lack a stats row entirely. Use the client-side `jq` approach shown above.
- **Docker `list.manifest.json`** — multi-arch images have both `manifest.json` and `list.manifest.json` per tag. `"name":"manifest.json"` silently excludes multi-arch entries. Use `"name":{"$match":"*manifest.json"}` when all manifest pushes should be counted.
- **Sort without `repo` filter** — forces a full table scan. Always add a `repo` filter when sorting, or sort client-side.
- **Cross-domain sort is silently ignored** — sorting on `stat.downloads` in an `items.find()` is silently dropped. Sort client-side with `jq`.
- **`range.total` ≠ total matching count** — it equals the returned count. Paginate with `.offset()` to find the true total.
- **`builds.number` is a string** — `"42"`, `"1.0.3"`, and `"SNAPSHOT-1"` are all valid.
- **Root-level items** — the `path` value for items at the root of a repository is `"."`, not `""` or `"/"`.
- **`$match` is not regex** — `*` matches any characters, `?` matches exactly one. Literal `_` and `%` are escaped automatically.

---

## Searching Users

No MCP tool covers user search — use `jf api`.

### List All Users

```bash
OUT=/tmp/jf-users-$$.json
jf api /access/api/v2/users > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

### Get a Specific User

```bash
OUT=/tmp/jf-user-$$.json
jf api /access/api/v2/users/john > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

---

## Searching Groups

No MCP tool covers group search — use `jf api`.

### List All Groups

```bash
OUT=/tmp/jf-groups-$$.json
jf api /access/api/v2/groups > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

### Get a Specific Group

```bash
OUT=/tmp/jf-group-$$.json
jf api /access/api/v2/groups/dev-team > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

---

## Searching Projects

### MCP — List Projects (preferred)

```
Tool: list_jfrog_projects
(no required inputs)
Returns: list of all projects with details
```

### MCP — Get Specific Project (preferred)

```
Tool: get_specific_project
Inputs:
  project_key (string): the project key to look up
```

### `jf api` — List All Projects

```bash
OUT=/tmp/jf-projects-$$.json
jf api /access/api/v1/projects > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

### `jf api` — Get a Specific Project

```bash
OUT=/tmp/jf-project-$$.json
jf api /access/api/v1/projects/myapp > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

### List Repositories in a Project

#### MCP (preferred)

```
Tool: list_repositories
Inputs:
  project (string): project key to filter by
```

#### `jf api` fallback

```bash
OUT=/tmp/jf-repos-$$.json
jf api "/artifactory/api/repositories?project=myapp" > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

Use the `?project={key}` query parameter to filter repos by project. The list API response does not include `projectKey` in each object, so client-side filtering by that field will always return zero results.

---

## Package Information (MCP only — Catalog/Curation)

These operations are only available via MCP and require Curation/Catalog license.

### Get Package Info

```
Tool: jfrog_get_package_info
Inputs:
  type    (string): pypi | npm | maven | golang | nuget | huggingface | rubygems
  name    (string): package name as it appears in the registry
  version (string, optional): version (default: "latest")
```

### Get Package Versions

```
Tool: jfrog_get_package_versions
Inputs:
  type (string): package type
  name (string): package name
```

### Get Package Vulnerabilities

```
Tool: jfrog_get_package_version_vulnerabilities
Inputs:
  type      (string): package type
  name      (string): package name
  version   (string, optional): version (default: "latest")
  pageSize  (number, optional): results per page (default: 10)
  pageCount (number, optional): pages to return (default: 1)
```

### Get Vulnerability Details

```
Tool: jfrog_get_vulnerability_info
Inputs:
  cve_id    (string): CVE ID or vulnerability identifier
  pageSize  (number, optional): results per page (default: 10)
  pageCount (number, optional): pages to return (default: 1)
```

### Check Package Curation Status

```
Tool: jfrog_get_package_curation_status
Inputs:
  packageType    (string): package type
  packageName    (string): package name
  packageVersion (string): package version
Returns: "approved" | "blocked" | "inconclusive"
```

---

## Troubleshooting Search

### No Results Returned
- Verify the repo name is correct and the artifact exists
- Check that the token has read access to the target repository
- For AQL: ensure `repo` is specified to avoid scanning all repos
- For zero-download queries: use the client-side `jq` approach — `stat.downloads` filters skip items with no stats row

### AQL Syntax Errors
- Verify chain order: `.include()` → `.sort()` → `.offset()` → `.limit()`
- Ensure `items` queries include `"repo","path","name"` in `.include()`
- Test with a simple query first: `items.find({"repo":"my-repo"}).include("repo","path","name").limit(5)`

### Slow Queries
- Add `repo` filter to all AQL queries
- Use `limit` to cap result size
- Avoid sorting without a `repo` filter — sort client-side with `jq` instead
