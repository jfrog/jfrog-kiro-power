# JFrog Artifactory — Artifacts

Workflows for uploading, downloading, moving, copying, deleting, and querying artifact metadata — including Xray security scan results.

**Priority order:** MCP tools → `jf api` (CLI v2.100.0+).

**Never pipe `jf api` directly to `jq`** — save the response to a file first, then parse. Use `$$` in filenames and echo the expanded path so it can be reused across shell calls.

---

## Artifact Security Summary

### MCP — Get Artifacts Summary (preferred)

Use `jfrog_get_artifacts_summary` to get vulnerability counts grouped by severity for one or more artifacts.

```
Tool: jfrog_get_artifacts_summary
Inputs:
  paths (string[]): array of artifact paths, e.g. ["libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"]
Returns: vulnerability count per severity (Low, Medium, High, Critical, Unknown) per artifact, plus totals
```

### `jf api` — Artifact Security Summary (fallback)

```bash
OUT=/tmp/jf-xray-$$.json
jf api /xray/api/v1/summary/artifact -X POST \
  -H "Content-Type: application/json" \
  -d '{"paths": ["libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"]}' \
  > "$OUT"
echo "$OUT"
if [ $? -eq 0 ]; then
  jq '.artifacts[0].issues[] | {severity: .severity, summary: .summary, cves: [.cves[].cve]}' "$OUT"
else
  echo "Xray summary unavailable"
  cat "$OUT"
fi
```

---

## Searching Artifacts

### MCP — AQL Search (preferred)

Use `execute_aql_query` for all artifact searches. See the **artifactory-search** steering file for full AQL reference.

```
Tool: execute_aql_query
Inputs:
  query         (string): AQL query — always include "repo","path","name" in .include()
  limit         (number, optional): max results
  include_fields (string[], optional): fields to return
  sort_by       (string, optional): sort field
  sort_order    (string, optional): "asc" | "desc"
```

---

## Uploading Artifacts

No MCP tool covers artifact upload — use `jf rt upload`.

### Upload a Single File

```bash
jf rt upload "./myapp-1.0.jar" "libs-release-local/com/example/myapp/1.0/"
```

### Upload with Properties

```bash
jf rt upload "./myapp-1.0.jar" "libs-release-local/com/example/myapp/1.0/" \
  --props="build.name=myapp;build.number=42;env=production"
```

`jf rt upload` performs checksum verification automatically — no extra flags needed.

Always deploy to **local** repositories. Remote and virtual repositories are read-only for uploads.

---

## Downloading Artifacts

No MCP tool covers artifact download — use `jf rt download`.

### Download a Single File

```bash
jf rt download "libs-release-local/com/example/myapp/1.0/myapp-1.0.jar" ./local/
```

### Download Latest by Property

```bash
jf rt download "libs-release-local/com/example/app/*" \
  --props="release=latest" --sort-by=created --sort-order=desc --limit=1
```

Always use **virtual** repository URLs for downloads — they route through the correct local and remote repos based on priority order.

---

## Moving, Copying, and Deleting Artifacts

No MCP tool covers these operations — use the `jf rt` CLI.

### Move

```bash
jf rt move "libs-snapshot-local/com/example/myapp/1.0/*" "libs-release-local/com/example/myapp/1.0/"
```

### Copy

```bash
jf rt copy "libs-release-local/com/example/myapp/1.0/*" "libs-archive-local/com/example/myapp/1.0/"
```

### Delete

⚠️ **Destructive operation — requires explicit user confirmation before executing.**

```bash
jf rt delete "libs-snapshot-local/com/example/myapp/0.9/*"
```

---

## Querying Artifact Metadata

No MCP tool covers the Storage API — use `jf api`.

### Get File Info (Storage API)

Returns metadata including checksums, size, properties, and download stats:

```bash
OUT=/tmp/jf-fileinfo-$$.json
jf api "/artifactory/api/storage/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar" > "$OUT"
echo "$OUT"
if [ $? -eq 0 ]; then
  jq '{repo, path, size, created, createdBy, checksums, properties}' "$OUT"
else
  echo "ERROR"; cat "$OUT"
fi
```

Example response fields:
- `repo`, `path`, `created`, `createdBy`, `lastModified`, `modifiedBy`
- `size`, `mimeType`
- `checksums.md5`, `checksums.sha1`, `checksums.sha256`
- `properties` — custom key/value metadata
- `downloadUri` — direct download URL

