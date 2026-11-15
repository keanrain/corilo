#!/usr/bin/env bash
set -euo pipefail
# Fresh checkout and dedicated container avoid any reuse of com.termux-built objects.
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
# The current 32 GiB cloud disk filled before compiling the first package.
# Use a dedicated builder with space for image, container, sources and Node host/target builds.
python3 - "$repo_root" <<'CHECK_SPACE'
import shutil,sys
free=shutil.disk_usage(sys.argv[1]).free
if free < 80*1024**3:raise SystemExit(f'Runtime build requires at least 80 GiB free (conservative budget); available {free/1024**3:.1f} GiB')
CHECK_SPACE
runtime_checkout="$repo_root/.local/termux-packages"
metadata="$repo_root/android/runtime-source.json"
readarray -t settings < <(python3 - "$metadata" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
for k in ['termuxPackagesCommit','builderImage','applicationId','additionalPackages']:print(s[k])
PY
)
if [[ ! -d "$runtime_checkout/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/termux/termux-packages.git "$runtime_checkout"
  git -C "$runtime_checkout" checkout "${settings[0]}"
fi
[[ $(git -C "$runtime_checkout" rev-parse HEAD) == "${settings[0]}" ]] || { echo 'Unexpected Termux revision'; exit 1; }
python3 - "$runtime_checkout/scripts/properties.sh" "${settings[2]}" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);s=p.read_text();old='TERMUX_APP__PACKAGE_NAME="com.termux"';new=f'TERMUX_APP__PACKAGE_NAME="{sys.argv[2]}"'
if old in s:p.write_text(s.replace(old,new,1))
elif new not in s:raise SystemExit('Termux package-name patch no longer matches')
PY
# The image's builder UID is 1001. Change only its UID and small writable directories,
# never recursively chown the preinstalled NDK: overlay copy-up wastes many gigabytes.
container="corilo-runtime-build-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
mkdir -p "$runtime_checkout/output" "$runtime_checkout/build-tools"
docker run --name "$container" --detach --volume "$runtime_checkout:/home/builder/termux-packages" "${settings[1]}" sleep infinity >/dev/null
docker exec --user root "$container" sh -c '[ "$(id -u builder)" = "$1" ] || usermod -u "$1" builder' sh "$(id -u)"
docker exec --user root "$container" sh -c 'chown builder /home/builder /data /data/data; mkdir -p /home/builder/.termux-build; chown builder /home/builder/.termux-build'
# In environments with an organizational TLS root, import that trusted CA into the
# builder's trust store before running. Never disable certificate verification.
docker exec "$container" ./scripts/build-bootstraps.sh --architectures aarch64 --add "${settings[3]}"
sha256sum "$runtime_checkout/bootstrap-aarch64.zip"
printf 'Next: prepare-payload.py --bootstrap <archive> --sha256 <verified digest>\n'
