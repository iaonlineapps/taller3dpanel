#!/usr/bin/env bash
# Actualiza Taller3D Panel a la última versión de GitHub, sin tocar tus datos.
#
# Uso en la Pi (o en cualquier Linux con Docker), por SSH:
#   curl -fsSL https://raw.githubusercontent.com/iaonlineapps/taller3dpanel/main/update.sh | bash
# o, desde la carpeta de Taller3D Panel:
#   ./update.sh
#
# Qué hace: busca la carpeta donde está instalado el contenedor "taller3d-panel",
# baja el código nuevo, reconstruye, arranca y te dice la versión.
# No toca .env, docker-compose.yaml ni la carpeta de datos (DATA_DIR).
set -euo pipefail

NAME="Taller3D Panel"
REPO="https://github.com/iaonlineapps/taller3dpanel.git"
CONTAINER="taller3d-panel"
PORT_DEFAULT="8095"
URL_PATH=""
# Archivos que se copian además de public/ (si la carpeta no es una copia de git)
COPY_FILES="server.js bambu.js printers.js telegram.js ipp.js VERSION Dockerfile entrypoint.sh update.sh uninstall.sh etiquetas.sh"
export GIT_TERMINAL_PROMPT=0

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
# Ejecuta como root (con sudo si hace falta)
root() { if [ "$(id -u)" = "0" ]; then "$@"; else sudo "$@"; fi; }
# Ejecuta como el usuario dueño de la carpeta
as_owner() { local u="$1"; shift; if [ "$(id -un)" = "$u" ]; then "$@"; else sudo -u "$u" "$@"; fi; }

main() {
  command -v docker >/dev/null 2>&1 || fail "Docker no está instalado."
  command -v git >/dev/null 2>&1 || fail "Falta git. Instálalo con: sudo apt install -y git"

  # 1. Carpeta de la instalación
  say "Buscando dónde está instalado $NAME"
  local CODE="" here
  if root docker inspect "$CONTAINER" >/dev/null 2>&1; then
    CODE=$(root docker inspect "$CONTAINER" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null || true)
  fi
  here=$(pwd)
  if [ -z "$CODE" ] && [ -f /mnt/datos/apps/taller3d-panel/docker-compose.yaml ]; then
    CODE=/mnt/datos/apps/taller3d-panel
  fi
  if [ -z "$CODE" ] && grep -qs "container_name: $CONTAINER" "$here/docker-compose.yaml"; then
    CODE="$here"
  fi
  { [ -n "$CODE" ] && [ -d "$CODE" ]; } || fail "No encuentro el contenedor \"$CONTAINER\". ¿Está instalado $NAME? Míralo con: sudo docker ps -a"
  echo "Carpeta: $CODE"
  cd "$CODE"
  local OLD NEW PORT IP
  OLD=$(cat VERSION 2>/dev/null || echo "?")

  if [ ! -f Dockerfile ]; then
    # Instalación con la imagen ya hecha (CasaOS, Runtipi, image: ghcr.io/...): basta con bajarla
    say "Bajando la imagen nueva"
    root docker compose pull
    root docker compose up -d
  else
    # 2. Código nuevo
    say "Bajando el código nuevo de GitHub"
    local UPDATED="" TMP f
    # Si la carpeta es una copia de git (por ejemplo la versión privada, con su propio acceso), se actualiza
    # desde su repositorio: git fetch + reset --hard origin/main (no toca .env ni los datos, que no están en git).
    if [ -d .git ]; then
      local OWN; OWN=$(stat -c %U .)
      if as_owner "$OWN" git -c safe.directory="$CODE" fetch -q origin && as_owner "$OWN" git -c safe.directory="$CODE" reset -q --hard origin/main; then
        UPDATED=1; echo "Actualizado desde $(as_owner "$OWN" git -c safe.directory="$CODE" remote get-url origin | sed -E 's#https://[^@]*@#https://#')"
      else
        echo "No he podido usar git en esta carpeta. Copio el código nuevo encima."
      fi
    fi
    if [ -z "$UPDATED" ]; then
      TMP=$(mktemp -d)
      git clone -q --depth 1 "$REPO" "$TMP/src"
      root rm -rf public
      root cp -a "$TMP/src/public" public
      for f in $COPY_FILES; do
        if [ -e "$TMP/src/$f" ]; then root cp -a "$TMP/src/$f" "$f"; fi
      done
      rm -rf "$TMP"
    fi
    root chmod -R a+rX public

    # 3. Reconstruir y arrancar
    say "Reconstruyendo (en la Pi tarda un par de minutos)"
    root docker compose build
    root docker compose up -d
    root docker image prune -f >/dev/null 2>&1 || true
  fi

  # 4. Versión
  say "Comprobando"
  sleep 3
  NEW=$(root docker exec "$CONTAINER" cat /app/VERSION 2>/dev/null || cat VERSION 2>/dev/null || echo "?")
  PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)
  IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  echo
  echo "$NAME actualizado: versión $OLD -> $NEW"
  root docker ps --filter "name=^${CONTAINER}\$" --format 'Estado: {{.Status}}'
  echo "Ábrelo en: http://${IP:-IP-DE-TU-PI}:${PORT:-$PORT_DEFAULT}${URL_PATH}"
}

# Todo va dentro de main() y se llama al final, para que "curl ... | bash" lea el script entero antes de empezar
main "$@" </dev/null