### Get Folder Contents

```bash
OUT=/tmp/jf-folder-$$.json
jf api "/artifactory/api/storage/libs-release-local/com/example/myapp/" > "$OUT"
echo "$OUT"
jq '.children[]' "$OUT"
```

---

## Setting and Deleting Properties on Artifacts

### MCP — Set Folder Properties (preferred for folders)

```
Tool: set_folder_property
Inputs:
  folderPath  (string): path to the folder
  properties  (object): key-value pairs, e.g. {"release.status": "approved"}
  recursive   (boolean, optional): apply to sub-folders
```

### `jf rt set-props` — Set Properties on a File or Pattern

```bash
jf rt set-props "libs-release-local/com/example/myapp/1.0/myapp-1.0.jar" \
  "release.status=approved;qa.passed=true"
```

### `jf rt delete-props` — Delete Properties

```bash
jf rt delete-props "libs-release-local/com/example/myapp/1.0/myapp-1.0.jar" \
  "release.status"
```

### `jf api` — Get Properties

```bash
OUT=/tmp/jf-props-$$.json
jf api "/artifactory/api/storage/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar?properties" > "$OUT"
echo "$OUT"
jq '.properties' "$OUT"
```

---

## Querying Xray Security Scan Results

### MCP — Artifact Summary (preferred)

```
Tool: jfrog_get_artifacts_summary
Inputs:
  paths (string[]): artifact paths
```

### `jf api` — Check Xray Availability

```bash
OUT=/tmp/jf-xray-ping-$$.json
jf api /xray/api/v1/system/ping > "$OUT" 2>/dev/null
[ $? -eq 0 ] || echo "Xray is not available on this platform. Skipping security metadata."
```

### `jf api` — Get Build Security Summary

```bash
OUT=/tmp/jf-xray-build-$$.json
jf api /xray/api/v1/summary/build -X POST \
  -H "Content-Type: application/json" \
  -d '{"build_name": "my-app", "build_number": "42"}' > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && jq '.' "$OUT" || { echo "ERROR"; cat "$OUT"; }
```

### `jf api` — List Xray Violations for a Watch

```bash
OUT=/tmp/jf-violations-$$.json
jf api /xray/api/v1/violations -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "watch_name": "my-watch",
      "min_severity": "High",
      "type": "security"
    },
    "pagination": {"limit": 50, "offset": 0}
  }' > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && jq '.violations[]' "$OUT" || { echo "ERROR"; cat "$OUT"; }
```

### Combined Metadata + Security Workflow

When a user asks for artifact metadata including security information:

1. Use `execute_aql_query` (MCP) or `jf api` Storage API to get file metadata
2. Use `jfrog_get_artifacts_summary` (MCP) or `jf api` Xray to get security findings
3. Present both together

```bash
ARTIFACT_PATH="libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"

# Step 1: Storage metadata
META=/tmp/jf-meta-$$.json
jf api "/artifactory/api/storage/$ARTIFACT_PATH" > "$META"
echo "$META"
if [ $? -eq 0 ]; then
  echo "=== Artifact Metadata ==="
  jq '{repo, path, size, created, createdBy, checksums}' "$META"
fi

# Step 2: Xray security (if available)
PING=/tmp/jf-ping-$$.json
jf api /xray/api/v1/system/ping > "$PING" 2>/dev/null
if [ $? -eq 0 ]; then
  XRAY=/tmp/jf-xray-sum-$$.json
  jf api /xray/api/v1/summary/artifact -X POST \
    -H "Content-Type: application/json" \
    -d "{\"paths\": [\"$ARTIFACT_PATH\"]}" > "$XRAY"
  echo "$XRAY"
  if [ $? -eq 0 ]; then
    echo "=== Xray Security Summary ==="
    jq '.artifacts[0].issues | group_by(.severity) | map({severity: .[0].severity, count: length})' "$XRAY"
  fi
else
  echo "Xray not available — security metadata skipped"
fi
```

---

## Build Info

### MCP — List Builds (preferred)

```
Tool: list_jfrog_builds
(no required inputs)
Returns: list of all builds
```

### MCP — Get Specific Build (preferred)

```
Tool: get_specific_build
Inputs:
  buildName (string): name of the build
  project   (string, optional): project key to scope the search
```

