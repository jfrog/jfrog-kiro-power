# JFrog Artifactory — Artifacts

Workflows for uploading, downloading, moving, copying, deleting, and querying artifact metadata — including Xray security scan results.

**Priority order:** MCP tools → `jf api` (CLI v2.100.0+).

**Never pipe `jf api` directly to `jq`** — save the response to a file first, then parse. Use `$$` in filenames and echo the expanded path so it can be reused across shell calls.

**Always run shell commands via a script file** — write commands to a `.sh` file using `fs_write` under `./temp/`, then execute with `bash ./temp/script.sh`. Inline commands passed to `execute_bash` can produce garbled terminal echo output. `/tmp` is not writable by `fs_write` — always use `./temp/` inside the workspace (it is git-ignored). Delete the script file after use.

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

**Which endpoint to use:**
- Know the Artifactory path and the repo is indexed → `/api/v2/summary/artifact` (by path or checksum)
- Know the component ID (GAV, npm, pypi, etc.) or the artifact is not indexed → `/api/v1/summary/component`
- Not sure if indexed → try component summary first (always works if the component exists in Xray's DB)

**⚠️ Empty results ≠ clean.** Empty results mean Xray has no data — either the repository is not indexed or Xray has not yet scanned the artifact. Always report this distinction rather than declaring the artifact vulnerability-free.

#### By artifact path (v2 — includes fixed versions per component)

Use v2 when you need to know which component is affected and what version fixes the vulnerability.

```bash
OUT=/tmp/jf-xray-$$.json
jf api /xray/api/v2/summary/artifact -X POST \
  -H "Content-Type: application/json" \
  -d '{"paths": ["default/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"]}' \
  > "$OUT"
echo "$OUT"
jq '.artifacts[0].issues[] | {severity: .severity, cves: [.cves[].cve // empty], summary: .summary}' "$OUT"
```

> **Path format:** prefix with `default/` for the default project, e.g. `default/<repo>/<path/to/file>`. For Docker images use `default/<repo>/<image>/<tag>/manifest.json`.

#### By checksum (when path contains a leading `./` or is otherwise unreliable)

AQL results for files at the repo root often include a leading `./` in the path, which causes the path-based form to silently return empty results. In that case, fetch the SHA256 from the Storage API and query by checksum instead.

```bash
# Step 1: get SHA256 from Storage API
STORAGE_OUT=/tmp/jf-storage-$$.json
jf api "/artifactory/api/storage/<repo>/<path/to/file>" > "$STORAGE_OUT"
echo "$STORAGE_OUT"
SHA256=$(jq -r '.checksums.sha256 // ""' "$STORAGE_OUT")

# Step 2: query Xray by checksum (v2)
XRAY_OUT=/tmp/jf-xray-$$.json
jf api /xray/api/v2/summary/artifact -X POST \
  -H "Content-Type: application/json" \
  -d "{\"checksums\": [\"$SHA256\"]}" \
  > "$XRAY_OUT"
echo "$XRAY_OUT"
jq '.artifacts[0].issues[] | {severity: .severity, cves: [.cves[].cve // empty], summary: .summary}' "$XRAY_OUT"
```

#### By component ID (when artifact is not indexed or path is unknown)

`/api/v1/summary/component` works even when the artifact's repository is not indexed by Xray, as long as the component exists in Xray's vulnerability database. **v1 only — `/api/v2/summary/component` does not exist.**

The request body uses `component_details` (array of objects with `component_id`), not `component_ids`.

```bash
OUT=/tmp/jf-xray-comp-$$.json
jf api /xray/api/v1/summary/component -X POST \
  -H "Content-Type: application/json" \
  -d '{"component_details": [{"component_id": "npm://lodash:4.17.19"}]}' \
  > "$OUT"
echo "$OUT"
jq '.artifacts[0].issues[] | {severity: .severity, cves: [.cves[].cve // empty], summary: .summary}' "$OUT"
```

Component ID format by package type:
- Maven: `gav://group:artifact:version`
- npm: `npm://package:version`
- Python: `pypi://package:version`
- Go: `go://module:version`
- Docker: `docker://image:tag`
- Generic: use checksum-based artifact summary instead

---

## Scanning All Repositories for CVEs (Medium and Above)

When scanning an entire Artifactory instance for vulnerabilities, you must cover **all package types supported by Xray**. A common mistake is filtering AQL by file extension (e.g. only `*.whl`, `*.tgz`) — this silently skips entire ecosystems like RPM, Debian, Docker, Go, etc.

### Xray-Supported Package Types and Their Artifact Patterns

| Package Type | Repo `packageType` | Key file patterns |
|---|---|---|
| Docker | Docker | `manifest.json` |
| Maven | Maven | `*.jar`, `*.war`, `*.ear`, `*.pom` |
| npm | Npm | `*.tgz` |
| PyPI | Pypi | `*.whl`, `*.tar.gz`, `*.zip` |
| Go | Go | `*.zip`, `*.mod`, `*.info` |
| NuGet | NuGet | `*.nupkg` |
| Helm | Helm, HelmOCI | `*.tgz` |
| RPM / YUM | YUM | `*.rpm` |
| Debian | Debian | `*.deb` |
| Alpine | Alpine | `*.apk` |
| Cargo (Rust) | Cargo | `*.crate` |
| CocoaPods | CocoaPods | `*.podspec`, `*.zip` |
| Composer (PHP) | Composer | `*.zip` |
| Conan (C/C++) | Conan | `*.tgz` |
| CRAN (R) | CRAN | `*.tar.gz` |
| Gems (Ruby) | Gems | `*.gem` |
| Gradle | Gradle | `*.jar`, `*.aar`, `*.pom` |
| Ivy | Ivy | `*.jar`, `*.xml` |
| SBT | SBT | `*.jar`, `*.pom` |
| Opkg | Opkg | `*.ipk` |
| Pub (Dart) | Pub | `*.tar.gz` |
| Puppet | Puppet | `*.tar.gz` |
| Swift | Swift | `*.zip` |
| Terraform | Terraform | `*.zip` |
| Vagrant | Vagrant | `*.box` |
| Generic | Generic | any file |

### Correct AQL Pattern — Scan All Files Across All Repos

**Do NOT filter by file extension when scanning for CVEs.** Use `"type": "file"` and exclude only system/metadata repositories. Xray's checksum-based API works on any file regardless of extension.

```bash
# Correct: fetch all files, exclude system repos only
OUT=./temp/jf-aql-all-$$.json
jf api /artifactory/api/search/aql \
  -X POST \
  -H "Content-Type: text/plain" \
  -d 'items.find({
    "type": "file",
    "$and": [
      {"repo": {"$nmatch": "*-build-info"}},
      {"repo": {"$nmatch": "*-release-bundles*"}},
      {"repo": {"$nmatch": "*-application-versions"}},
      {"repo": {"$nmatch": "nix-*"}}
    ]
  }).include("repo","path","name","sha256").limit(50)' > "$OUT"
echo "$OUT"
```

> **Critical:** Use `"$and": [...]` for multiple `$nmatch` conditions on the same field. Repeating `"repo"` as sibling JSON keys is invalid — only the last key is honored, silently breaking all but one exclusion.

### Correct AQL Pattern — Scan a Specific Repository

```bash
OUT=./temp/jf-aql-repo-$$.json
jf api /artifactory/api/search/aql \
  -X POST \
  -H "Content-Type: text/plain" \
  -d 'items.find({
    "repo": "kiro-demo-rpm-local",
    "type": "file"
  }).include("repo","path","name","sha256")' > "$OUT"
echo "$OUT"
```

### Querying Xray by Checksum (Preferred for CVE Scans)

After collecting checksums from AQL, batch them into the Xray summary API. Use the **checksum-based** form — the path-based form silently returns empty results when paths contain a leading `./` (common for files at the repo root).

```bash
# Extract unique checksums from AQL results, batch into groups of 25, query Xray
# Use jq to deduplicate and split into batches; pure bash+jq, no python required
CHECKSUMS_FILE=./temp/xray-checksums-$$.json
jq '[.results[].sha256 // empty] | unique' "$AQL_OUT" > "$CHECKSUMS_FILE"
echo "$CHECKSUMS_FILE"

TOTAL=$(jq 'length' "$CHECKSUMS_FILE")
BATCH_SIZE=25
BATCH=0

while [ $((BATCH * BATCH_SIZE)) -lt "$TOTAL" ]; do
  PAYLOAD=./temp/xray-payload-$$-${BATCH}.json
  jq --argjson start $((BATCH * BATCH_SIZE)) --argjson size $BATCH_SIZE \
    '{"checksums": .[$start:$start+$size]}' "$CHECKSUMS_FILE" > "$PAYLOAD"
  echo "$PAYLOAD"

  XRAY_OUT=./temp/xray-result-$$-${BATCH}.json
  jf api /xray/api/v1/summary/artifact \
    -X POST -H "Content-Type: application/json" \
    --input "$PAYLOAD" > "$XRAY_OUT" 2>/dev/null
  echo "$XRAY_OUT"

  if [ $? -eq 0 ]; then
    # Print medium+ issues per artifact
    jq -r '
      .artifacts[] |
      . as $art |
      .issues // [] |
      map(select(.severity | ascii_downcase | test("critical|high|medium"))) |
      if length > 0 then
        "\n\($art.general.name // "unknown"): \(length) medium+ issues",
        (.[] | "  [\(.severity | ascii_upcase)] \((.cves // [] | map(.cve // empty) | join(", ")) or .issue_id // "N/A"): \(.summary // "" | .[0:100])")
      else empty end
    ' "$XRAY_OUT"
  fi

  BATCH=$((BATCH + 1))
done
```

### System Repositories to Always Exclude

These repos contain platform metadata, not user artifacts — always exclude them from CVE scans:

```
*-build-info
*-release-bundles
*-release-bundles-v2
*-application-versions
artifactory-build-info
release-bundles
release-bundles-v2
```

Use `"$and": [{"repo": {"$nmatch": "..."}}, ...]` in AQL to exclude multiple patterns correctly.

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

### `jf api` — Artifact Summary (v1 vs v2)

- **v1** — vulnerability, license, and operational risk data
- **v2** — same as v1 plus `components[]` inside each issue, with `component_id`, `version`, `pkg_type`, and `fixed_versions[]`

Use v2 when you need to know which component is affected and what version fixes the vulnerability. Use v1 when fixed-version data is not needed.

Either `paths` or `checksums` must be provided. If both are provided, checksums are ignored.

```bash
# v2 — by path (preferred when repo is indexed)
OUT=/tmp/jf-xray-$$.json
jf api /xray/api/v2/summary/artifact -X POST \
  -H "Content-Type: application/json" \
  -d '{"paths": ["default/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"]}' \
  > "$OUT"
echo "$OUT"
jq '.artifacts[0].issues[] | {severity: .severity, cves: [.cves[].cve // empty], summary: .summary}' "$OUT"

# v2 — by checksum (when path has leading ./ or is unreliable)
OUT=/tmp/jf-xray-$$.json
jf api /xray/api/v2/summary/artifact -X POST \
  -H "Content-Type: application/json" \
  -d '{"checksums": ["<sha256>"]}' \
  > "$OUT"
echo "$OUT"
jq '.artifacts[0].issues[] | {severity: .severity, cves: [.cves[].cve // empty], summary: .summary}' "$OUT"
```

### `jf api` — Component Summary (when artifact is not indexed)

Use when the artifact's repository is not indexed by Xray, or when you only know the package coordinates. **v1 only — `/api/v2/summary/component` does not exist.**

```bash
OUT=/tmp/jf-xray-comp-$$.json
jf api /xray/api/v1/summary/component -X POST \
  -H "Content-Type: application/json" \
  -d '{"component_details": [{"component_id": "npm://lodash:4.17.19"}]}' \
  > "$OUT"
echo "$OUT"
jq '.artifacts[0].issues[] | {severity: .severity, cves: [.cves[].cve // empty], summary: .summary}' "$OUT"
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

**Performance warning:** Always include at least one of `watch_name` or `created_from` — an unfiltered violations call can hang indefinitely on large instances.

```bash
OUT=/tmp/jf-violations-$$.json
jf api /xray/api/v1/violations -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "violation_type": "Security",
      "watch_name": "my-watch",
      "min_severity": "High"
    },
    "pagination": {"limit": 50, "offset": 1}
  }' > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && jq '.violations[]' "$OUT" || { echo "ERROR"; cat "$OUT"; }
