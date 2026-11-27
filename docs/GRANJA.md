# Granja de impresoras y servidor de impresión

Guía para usar Taller3D Panel con muchas impresoras, desde 2 hasta 100 o más, y ver y controlar las
**Bambu Lab** desde el navegador o el móvil.

## 1. Cómo funciona (un solo equipo hace de todo)

```
           Tu red de casa o del taller (el mismo router, por cable o por Wi-Fi)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                                                                             │
 │   ┌───────────────────────────┐        MQTT cifrado (puerto 8883)           │
 │   │  Raspberry Pi / PC Ubuntu │ ◄────────────────────────► Bambu X1C        │
 │   │  con Taller3D Panel       │ ◄────────────────────────► Bambu A1         │
 │   │  = app + servidor de      │ ◄────────────────────────► Bambu P1S …      │
 │   │    impresión              │                                             │
 │   └─────────────▲─────────────┘                                             │
 │                 │ http://IP-DEL-EQUIPO:8095                                 │
 │       móviles, tablets, PCs, app Android, lector QR                         │
 └─────────────────────────────────────────────────────────────────────────────┘
```

- **No hace falta un servidor de impresión aparte.** Al instalar Taller3D Panel, ese mismo equipo:
  - sirve la app (ventas, stock, clientes…);
  - habla con las impresoras por la red local.
- El equipo tiene que estar **en la misma red** que las impresoras. Las impresoras pueden ir **por Wi-Fi
  o por cable**: «LAN» significa red local, no cable.
- Los códigos de acceso de las impresoras se guardan **solo en el servidor**. Nunca se mandan al
  navegador ni salen en las copias que descargas.

### ¿Qué equipo uso?

| Equipo | Para cuántas impresoras | Notas |
|---|---|---|
| Raspberry Pi 4 (2 GB o más) | Hasta 50 o más | Silenciosa y gasta 5 W. Mejor con disco USB o SSD que con tarjeta SD. |
| Raspberry Pi 5 | 100 o más | La recomendada para granjas grandes. |
| PC viejo o mini PC con Ubuntu Server / Debian | 100 o más | Cualquier equipo con 2 GB de RAM sirve. |
| NAS con Docker (Synology, Unraid, CasaOS…) | 100 o más | Si ya tienes uno encendido siempre. |

Cada impresora conectada gasta muy poco (una conexión abierta y unos pocos mensajes por segundo).

### ¿Y si pongo la app en un servidor de internet (VPS)?

Un servidor de internet **no ve las impresoras de tu casa**. La forma sencilla es:

1. Instala la app **en casa**, en la Raspberry o el PC.
2. Para entrar desde fuera, usa un túnel: Cloudflare Tunnel, Pangolin o Tailscale. Pon
   `TRUST_PROXY=1` en `.env` si usas un proxy.

Así tienes la app accesible desde cualquier sitio y el servidor de impresión dentro de tu red.

## 2. Instalar el equipo

### Raspberry Pi

1. Graba **Raspberry Pi OS Lite (64-bit)** con Raspberry Pi Imager. En el engranaje, activa SSH y pon
   tu usuario y tu Wi-Fi, o conecta un cable de red.
2. Entra por SSH (`ssh usuario@IP-DE-LA-PI`) y sigue con «Instalar la app».

### PC con Ubuntu Server o Debian

1. Instala Ubuntu Server 24.04 o Debian 12 (con la opción «OpenSSH server»).
2. Entra por SSH y sigue con «Instalar la app».

### Instalar la app (igual en todos)

```bash
curl -fsSL https://get.docker.com | sh            # instala Docker (si no lo tienes)
sudo usermod -aG docker $USER && newgrp docker    # para usar Docker sin sudo
git clone https://github.com/iaonlineapps/taller3dpanel.git
cd taller3dpanel
./install.sh      # la primera vez crea el archivo .env
nano .env         # elige DATA_DIR (dónde se guardan los datos) y el puerto
./install.sh      # instala y arranca
```

Abre `http://IP-DEL-EQUIPO:8095` y crea el administrador.

**Dale una IP fija al equipo** en tu router (busca «DHCP estático» o «reserva de IP»), para que la
dirección no cambie.

## 3. Preparar cada impresora Bambu Lab

En la pantalla de la impresora:

1. **Ajustes → Red (WLAN / LAN)**:
   - Activa **«Solo LAN»** (LAN Only Mode).
   - Activa **«Modo desarrollador»** (Developer Mode). En los firmwares nuevos solo aparece cuando
     «Solo LAN» está activo.
2. En esa pantalla tienes la **IP** de la impresora y el **código de acceso** (8 caracteres).
3. En **Ajustes → Dispositivo** (o en la pegatina de detrás) tienes el **número de serie**.
4. En tu router, dale **IP fija** también a cada impresora.

> **Qué cambia en «Solo LAN»:** la impresora deja de usar la nube de Bambu. Bambu Handy desde fuera de
> casa y el envío por la nube no funcionan. **Bambu Studio y OrcaSlicer siguen imprimiendo por la red
> local** (añade la impresora por IP y código de acceso). Puedes volver al modo nube cuando quieras
> desactivando las dos opciones.

