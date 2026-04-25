---
name: openapi-client-generator
description: How to generate a typed API client for a bootstrapp.cloud app. Calls the `bootstrapp` MCP server's `generate_openapi_spec` tool to obtain the spec, saves it locally, then runs the local `generate_api.sh` script to emit client code. Load this whenever the user asks to generate, regenerate, or scaffold a client from a bootstrapp backend — typical triggers: "generate the client", "regen the api client", "scaffold the SDK".
---

# Generating an API client for a bootstrapp.cloud app

There are three steps, in order:

1. Ask the `bootstrapp` MCP server for the OpenAPI spec.
2. Download and save the spec to a local file.
3. Run the local `generate_api.sh` script, passing the absolute path
   to the saved spec and the output directory for the generated client.

Do all three from the project root (the client app's working directory).

## Step 1 — Get the spec URL from the MCP server

Call the `mcp__bootstrapp__generate_openapi_spec` tool. It takes no
arguments and returns a URL pointing at the spec for the currently
selected backend project.

If the call fails with an auth error, stop and tell the user to
complete the OAuth browser flow for the `bootstrapp` MCP server
before retrying.

## Step 2 — Save the spec locally

Download the URL returned in step 1 and write it to a file in the
project. Default location: `openapi.json` (or `openapi.yaml` if the
URL serves YAML) at the project root. If the project already has a
saved spec, overwrite it in place so the output stays stable across
regenerations.

```bash
curl -fsSL "<spec_url_from_step_1>" -o openapi.json
```

Confirm the file is non-empty and well-formed before continuing.

## Step 3 — Run `generate_api.sh`

The generator script ships with this skill at
`${CLAUDE_PLUGIN_ROOT}/skills/openapi-client-generator/generate_api.sh`.
Invoke it with two positional arguments:

1. The **absolute path** to the saved spec file from step 2.
2. The path to the directory where generated client files should be
   written (e.g. `src/generated/` or `lib/api/`). Use a dedicated
   folder so the generator can overwrite on regeneration without
   touching hand-written code.

```bash
bash "${CLAUDE_PLUGIN_ROOT:-.}/skills/openapi-client-generator/generate_api.sh" \
  "$(pwd)/openapi.json" \
  src/generated
```

The first argument **must be absolute** — pass `"$(pwd)/<file>"` or
`realpath <file>`, not a relative path.

## Gathering the parameter values

Before running anything, confirm:

- **Spec file path.** Default to `openapi.json` at the project root.
  Reuse the existing path if one is already there.
- **Output directory.** If the project already has a generated folder,
  reuse it; otherwise propose one (e.g. `src/generated/`) and confirm
  with the user before writing.

## After a successful run

- Show the user the command you ran and a one-line summary of what
  changed (how many files were written, where).
- If the generated folder is new, remind the user to add it to
  `.gitignore` only if the team regenerates locally and does not
  commit the output; otherwise leave it tracked.
- If the project has type checking or a build, run it to confirm the
  generated code compiles in context.

## Things to never do

- Don't hand-edit files inside the generated output directory — they
  will be overwritten on the next run. Wrappers and customizations
  belong in a separate module that imports the generated types.
- Don't pass a relative path as the first argument to
  `generate_api.sh` — the script expects an absolute path.
- Don't skip step 1 by guessing a spec URL or reusing a stale local
  file when the user asks for a fresh regeneration.

## When to escalate to the user

- The MCP `generate_openapi_spec` call fails or returns an
  unexpected payload — surface the error and ask, don't fabricate a
  spec.
- `generate_api.sh` is missing from the skill directory or fails to
  run — surface the exact error rather than guessing at workarounds.
- The spec download URL requires extra auth headers — ask the user
  how to fetch it.
