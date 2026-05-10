# JFrog Artifactory — Administration

Workflows for creating and managing projects, repositories, users, groups, and memberships.

**Priority order:** MCP tools → `jf api` (CLI v2.100.0+).

Users, groups, and project membership have no MCP tools — always use `jf api` for those.

**Never pipe `jf api` directly to `jq`** — save the response to a file first, then parse. Use `$$` in filenames and echo the expanded path so it can be reused across shell calls.

**Always run shell commands via a script file** — write commands to a `.sh` file using `fs_write` under `./temp/`, then execute with `bash ./temp/script.sh`. Inline commands passed to `execute_bash` can produce garbled terminal echo output. `/tmp` is not writable by `fs_write` — always use `./temp/` inside the workspace (it is git-ignored). Delete the script file after use.

---

## Projects

Projects are the top-level organizational unit in JFrog. They group repositories, builds, environments, and members.

**Project key rules:** 2–32 lowercase alphanumeric characters and hyphens, must start with a letter, no leading/trailing hyphens.

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
  project_key (string): the unique project key
```

### MCP — Create a Project (preferred)

```
Tool: create_project
Inputs:
  project_key         (string): unique identifier, 2-32 lowercase alphanumeric/hyphens, starts with a letter
  display_name        (string): human-readable name
  description         (string): project description
  admin_privileges    (object): e.g. {"manage_members": true, "manage_resources": true, "index_resources": true}
  storage_quota_bytes (number): storage quota in bytes (-1 for unlimited)
```

### `jf api` — Create a Project (fallback)

```bash
OUT=/tmp/jf-project-$$.json
jf api /access/api/v1/projects -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "project_key": "myapp",
    "display_name": "My Application",
    "description": "Main application project",
    "admin_privileges": {
      "manage_members": true,
      "manage_resources": true,
      "index_resources": true
    }
  }' > "$OUT"
echo "$OUT"
if [ $? -eq 0 ]; then
  echo "Project created"
  jq '{project_key, display_name}' "$OUT"
else
  echo "ERROR — check if project already exists (409 = already exists)"
  cat "$OUT"
fi
```

### `jf api` — Update a Project

```bash
jf api /access/api/v1/projects/myapp -X PUT \
  -H "Content-Type: application/json" \
  -d '{"display_name": "Updated Name", "description": "Updated description"}'
```

### `jf api` — Delete a Project

⚠️ **Destructive operation — requires explicit user confirmation before executing.**

```bash
jf api /access/api/v1/projects/myapp -X DELETE
```

### Validate Project Key Before Creating

```bash
echo "$PROJECT_KEY" | grep -qE '^[a-z][a-z0-9-]{0,30}[a-z0-9]$' \
  || { echo "ERROR: Invalid project key. Must be 2-32 chars, lowercase alphanumeric/hyphens, start with a letter, no leading/trailing hyphens."; exit 1; }
```

### Check if Project Exists

#### MCP (preferred)

```
Tool: get_specific_project
Inputs:
  project_key (string): key to check
```
If the tool returns an error or empty result, the project does not exist.

#### `jf api` fallback

```bash
OUT=/tmp/jf-proj-check-$$.json
jf api "/access/api/v1/projects/$PROJECT_KEY" > "$OUT" 2>/dev/null
[ $? -eq 0 ] && echo "Exists" || echo "Does not exist"
```

---

## Repositories

Always create repositories in this order: **remote → local → virtual**.

Standard naming convention: `{project-key}-{ecosystem}-{type}`
- Local: `myproj-npm-local`
- Remote: `myproj-npm-remote`
- Virtual: `myproj-npm` (no suffix)

Repositories are created from JSON configuration. The workflow is:
1. Get an existing repo config as a template: `jf api /artifactory/api/repositories/<repo-key>`
2. Modify it and create: `jf rt repo-create <template.json>`
3. Or use `jf api PUT` directly (shown below)

### MCP — List Repositories (preferred)

```
Tool: list_repositories
Inputs:
  type        (string, optional): local | remote | virtual | federated | distribution
  packageType (string, optional): npm | maven | pypi | docker | helm | go | etc.
  project     (string, optional): project key to filter by