```

To scope to a project, add `?projectKey=<key>` as a query parameter.

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
  jf api /xray/api/v2/summary/artifact -X POST \
    -H "Content-Type: application/json" \
    -d "{\"paths\": [\"default/$ARTIFACT_PATH\"]}" > "$XRAY"
  echo "$XRAY"
  if [ $? -eq 0 ]; then
    ISSUE_COUNT=$(jq '.artifacts[0].issues | length' "$XRAY")
    if [ "$ISSUE_COUNT" -eq 0 ]; then
      echo "No Xray data — artifact may not be indexed or has not been scanned yet."
    else
      echo "=== Xray Security Summary ==="
      jq '.artifacts[0].issues | group_by(.severity) | map({severity: .[0].severity, count: length})' "$XRAY"
    fi
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
- Empty results mean Xray has no data — **do not report the artifact as clean**
- The artifact's repository may not be indexed by Xray, or Xray has not yet scanned it
- Indexing can take a few minutes after upload
- Verify Xray indexing is enabled on the repository
- If the path is unknown or the repo is not indexed, fall back to `/api/v1/summary/component` with the component ID
- Confirm Xray is licensed and enabled on the platform

### Build Info Returns 404
- The build may be stored in a non-default build-info repo or belong to a project
- Always use `?project=` or `?buildRepo=` scope parameters
- Use AQL `builds.find()` to discover the correct `repo` value

### `jf api` Response is Empty or Unexpected
- Never pipe `jf api` directly to `jq` — save to a file first
- Check stderr for the HTTP status: `jf api <path> 2>/tmp/err-$$.log > /tmp/out-$$.json`
