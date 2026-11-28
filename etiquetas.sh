#!/usr/bin/env bash
# Taller3D Panel · instala una impresora de etiquetas Brother QL (USB) en la Raspberry Pi
# y la comparte en la red de casa con el nombre «Etiquetas». Así sale en el ordenador y en el
# móvil al pulsar «Imprimir» (Windows, Mac, Android e iPhone).
#
# Uso (por SSH en la Raspberry, con la impresora enchufada por USB y encendida):
#   curl -fsSL https://raw.githubusercontent.com/iaonlineapps/taller3dpanel/main/etiquetas.sh | bash
#
# Se puede repetir sin problema: si la impresora ya está, la vuelve a configurar.
# Install a Brother QL label printer (USB) on the Raspberry Pi and share it at home as «Etiquetas».
set -euo pipefail
QUEUE="${QUEUE:-Etiquetas}"
SIZE="${SIZE:-62x29mm}"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

# Todo va dentro de main para que «curl ... | bash» lea el script entero antes de empezar.
main() {

echo "== Taller3D Panel · impresora de etiquetas =="
echo "1/5 Instalando CUPS y el driver de Brother QL (tarda un par de minutos)..."
$SUDO apt-get update -qq
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cups printer-driver-ptouch avahi-daemon >/dev/null

echo "2/5 Activando CUPS y compartiendo impresoras en la red de casa..."
$SUDO systemctl enable --now cups avahi-daemon >/dev/null 2>&1 || true
[ "$(id -u)" -ne 0 ] && $SUDO usermod -aG lpadmin "$USER" || true
$SUDO cupsctl --share-printers --remote-any
sleep 2

echo "3/5 Buscando la impresora por USB..."
URI=""
for _ in 1 2 3 4 5; do
  URI=$($SUDO lpinfo --include-schemes usb -v 2>/dev/null | grep -o 'usb://Brother/QL-[^ ]*' | head -1 || true)
  [ -n "$URI" ] && break; sleep 3
done
if [ -z "$URI" ]; then
  echo
  echo "No veo ninguna Brother QL por USB."
  echo " - Comprueba que está enchufada a la Raspberry y encendida."
  echo " - Si tiene encendida la luz verde «Editor Lite», mantén pulsado ese botón hasta que se apague."
  echo "Luego vuelve a pegar la misma línea."
  exit 1
fi
MODEL=$(echo "$URI" | sed -e 's#usb://Brother/##' -e 's#?.*##' -e 's#%20# #g')
echo "    Encontrada: Brother $MODEL"

echo "4/5 Instalando la impresora «$QUEUE»..."
PPD=$($SUDO lpinfo -m 2>/dev/null | awk '{print $1}' | grep -i "Brother-${MODEL// /-}-ptouch-ql.ppd" | head -1 || true)
[ -z "$PPD" ] && PPD=$($SUDO lpinfo -m 2>/dev/null | awk '{print $1}' | grep -i "ptouch.*${MODEL// /-}" | head -1 || true)
if [ -z "$PPD" ]; then echo "No encuentro el driver para la $MODEL. Avisa a Claude con este mensaje."; exit 1; fi
$SUDO lpadmin -x "$QUEUE" 2>/dev/null || true
$SUDO lpadmin -p "$QUEUE" -E -v "$URI" -m "$PPD" -D "Brother $MODEL (etiquetas 62 mm)" -L "Taller" \
  -o printer-is-shared=true -o PageSize="$SIZE" -o media="$SIZE"
$SUDO cupsenable "$QUEUE"; $SUDO cupsaccept "$QUEUE"

echo "5/5 Imprimiendo una etiqueta de prueba..."
printf 'Taller3D Panel\nEtiquetas OK\n' | lp -d "$QUEUE" -o PageSize="$SIZE" -o cpi=14 -o lpi=8 -o page-left=10 -o page-top=8 >/dev/null 2>&1 \
  || echo "    (No se pudo mandar la prueba; la impresora sí está instalada)"

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "Listo. La impresora «$QUEUE» ya está compartida en casa."
echo " - En el móvil y el ordenador sale sola al pulsar «Imprimir» (puede tardar un minuto)."
echo " - Si el ordenador no la ve, añádela a mano con esta dirección:"
echo "     http://${IP:-IP-de-la-Raspberry}:631/printers/$QUEUE"
echo " - Panel de la impresora (cola, cancelar trabajos): http://${IP:-IP-de-la-Raspberry}:631"
}
main "$@" </dev/null