Modelos: X1 Carbon, X1E, P1P, P1S, P2S, A1, A1 mini, H2D y H2S (todas usan el mismo sistema).

## 3 bis. Sin modo LAN: nube de Bambu (solo ver)

Si tus impresoras están con Wi-Fi normal (modo nube, como vienen de fábrica) y no quieres pasarlas a
«Solo LAN», la app puede **ver** su estado a través de tu cuenta de Bambu Lab:

1. En la app: **Granja → ☁ Nube Bambu**. Pon el email y la contraseña de tu cuenta Bambu Lab.
2. Te llega un **código por email**: escríbelo.
3. Salen tus impresoras: **«Añadir a la granja»** (como nueva o vinculada a una que ya tengas).

Lo que se ve es el estado, el %, el tiempo que queda, la capa, las temperaturas, los colores del AMS y la
boquilla. También queda el historial (empezó, terminó, falló). **No se puede controlar**: para pausar o
parar sigue usando Bambu Handy o Bambu Studio. Bambu permite a programas de terceros leer el estado con
moderación; las órdenes van por Bambu Connect.

Cómo lo hace la app, para no molestar a Bambu:
- Una sola conexión por cuenta.
- Solo escucha lo que mandan las impresoras.
- Pide el estado completo una vez al conectar.
- Si la sesión caduca, intenta renovarla una vez y si no, te pide volver a entrar (no reintenta en bucle).

La contraseña no se guarda; la sesión se guarda solo en tu servidor. No funciona si tu cuenta tiene la
verificación en dos pasos con app de autenticación (con código por email sí).

## 4. Añadir las impresoras en la app

1. **Ajustes → Granja de impresoras → Activada.** En el menú aparece **«Granja»**.
2. **+ Añadir impresora**, o **+ Varias** para crear muchas de golpe (A1 01, A1 02…).
3. Abre cada una → **Editar** y rellena:
   - marca **«Bambu Lab en modo LAN»**;
   - pon la **IP**, el **nº de serie** y el **código de acceso**.

   El código solo lo puede guardar un administrador.
4. En unos segundos verás en directo:
   - el estado, el % y el tiempo que queda;
   - la capa y las temperaturas;
   - los colores del AMS.

   Y podrás **pausar, reanudar, parar, encender la luz y cambiar la velocidad**.
5. **Etiquetas QR** te da una hoja con el QR de cada impresora para pegarlo en la máquina. Al escanearlo
   se abre su ficha:
   - con el lector USB o Bluetooth;
   - con la cámara del móvil (abre la app directamente en esa impresora).

**Modo taller.** Botón «Modo taller» de la granja (o del menú): pantalla reducida para una tablet o el móvil, con una tarjeta grande por impresora, la cola de piezas por imprimir y botones grandes de «Terminada» (suma al stock) y «Falló».

**Historial y estadísticas.** El servidor apunta solo, aunque nadie tenga la web abierta:
- cuándo se enciende o se apaga cada impresora;
- cuándo empieza, se pausa, termina o falla cada impresión, y cuánto ha tardado.

En la granja tienes la **Actividad** de todas las impresoras y las **Estadísticas** por periodo (horas
imprimiendo, terminadas, fallidas y % de éxito). En la ficha de cada impresora sale su propio historial.
Con **«Avisarme al terminar»** el navegador te avisa cuando una acaba o falla (con la web abierta).

Las impresoras que no son Bambu o no están en modo LAN también se pueden añadir. Para esas llevas el
estado a mano: libre, imprimiendo (con el trabajo), mantenimiento o averiada. Al pulsar «Terminado» se
registra la impresión de la pieza y sube el stock.

## 5. Si una impresora no conecta

| Mensaje | Qué hacer |
|---|---|
| *Código de acceso incorrecto* | Vuelve a copiar el código de la pantalla. Cambia si desactivas y activas «Solo LAN». |
| *Conexión rechazada* | Falta activar «Solo LAN» o «Modo desarrollador». |
| *No se encuentra la impresora en la red* | La IP es incorrecta o ha cambiado (ponle IP fija), o el servidor está en otra red o VLAN. |
| *La impresora no responde* | Está apagada o con mala cobertura Wi-Fi. |
| Se ve el estado pero no obedece | Falta el «Modo desarrollador» (sin él, Bambu bloquea las órdenes externas). |

La app reintenta sola cada pocos segundos (hasta cada minuto si sigue fallando).

**Comprobar desde el servidor** que llega a la impresora:

```bash
nc -zv IP-DE-LA-IMPRESORA 8883
```

Si dice *succeeded*, la red está bien.

**Docker:** con la configuración normal (red *bridge*) el contenedor ya llega a las impresoras de tu
red. Solo si tu red es especial (VLAN, varias interfaces), añade `network_mode: host` en
`docker-compose.yaml`.

**Desactivar el control LAN del todo:** pon `FARM_LAN=0` en `.env` y reinicia. La granja manual
sigue funcionando.

## 6. Lo que todavía no hace

- Mandar un archivo a imprimir desde la app. Por ahora se manda desde Bambu Studio u OrcaSlicer por la
  red local.
- Ver la cámara de la impresora.
- Impresoras Klipper, Prusa u OctoPrint en directo (para esas, la granja va en modo manual).
