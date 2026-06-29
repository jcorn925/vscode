#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node --experimental-strip-types "$ROOT/.agents/skills/milestone-evaluator/scripts/run-milestones.mts" "$@"
