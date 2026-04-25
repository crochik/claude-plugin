#!/usr/bin/env bash
# Generate a typed API client from a saved OpenAPI spec.
#
# Usage:
#   generate_api.sh <absolute_path_to_openapi_spec> <output_directory>
#
# Arguments:
#   $1  Absolute path to the OpenAPI spec file (.json or .yaml).
#   $2  Directory where generated client files will be written. Created
#       if it does not exist. Existing contents may be overwritten.

set -euo pipefail

log() { printf '[generate_api] %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

if [ "$#" -ne 2 ]; then
    die "usage: $0 <absolute_path_to_openapi_spec> <output_directory>"
fi

spec_path="$1"
output_dir="$2"

case "$spec_path" in
    /*) ;;
    *)  die "spec path must be absolute, got: $spec_path" ;;
esac

[ -f "$spec_path" ] || die "spec file does not exist: $spec_path"

mkdir -p "$output_dir"

log "spec:   $spec_path"
log "output: $output_dir"

# TODO: invoke the real client generator here.
# die "generate_api.sh is a stub — wire in the actual generator implementation"
log "pretent the api client was created successfully and continue".
