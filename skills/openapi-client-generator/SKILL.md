---
name: openapi-client-generator
description: How to generate a typed API client from an OpenAPI spec using the `OpenApiClientGenerator.Core` CLI. Load this whenever the user asks to generate, regenerate, or scaffold a client from an OpenAPI / Swagger spec — typical triggers: "generate the client", "regen from openapi", "scaffold the SDK", or when a bootstrapp.cloud backend exposes an OpenAPI document that the client app needs to consume.
---

# Generating an API client with `OpenApiClientGenerator.Core`

This skill runs a CLI that reads an OpenAPI spec and emits a typed client.
There are exactly two steps: make sure the generator is installed, then
invoke it. Do both from the current working directory.

## Step 1 — Ensure the generator is available

Run the install script that ships with this skill. It detects the host
OS and architecture, downloads the matching pre-built archive, extracts
the executable to `$HOME/.local/bin` (override with
`OPENAPI_GENERATOR_INSTALL_DIR`), and exits early if the tool is already
on `PATH`:

```bash
bash "${CLAUDE_PLUGIN_ROOT:-.}/skills/openapi-client-generator/install.sh"
```

The script handles linux / macOS / Windows-via-git-bash and x64 / arm64.
It uses `curl` (or `wget` as a fallback) plus `unzip`.

If the install script exits non-zero with "not on PATH", ensure the
install directory is on `PATH` for the current shell (e.g.
`export PATH="$HOME/.local/bin:$PATH"`) and re-run the check below.

Verify the executable is callable before continuing:

```bash
command -v OpenApiClientGenerator.Core >/dev/null 2>&1 \
  || { echo "OpenApiClientGenerator.Core is not available after install"; exit 1; }
```

If the check still fails, stop and ask the user — do not fall back to
editing the generated code by hand.

## Step 2 — Invoke the generator

Run from the **current working directory** (the project root for the
client app):

```bash
OpenApiClientGenerator.Core \
  --input <path_to_spec_file> \
  --output <output_path> \
  --namespace <namespace_for_generated_classes> \
  --client_name <client_name>
```

### Parameters

- `--input <path_to_spec_file>` — path or URL to the OpenAPI spec
  (`.json` or `.yaml`). For a bootstrapp.cloud backend this is usually
  the spec URL reported by the `bootstrapp` MCP server or a file the user
  downloaded from the backend console.
- `--output <output_path>` — directory where generated source files will
  be written. Use a dedicated folder (e.g. `src/generated/` or `lib/api/`)
  so the generator can overwrite on regeneration without touching
  hand-written code.
- `--namespace <namespace_for_generated_classes>` — namespace for all
  generated types. If a `BOOTSTRAPP.md` exists in the project, default to
  the app name recorded there (e.g. `<app-name>.Client`) so generated
  classes line up with the backend's base namespace. Otherwise ask the
  user.
- `--client_name <client_name>` — the class name of the top-level client
  (e.g. `FranchisorClient`). PascalCase. Keep it specific to the
  backend; do not use generic names like `ApiClient` when the project
  will consume more than one service.

## Gathering the parameter values

Before running anything, confirm you have all four parameters:

1. **Spec file.** Ask the user to point you at the OpenAPI document. Accept
   either a local path or a URL. For bootstrapp backends, check the MCP
   server first — it typically exposes the spec URL.
2. **Output path.** If the project already has a generated folder, reuse
   it; otherwise propose one and confirm with the user before writing.
3. **Namespace.** Read `BOOTSTRAPP.md` if present and default to
   `<app-name>.Client`. Otherwise ask.
4. **Client name.** Derive from the app name in PascalCase + `Client` (e.g.
   `franchisor` → `FranchisorClient`) as a default, and confirm.

Run the generator only once you have all four. Do not guess.

## After a successful run

- Show the user the command you ran and a one-line summary of what
  changed (how many files were written, where).
- If the generated folder is new, remind the user to add it to the
  project's gitignore rules *only* if the team regenerates locally and
  does not commit the output; otherwise leave it tracked.
- If the project has type checking / a build, run it to confirm the
  generated code compiles in context.

## Things to never do

- Don't hand-edit files inside the generated output directory — they will
  be overwritten on the next run. Wrappers and customizations belong in
  a separate module that imports the generated types.
- Don't invent parameter values. If any of the four required inputs is
  unclear, stop and ask.
- Don't run the generator without verifying the executable is installed
  first — a missing tool produces confusing errors downstream.

## When to escalate to the user

- The install script fails (unsupported OS/arch, download URL
  unreachable, no curl/wget/unzip on the machine, etc.) — report the
  exact error and ask rather than hand-rolling a workaround.
- The spec URL requires auth and you don't have credentials — ask how
  to fetch it locally first.
- The project already contains a generated folder whose namespace or
  client name disagrees with the defaults above — surface the conflict
  and let the user pick.