```

### MCP — Create a Local Repository (preferred)

```
Tool: create_local_repository
Inputs:
  key         (string): repository key, e.g. "myproj-npm-local"
  rclass      (string): must be "local"
  packageType (string): npm | maven | pypi | docker | helm | go | etc.
  description (string, optional): description
  projectKey  (string, optional): project key to assign to
  environments (string[], optional): environments to assign to
```

### MCP — Create a Remote Repository (preferred)

```
Tool: create_remote_repository
Inputs:
  key         (string): repository key, e.g. "myproj-npm-remote"
  rclass      (string): must be "remote"
  packageType (string): package type
  url         (string): upstream registry URL
  description (string, optional): description
  projectKey  (string, optional): project key
  environments (string[], optional): environments
  username    (string, optional): upstream auth username
  password    (string, optional): upstream auth password
```

Common upstream URLs by package type:

| Package Type | Upstream URL |
|-------------|-------------|
| npm | `https://registry.npmjs.org` |
| maven | `https://repo1.maven.org/maven2` |
| pypi | `https://files.pythonhosted.org` |
| go | `https://goproxy.io` |
| docker | `https://registry-1.docker.io` |
| helm | `https://charts.helm.sh/stable` |

### MCP — Create a Virtual Repository (preferred)

```
Tool: create_virtual_repository
Inputs:
  key          (string): repository key, e.g. "myproj-npm"
  rclass       (string): must be "virtual"
  packageType  (string): package type
  repositories (string[]): list of repo keys to aggregate, e.g. ["myproj-npm-local", "myproj-npm-remote"]
  description  (string, optional): description
  projectKey   (string, optional): project key
  environments (string[], optional): environments
```

### `jf api` — Create a Local Repository (fallback)

```bash
OUT=/tmp/jf-repo-$$.json
jf api /artifactory/api/repositories/myproj-npm-local -X PUT \
  -H "Content-Type: application/json" \
  -d '{
    "key": "myproj-npm-local",
    "rclass": "local",
    "packageType": "npm",
    "projectKey": "myproj",
    "description": "Local npm artifacts for myproj"
  }' > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && echo "Local repo created" || { echo "ERROR (409 = already exists)"; cat "$OUT"; }
```

### `jf api` — Create a Remote Repository (fallback)

```bash
OUT=/tmp/jf-repo-$$.json
jf api /artifactory/api/repositories/myproj-npm-remote -X PUT \
  -H "Content-Type: application/json" \
  -d '{
    "key": "myproj-npm-remote",
    "rclass": "remote",
    "packageType": "npm",
    "url": "https://registry.npmjs.org",
    "projectKey": "myproj",
    "description": "Proxy for npmjs.org"
  }' > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && echo "Remote repo created" || { echo "ERROR (409 = already exists)"; cat "$OUT"; }
```

### `jf api` — Create a Virtual Repository (fallback)

```bash
OUT=/tmp/jf-repo-$$.json
jf api /artifactory/api/repositories/myproj-npm -X PUT \
  -H "Content-Type: application/json" \
  -d '{
    "key": "myproj-npm",
    "rclass": "virtual",
    "packageType": "npm",
    "projectKey": "myproj",
    "repositories": ["myproj-npm-local", "myproj-npm-remote"],
    "defaultDeploymentRepo": "myproj-npm-local",
    "description": "Virtual npm repo for myproj"
  }' > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && echo "Virtual repo created" || { echo "ERROR (409 = already exists)"; cat "$OUT"; }
```

### Assign an Existing Repository to a Project

```bash
jf api /artifactory/api/repositories/my-existing-repo -X POST \
  -H "Content-Type: application/json" \
  -d '{"projectKey": "myproj"}'
```

### Full Repo Trio Setup (Remote → Local → Virtual)

#### MCP (preferred)

Call the three MCP tools in sequence with `sleep 1` between each:
1. `create_remote_repository` with upstream URL
2. `create_local_repository`
3. `create_virtual_repository` with `repositories: [local_key, remote_key]`

#### `jf api` fallback

