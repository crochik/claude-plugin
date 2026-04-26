---
name: openapi-client-generator
description: How to generate a typed API client for a bootstrapp.cloud app. Calls the `bootstrapp` MCP server's `generate_openapi_spec` tool to obtain the spec, saves it locally, then runs the local `generate_api.sh` script to emit client code. Load this whenever the user asks to generate, regenerate, or scaffold a client from a bootstrapp backend — typical triggers: "generate the client", "regen the api client", "scaffold the SDK".
---

# Generating an API client for a bootstrapp.cloud app

There are three steps, in strict order — each one depends on the
previous step having completed successfully:

1. Ask the `bootstrapp` MCP server for the OpenAPI spec.
2. Download and save the spec to a local file.
3. Run the local `generate_api.sh` script, passing the absolute path
   to the saved spec, the output directory for the generated client,
   and the target language.

Do all three from the project root (the client app's working directory).

## Prerequisite — classes must already exist on the backend

The OpenAPI spec is **generated from the current state of the backend
project**. Endpoints, request/response schemas, and filter signatures
only appear in the spec for classes and actions that have already been
registered on bootstrapp.cloud. Before step 1:

- Every class in `BOOTSTRAPP.md`'s class registry must have been
  created via `mcp__bootstrapp__add_object_class` (verify with
  `mcp__bootstrapp__get_object_classes`).
- Every action in the action registry must have been registered.

If you skip this and call `mcp__bootstrapp__generate_openapi_spec`
first, the returned spec will be missing the classes and actions you
just designed, and the generated client will not compile against them.
When the schema changes later, re-run class/action creation **before**
regenerating the spec — the order is the same every time.

## Step 1 — Get the spec URL from the MCP server

Call the `mcp__bootstrapp__generate_openapi_spec` tool. Pass
`applicationName` — the snake_case app name recorded at the top of
`BOOTSTRAPP.md` (the same name used as the `appName` argument to
`mcp__bootstrapp__add_object_class` in the previous step). The tool
returns a URL pointing at the spec for the app's backend.

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

Only run this step **after** step 2 has written a valid spec file to
disk. The generator reads from the local file path you pass it; it
does not fetch the spec itself. Running it against a stale or missing
file produces a stale or broken client.

The generator script ships with this skill at
`${CLAUDE_PLUGIN_ROOT}/skills/openapi-client-generator/generate_api.sh`.
It is a thin wrapper that delegates to a language-specific executable
on `PATH` named `bootstrapp-gen-<language>` (e.g.
`bootstrapp-gen-typescript`, `bootstrapp-gen-flutter`). Invoke the
wrapper with three positional arguments:

1. The **absolute path** to the saved spec file from step 2.
2. The path to the directory where generated client files should be
   written (e.g. `src/generated/` or `lib/api/`). Use a dedicated
   folder so the generator can overwrite on regeneration without
   touching hand-written code.
3. The target language — the suffix that selects the
   `bootstrapp-gen-<language>` binary. Use `typescript` for TypeScript
   apps, `flutter` for Flutter apps.

```bash
bash "${CLAUDE_PLUGIN_ROOT:-.}/skills/openapi-client-generator/generate_api.sh" \
  "$(pwd)/openapi.json" \
  src/generated \
  typescript
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
- **Language.** Match the client app's platform — `typescript` for
  TypeScript/web apps, `flutter` for Flutter apps. The wrapper will
  fail fast if `bootstrapp-gen-<language>` is not on `PATH`.

## After a successful run

- Show the user the command you ran and a one-line summary of what
  changed (how many files were written, where).
- If the generated folder is new, remind the user to add it to
  `.gitignore` only if the team regenerates locally and does not
  commit the output; otherwise leave it tracked.
- If the project has type checking or a build, run it to confirm the
  generated code compiles in context.

### Filter endpoints

The generated client exposes one **filter** method per top-level class.
It accepts the conditions array specified in the
[`bootstrapp-usage`](../bootstrapp-usage/SKILL.md) skill (AND-array of
`{field, operator, value?}` over `Eq, Ne, Gt, Gte, Lt, Lte, In,
Exists`). Sort and limit support depends on the spec — inspect the
generated method signature; if absent, sort and slice client-side after
the call. Use these methods to back named views (recorded in
`BOOTSTRAPP.md`) and ad-hoc on-demand filters alike.

## Things to never do

- Don't hand-edit files inside the generated output directory — they
  will be overwritten on the next run. Wrappers and customizations
  belong in a separate module that imports the generated types.
- Don't pass a relative path as the first argument to
  `generate_api.sh` — the script expects an absolute path.
- Don't skip step 1 by guessing a spec URL or reusing a stale local
  file when the user asks for a fresh regeneration.
- Don't call `mcp__bootstrapp__generate_openapi_spec` before the
  classes and actions exist on the backend — the spec reflects
  current backend state, so a premature call yields a spec that is
  missing the very endpoints you are trying to generate a client for.
- Don't run `generate_api.sh` before step 2 has written the spec
  file — the script reads from the local path, not the network.

## When to escalate to the user

- The MCP `generate_openapi_spec` call fails or returns an
  unexpected payload — surface the error and ask, don't fabricate a
  spec.
- `generate_api.sh` is missing from the skill directory or fails to
  run — surface the exact error rather than guessing at workarounds.
- `bootstrapp-gen-<language>` is not on `PATH` — tell the user which
  binary is missing and ask how they want to install it; do not fall
  back to a different language silently.
- The spec download URL requires extra auth headers — ask the user
  how to fetch it.
