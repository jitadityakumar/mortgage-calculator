#!/usr/bin/env bash
# Runs the full automated test suite for the mortgage calculator.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

npm run test -- "$@"