```bash
PROJECT_KEY="myproj"
ECOSYSTEM="npm"
UPSTREAM_URL="https://registry.npmjs.org"

REMOTE_KEY="${PROJECT_KEY}-${ECOSYSTEM}-remote"
LOCAL_KEY="${PROJECT_KEY}-${ECOSYSTEM}-local"
VIRTUAL_KEY="${PROJECT_KEY}-${ECOSYSTEM}"

# 1. Remote
OUT=/tmp/jf-repo-remote-$$.json
jf api "/artifactory/api/repositories/$REMOTE_KEY" -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$REMOTE_KEY\",\"rclass\":\"remote\",\"packageType\":\"$ECOSYSTEM\",\"url\":\"$UPSTREAM_URL\",\"projectKey\":\"$PROJECT_KEY\"}" > "$OUT"
echo "$OUT"; [ $? -eq 0 ] && echo "Remote created" || cat "$OUT"
sleep 1

# 2. Local
OUT=/tmp/jf-repo-local-$$.json
jf api "/artifactory/api/repositories/$LOCAL_KEY" -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$LOCAL_KEY\",\"rclass\":\"local\",\"packageType\":\"$ECOSYSTEM\",\"projectKey\":\"$PROJECT_KEY\"}" > "$OUT"
echo "$OUT"; [ $? -eq 0 ] && echo "Local created" || cat "$OUT"
sleep 1

# 3. Virtual
OUT=/tmp/jf-repo-virtual-$$.json
jf api "/artifactory/api/repositories/$VIRTUAL_KEY" -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$VIRTUAL_KEY\",\"rclass\":\"virtual\",\"packageType\":\"$ECOSYSTEM\",\"repositories\":[\"$LOCAL_KEY\",\"$REMOTE_KEY\"],\"defaultDeploymentRepo\":\"$LOCAL_KEY\",\"projectKey\":\"$PROJECT_KEY\"}" > "$OUT"
echo "$OUT"; [ $? -eq 0 ] && echo "Virtual created" || cat "$OUT"
```

---

## Users

No MCP tool covers user management — always use `jf api`.

### Create a User

```bash
# Set password via env var — never hardcode
OUT=/tmp/jf-user-$$.json
jf api /access/api/v2/users -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"john\",
    \"password\": \"$USER_PASSWORD\",
    \"email\": \"john@example.com\",
    \"admin\": false,
    \"profile_updatable\": true,
    \"disable_ui_access\": false,
    \"groups\": [\"readers\"]
  }" > "$OUT"
echo "$OUT"
if [ $? -eq 0 ]; then
  echo "User created"
  # Force password change on first login
  jf api /access/api/v2/users/john/password/expire -X POST
else
  echo "ERROR (409 = already exists)"
  cat "$OUT"
fi
```

**Always expire the password immediately after creation** to force the user to set their own on first login.

**Never log or echo passwords.**

Every user must belong to at least one group. Default to `readers` if no group is specified.

### Check if User Exists

```bash
OUT=/tmp/jf-user-check-$$.json
jf api "/access/api/v2/users/$JFROG_USER_NAME" > "$OUT" 2>/dev/null
[ $? -eq 0 ] && echo "Exists" || echo "Does not exist"
```

### Update a User

```bash
jf api /access/api/v2/users/john \
  -X PATCH -H "Content-Type: application/json" \
  -d '{"email": "newemail@example.com"}'
```

### Delete a User

⚠️ **Destructive operation — requires explicit user confirmation before executing.**

```bash
jf api "/access/api/v2/users/john" -X DELETE
```

---

## Groups

No MCP tool covers group management — always use `jf api`.

### Create a Group

```bash
OUT=/tmp/jf-group-$$.json
jf api /access/api/v2/groups -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dev-team",
    "description": "Development team",
    "auto_join": false
  }' > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && echo "Group created" || { echo "ERROR (409 = already exists)"; cat "$OUT"; }
```

### Add Members to a Group

```bash
jf api /access/api/v2/groups/dev-team/members -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"add": ["john", "jane"]}'
```

### Create Groups Before Users

Always create groups **before** creating users so that users can be assigned to groups during creation.

---

## Environments

### MCP — List Environments (preferred)

```
Tool: list_jfrog_environments
(no required inputs)
Returns: list of all environment types with details
```

### `jf api` — List Environments

```bash
OUT=/tmp/jf-envs-$$.json
jf api /access/api/v1/environments > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

### `jf api` — Create an Environment

```bash
jf api /access/api/v1/environments \
  -X POST -H "Content-Type: application/json" \
  -d '{"name": "STAGING"}'
