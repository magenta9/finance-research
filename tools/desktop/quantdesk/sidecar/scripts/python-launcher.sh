#!/usr/bin/env bash
set -euo pipefail

script_path="$1"
shift || true

launcher_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sidecar_root="$(cd "${launcher_dir}/.." && pwd)"
venv_python="${sidecar_root}/.venv/bin/python"
venv_python_home="${sidecar_root}/.venv"
is_packaged=0

case "${sidecar_root}" in
    */Contents/Resources/sidecar)
        is_packaged=1
        ;;
esac

export PYTHONDONTWRITEBYTECODE=1

for stdlib_dir in "${venv_python_home}"/lib/python*; do
    if [[ ! -d "${stdlib_dir}" ]]; then
        continue
    fi

    python_version="$(basename "${stdlib_dir}")"

    if [[ -f "${venv_python_home}/lib/lib${python_version}.dylib" ]]; then
        export PYTHONHOME="${venv_python_home}"
        break
    fi
done

if [[ -x "${venv_python}" ]]; then
    exec "${venv_python}" "${script_path}" "$@"
fi

if [[ "${is_packaged}" == "1" ]]; then
    echo "Missing bundled Python executable: ${venv_python}" >&2
    exit 1
fi

if command -v uv >/dev/null 2>&1; then
    exec uv run --directory "${sidecar_root}" python "${script_path}" "$@"
fi

exec python3 "${script_path}" "$@"
