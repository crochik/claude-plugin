#!/usr/bin/env bash
# Generate a typed API client from a saved OpenAPI spec by invoking the
# language-specific `bootstrapp-gen-<language>` executable on PATH.
#
# Usage:
#   generate_api.sh <absolute_path_to_openapi_spec> <output_directory> <language>
#
# Arguments:
#   $1  Absolute path to the OpenAPI spec file (.json or .yaml).
#   $2  Directory where generated client files will be written. Created
#       if it does not exist. Existing contents may be overwritten.
#   $3  Target language (e.g. `typescript`, `flutter`). Selects the
#       `bootstrapp-gen-<language>` executable that performs generation.

set -euo pipefail

log() { printf '[generate_api] %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

if [ "$#" -ne 3 ]; then
    die "usage: $0 <absolute_path_to_openapi_spec> <output_directory> <language>"
fi

spec_path="$1"
output_dir="$2"
language="$3"

case "$spec_path" in
    /*) ;;
    *)  die "spec path must be absolute, got: $spec_path" ;;
esac

[ -f "$spec_path" ] || die "spec file does not exist: $spec_path"

generator="bootstrapp-gen-${language}"
command -v "$generator" >/dev/null 2>&1 \
    || die "generator not on PATH: $generator (install it or check the language argument)"

mkdir -p "$output_dir"

log "spec:      $spec_path"
log "output:    $output_dir"
log "generator: $generator"

exec "$generator" "$spec_path" "$output_dir"
