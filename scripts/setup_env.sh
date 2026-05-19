#!/usr/bin/env bash
set -euo pipefail

if command -v python3 >/dev/null 2>&1; then
  python_cmd="python3"
elif command -v python >/dev/null 2>&1; then
  python_cmd="python"
else
  echo "Python 3 not found in PATH" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
venv_dir="$project_root/.venv"
requirements="$project_root/requirements.txt"

if [ -d "$venv_dir" ] && [ "${1:-}" != "--force" ]; then
  echo ".venv already exists. Use --force to recreate."
  exit 0
fi

rm -rf "$venv_dir"
"$python_cmd" -m venv "$venv_dir"
source "$venv_dir/bin/activate"
python -m pip install --upgrade pip

if [ -f "$requirements" ]; then
  python -m pip install -r "$requirements"
fi

echo "Environment created and activated. To activate later: source .venv/bin/activate"