### `jf api` — Get Build Info (fallback)

**Always scope build API calls** — unscoped `GET /artifactory/api/build` can time out on large instances. Use `?project=` or `?buildRepo=`:

```bash
# List build names scoped to a project
OUT=/tmp/jf-builds-$$.json
jf api "/artifactory/api/build?project=$PROJECT_KEY" > "$OUT"
echo "$OUT"
jq '.builds[]' "$OUT"

# List run numbers for a specific build name
OUT=/tmp/jf-build-runs-$$.json
jf api "/artifactory/api/build/myapp?project=$PROJECT_KEY" > "$OUT"
echo "$OUT"
# Response field is "buildsNumbers" (exact spelling)
jq '.buildsNumbers[]' "$OUT"

# Get full build info for a specific run
OUT=/tmp/jf-build-info-$$.json
jf api "/artifactory/api/build/myapp/42?project=$PROJECT_KEY" > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

Scope parameters:
- `?project=<project-key>` — when the build belongs to a JFrog Project
- `?buildRepo=<build-info-repo>` — when build info is stored in a non-default build-info repository

### Discover Build Scope via AQL (when project key is unknown)

When the project key and build-info repo are unknown, use AQL to discover scope. The `builds` domain **requires** `name`, `number`, and `repo` in `.include()`:

```bash
OUT=/tmp/jf-build-scope-$$.json
jf api /artifactory/api/search/aql -X POST \
  -H "Content-Type: text/plain" \
  -d 'builds.find({"name":"myapp"}).include("name","number","repo").sort({"$desc":["started"]}).limit(10)' \
  > "$OUT"
echo "$OUT"
jq '.results[]' "$OUT"
# Use the "repo" field value as the ?buildRepo= parameter in subsequent detail GETs
```

### Publishing Builds

```bash
# Collect environment variables
jf rt build-collect-env myapp 42

# Add git info
jf rt build-add-git myapp 42

# Publish build info
jf rt build-publish myapp 42

# Discard old build info
jf rt build-discard myapp
```

### `jf rt build-promote` — Promote a Build

No MCP tool covers build promotion — use the CLI.

```bash
jf rt build-promote myapp 42 libs-release-local --status=released
```

Or via `jf api`:

```bash
OUT=/tmp/jf-promote-$$.json
jf api /artifactory/api/build/promote/myapp/42 -X POST \
  -H "Content-Type: application/json" \
  -d '{"status":"released","targetRepo":"libs-release-local","copy":false,"failFast":true}' \
  > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && echo "Build promoted successfully" || { echo "ERROR"; cat "$OUT"; }
```

---

## Runtime Monitoring (MCP only)

These operations are only available via MCP.

### List Runtime Clusters

```
Tool: list_jfrog_runtime_clusters
Inputs:
  limit    (integer, optional): max clusters to return
  next_key (string, optional): pagination cursor
```

### Get a Specific Cluster

```
Tool: get_jfrog_runtime_specific_cluster
Inputs:
  clusterId (integer): cluster ID
```

### List Running Container Images

```
Tool: list_jfrog_running_images
Inputs:
  filters    (string, optional): filter expression
  num_of_rows (integer, optional): rows to return
  page_num   (integer, optional): page number
  statistics (boolean, optional): include statistics
  timePeriod (string, optional): time period to query
```

---

## Troubleshooting

### Upload Fails with 403
- Verify the token has deploy permissions on the target repository
- Check the repository is not read-only — deploy to local repos only, not remote or virtual

### Download Returns 404
- Confirm the artifact path is correct (case-sensitive)
- For virtual repos, ensure the artifact exists in one of the aggregated repos
- For remote repos, query the `-cache` repo for AQL/property operations

### Xray Summary Returns Empty Issues
- The artifact may not be indexed by Xray yet — indexing can take a few minutes after upload
- Verify Xray indexing is enabled on the repository
- Confirm Xray is licensed and enabled on the platform

### Build Info Returns 404
- The build may be stored in a non-default build-info repo or belong to a project
- Always use `?project=` or `?buildRepo=` scope parameters
- Use AQL `builds.find()` to discover the correct `repo` value

### `jf api` Response is Empty or Unexpected
- Never pipe `jf api` directly to `jq` — save to a file first
- Check stderr for the HTTP status: `jf api <path> 2>/tmp/err-$$.log > /tmp/out-$$.json`