```

Environment names are uppercase by convention (e.g. `DEV`, `STAGING`, `PROD`).

---

## Project Membership

No MCP tool covers project membership — always use `jf api`.

### Available Project Roles

| Role | Description |
|------|-------------|
| Project Admin | Full project management |
| Developer | Deploy, read, manage builds |
| Contributor | Deploy and read artifacts |
| Viewer | Read-only access |
| Release Manager | Manage release bundles and lifecycle |
| Security Manager | Manage Xray policies and watches |
| AppTrust Manager | Manage AppTrust applications |
| Model Governor | Govern ML models |
| Model Developer | Develop ML models |

### Add a User to a Project

```bash
OUT=/tmp/jf-member-$$.json
jf api "/access/api/v1/projects/$PROJECT_KEY/users/john" -X PUT \
  -H "Content-Type: application/json" \
  -d '{"name": "john", "roles": ["Developer"]}' > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && echo "User added to project" || { echo "ERROR (409 = already a member)"; cat "$OUT"; }
```

### Remove a User from a Project

```bash
jf api "/access/api/v1/projects/$PROJECT_KEY/users/john" -X DELETE
```

### Add a Group to a Project

```bash
OUT=/tmp/jf-grp-member-$$.json
jf api "/access/api/v1/projects/$PROJECT_KEY/groups/dev-team" -X PUT \
  -H "Content-Type: application/json" \
  -d '{"name": "dev-team", "roles": ["Contributor"]}' > "$OUT"
echo "$OUT"
[ $? -eq 0 ] && echo "Group added to project" || { echo "ERROR (409 = already a member)"; cat "$OUT"; }
```

### List Project Members

```bash
# Users — response uses "members" key
OUT=/tmp/jf-proj-users-$$.json
jf api "/access/api/v1/projects/$PROJECT_KEY/users" > "$OUT"
echo "$OUT"
jq '.' "$OUT"

# Groups — response may use "members" or "groups" key depending on platform version
OUT=/tmp/jf-proj-groups-$$.json
jf api "/access/api/v1/projects/$PROJECT_KEY/groups" > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

### List Project Roles

```bash
OUT=/tmp/jf-proj-roles-$$.json
jf api "/access/api/v1/projects/$PROJECT_KEY/roles" > "$OUT"
echo "$OUT"
jq '.' "$OUT"
```

### Create a Custom Project Role

```bash
jf api "/access/api/v1/projects/$PROJECT_KEY/roles" \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "name": "QA Engineer",
    "description": "Read and annotate repos in DEV",
    "type": "CUSTOM",
    "environments": ["DEV"],
    "actions": ["READ_REPOSITORY", "ANNOTATE_REPOSITORY", "READ_BUILD"]
  }'
```

### Pre-Assignment Validation

Before assigning users or groups to a project, **verify they exist** on the platform. Check all users and groups first, collect all failures, then report and offer to create missing ones before proceeding.

```bash
# Validate user exists
OUT=/tmp/jf-val-user-$$.json
jf api "/access/api/v2/users/$JFROG_USER_NAME" > "$OUT" 2>/dev/null
[ $? -eq 0 ] || echo "MISSING: User '$JFROG_USER_NAME' does not exist"

# Validate group exists
OUT=/tmp/jf-val-grp-$$.json
jf api "/access/api/v2/groups/$GROUP_NAME" > "$OUT" 2>/dev/null
[ $? -eq 0 ] || echo "MISSING: Group '$GROUP_NAME' does not exist"
```

If any user or group is missing:
1. Do not assign any members yet
2. Report all missing users/groups
3. Offer to create them
4. Only after all are confirmed to exist, proceed with role assignment

---

## Full Onboarding Workflow

When a user asks to set up a new project with repositories, users, and groups, follow this order:

1. **Verify server** — run `jf config show`, confirm the correct server is active
2. **Create groups** — `jf api` (no MCP tool); before users, so group assignments work
3. **Create users** — `jf api` (no MCP tool); assign to groups, expire passwords
4. **Create project** — MCP `create_project` or `jf api`; validate project key format first
5. **Create repositories** — MCP tools or `jf api`; remote → local → virtual for each ecosystem
6. **Assign members** — `jf api` (no MCP tool); add users and groups to the project with appropriate roles

### MCP-first onboarding example (project + npm repos)

```
1. [jf api] Create group "dev-team"
2. [jf api] Create user "john", assign to "dev-team", expire password

3. create_project({
     project_key: "myapp",
     display_name: "My Application",
     description: "Main application project",
     admin_privileges: {manage_members: true, manage_resources: true, index_resources: true},
     storage_quota_bytes: -1
   })

4. create_remote_repository({key: "myapp-npm-remote", rclass: "remote", packageType: "npm",
     url: "https://registry.npmjs.org", projectKey: "myapp"})
   create_local_repository({key: "myapp-npm-local", rclass: "local", packageType: "npm", projectKey: "myapp"})
   create_virtual_repository({key: "myapp-npm", rclass: "virtual", packageType: "npm",
     repositories: ["myapp-npm-local", "myapp-npm-remote"], projectKey: "myapp"})

5. [jf api] Add "dev-team" to project "myapp" with role "Developer"
```

### `jf api` fallback onboarding example

```bash
PROJECT_KEY="myapp"
DISPLAY_NAME="My Application"

# 1. Create group
jf api /access/api/v2/groups -X POST -H "Content-Type: application/json" \
  -d '{"name":"dev-team","description":"Dev team"}'
sleep 1

# 2. Create user
jf api /access/api/v2/users -X POST -H "Content-Type: application/json" \
  -d "{\"username\":\"john\",\"password\":\"$USER_PASSWORD\",\"email\":\"john@example.com\",\"groups\":[\"dev-team\"]}"
jf api /access/api/v2/users/john/password/expire -X POST
sleep 1

# 3. Create project
jf api /access/api/v1/projects -X POST -H "Content-Type: application/json" \
  -d "{\"project_key\":\"$PROJECT_KEY\",\"display_name\":\"$DISPLAY_NAME\",\"admin_privileges\":{\"manage_members\":true,\"manage_resources\":true,\"index_resources\":true}}"
sleep 1

# 4. Create repos (remote → local → virtual)
jf api "/artifactory/api/repositories/$PROJECT_KEY-npm-remote" -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$PROJECT_KEY-npm-remote\",\"rclass\":\"remote\",\"packageType\":\"npm\",\"url\":\"https://registry.npmjs.org\",\"projectKey\":\"$PROJECT_KEY\"}"
sleep 1

jf api "/artifactory/api/repositories/$PROJECT_KEY-npm-local" -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$PROJECT_KEY-npm-local\",\"rclass\":\"local\",\"packageType\":\"npm\",\"projectKey\":\"$PROJECT_KEY\"}"
sleep 1

jf api "/artifactory/api/repositories/$PROJECT_KEY-npm" -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$PROJECT_KEY-npm\",\"rclass\":\"virtual\",\"packageType\":\"npm\",\"repositories\":[\"$PROJECT_KEY-npm-local\",\"$PROJECT_KEY-npm-remote\"],\"defaultDeploymentRepo\":\"$PROJECT_KEY-npm-local\",\"projectKey\":\"$PROJECT_KEY\"}"
sleep 1

# 5. Assign group to project
jf api "/access/api/v1/projects/$PROJECT_KEY/groups/dev-team" -X PUT \
  -H "Content-Type: application/json" \
  -d '{"name":"dev-team","roles":["Developer"]}'
```

---

## Troubleshooting

### Project Creation Fails with 400
- Check the project key format: 2–32 chars, lowercase alphanumeric/hyphens, starts with a letter, no leading/trailing hyphens
- Ensure `display_name` is provided

### Repository Not Visible in Project
- Verify `projectKey` was included in the repo creation payload
- If omitted, Artifactory creates the repo outside any project — it won't appear in project-scoped queries
- Use `?project={key}` query parameter when listing repos by project
- To assign an existing repo to a project: `POST /artifactory/api/repositories/<key>` with `{"projectKey": "<key>"}`

### User Creation Fails with 400
- Check password meets requirements: 8+ chars, uppercase, lowercase, digit
- Verify email format is valid
- Ensure the username doesn't already exist (409 = already exists, treat as success)

### Cannot Assign User to Project (404)
- The user must exist on the platform before being assigned to a project
- Run the pre-assignment validation check first

### Project Groups List Looks Empty
- The response may use `members` for group entries, not `groups` — accept both keys when parsing

### Rate Limiting (403 on API calls)
- Add `sleep 1` between sequential `jf api` calls
- Check the response body: HTML error page = rate limited, JSON = permission error
