# Taller3D Panel

![Taller3D Panel: tu taller de impresión 3D, bajo control](docs/promo/taller3dpanel-1200x630.png)

Gestión completa para tu **taller de impresión 3D** (y tu **servicio informático**), en tu propio
servidor: una Raspberry Pi o cualquier ordenador con Docker. Controla el **stock de tus piezas con
foto**, vende con **lector de códigos QR y de barras**, genera **tickets y presupuestos con el logo de tu
empresa**, calcula **cuánto te cuesta cada impresión** a partir de un STL o 3MF y lleva las cuentas de
**clientes, gastos y colaboradores**. Con modo claro y oscuro, **app para Android** y todos los datos en
una base de datos SQLite propia, dentro de tu instalación.

> **Licencia:** código abierto para **uso no comercial** ([PolyForm Noncommercial 1.0.0](LICENSE.md)).
> Puedes descargarlo, usarlo en tu taller o tu pyme, modificarlo y compartirlo gratis; lo que no se
> permite es venderlo ni ofrecerlo como servicio de pago.

**Qué incluye:**

- **Panel:** ingresos cobrados, gastos y beneficio con su gráfica, lo que te deben, piezas más
  vendidas, quién gasta más (clientes y colaboradores), ventas y gastos por categoría, uso de cada
  impresora y lo que hay que reponer. Por periodos: 7 días, 1 mes, 3 meses, 1 año o todo.
- **Vender:** caja con lector QR / código de barras (USB, Bluetooth o la cámara del móvil), sonido al
  escanear, cantidad, efectivo con cálculo del cambio, tarjeta, Bizum, transferencia o **a deber**
  (pendiente de cobro). Pieza rápida con foto y cliente nuevo sin salir de la venta.
- **Tickets** numerados con código de barras, logo y datos de tu empresa (NIF, dirección, IVA
  desglosado). Se descargan para imprimir, se copian o se envían por WhatsApp. Se pueden anular y el
  stock vuelve solo.
- **Piezas y stock:** galería con fotos o lista, categorías (Llaveros 3D, Navidad, Diseño 3D…), código
  QR y de barras de cada pieza, **hoja de etiquetas para imprimir**, registro de impresiones (suma stock
  y descuenta filamento), ajustes de stock con motivo y **post para Instagram** de cada pieza.
- **Diseños 3D:** ideas por diseñar, modelos en marcha y piezas terminadas.
- **Filamentos:** catálogo de Bambu Lab, Prusament, Smart Materials 3D, Winkle, Polymaker, eSun, Sunlu,
  Elegoo, Creality, SainSmart, Fiberlogy y genéricos. Lo que queda de cada bobina y **alta leyendo el
  QR de la bobina**.
- **Calculadora de impresión:** sube un **STL o 3MF**. Si el 3MF está laminado en Bambu Studio usa sus
  gramos y su tiempo exactos; si no, los estima con el **perfil de tu impresora** (consumo, velocidad,
  boquilla, relleno, paredes, precio y vida útil). Calcula filamento, desperdicio, luz, desgaste,
  fallos, tu trabajo y extras, y te da el precio recomendado con tu margen.
- **Presupuestos** con tu logo, IVA, condiciones e IBAN. Se envían por WhatsApp y con un toque pasan a
  venta.
- **Impresoras:** con **foto de cada impresora** (la tuya, como la tienes en el taller) y catálogo de modelos (Bambu Lab A1 mini, A1, P1S, P2S, X1 Carbon, H2D, H2S…, Prusa,
  Creality, Elegoo, Anycubic, Qidi, Flashforge, Sovol…) con su perfil para los cálculos.
- **Servicio informático:** trabajos de formateo, reparación, montaje… con cliente, equipo, estado,
  lo que cobras, lo que te cuesta y si está cobrado. Resguardo con código de barras.
- **Clientes** (lo que ha gastado y lo que debe cada uno), **colaboradores** (lo que pagan, lo que
  venden y lo que les debes devolver) y **gastos** por categoría y por área.
- **Granja de impresoras** (opcional, se activa en Ajustes): cada impresora con su **QR** para
  pegarlo en la máquina, estado (libre, imprimiendo, mantenimiento, averiada), trabajo actual, buscador
  y filtros para granjas grandes. Las **Bambu Lab en modo «Solo LAN»** (por Wi-Fi o cable) se ven
  **en directo** (progreso, tiempo, temperaturas, AMS) y se **controlan** (pausar, reanudar, parar,
  luz, velocidad). La propia instalación hace de **servidor de impresión**: ver la
  [guía de la granja](docs/GRANJA.md).
- **Movimientos** de stock (kardex): cada entrada y salida con el stock antes y después.
- **Usuarios** con nick, email y contraseña, y permisos (administrador, puede editar, solo ver).
  **Cambiar de usuario rápido**: las cuentas con las que entras en un dispositivo quedan guardadas y
  pasas de una a otra con un toque, sin volver a poner la contraseña.
- **Exporta** ventas, gastos, piezas, movimientos, servicios y presupuestos a CSV (Excel), y haz o
  restaura una **copia de seguridad** completa.

Hecho con Node.js (un solo archivo, sin dependencias, SQLite integrado) y JavaScript sin frameworks.

![Panel](docs/capturas/panel.png)

![Vender con lector QR](docs/capturas/vender.png)

<details>
<summary><b>Más capturas</b></summary>

| | |
|---|---|
| ![Piezas y stock](docs/capturas/piezas.png) | ![Calculadora de impresión](docs/capturas/calculadora.png) |
| **Piezas y stock**, con fotos | **Calculadora** con un 3MF de Bambu Studio |
| ![Ticket](docs/capturas/ticket.png) | ![Presupuesto](docs/capturas/presupuesto.png) |
| **Ticket** con código de barras | **Presupuesto** con IVA y condiciones |
| ![Servicio informático](docs/capturas/informatica.png) | ![Filamentos](docs/capturas/filamentos.png) |
| **Servicio informático** | **Filamentos** y lo que queda de cada bobina |
| ![Catálogo de filamentos](docs/capturas/catalogo-filamentos.png) | ![Catálogo de impresoras](docs/capturas/impresoras.png) |
| **Catálogo de filamentos** | **Catálogo de impresoras** |
| ![Ventas a deber](docs/capturas/a-deber.png) | ![Post para Instagram](docs/capturas/instagram.png) |
| **Ventas a deber**, con «Cobrar ahora» | **Post para Instagram** de cada pieza |
| ![Gastos](docs/capturas/gastos.png) | ![Clientes](docs/capturas/clientes.png) |
| **Gastos** por categoría y por persona | **Clientes**: lo que gastan y lo que deben |
| ![Diseños 3D](docs/capturas/disenos.png) | ![Movimientos](docs/capturas/movimientos.png) |
| **Diseños 3D** | **Movimientos** de stock |
| ![Modo oscuro](docs/capturas/modo-oscuro.png) | ![Piezas en modo oscuro](docs/capturas/piezas-oscuro.png) |
| **Modo oscuro** | **Modo oscuro** en piezas |
| ![Ajustes](docs/capturas/ajustes.png) | ![Entrar](docs/capturas/entrar.png) |
| **Ajustes**: empresa, impresoras, costes, usuarios | **Pantalla de entrada** |
| <img src="docs/capturas/movil.png" width="260" alt="En el móvil"> | <img src="docs/capturas/movil-piezas.png" width="260" alt="Piezas en el móvil"> |
| **En el móvil** | **Piezas en el móvil** |

</details>

## Instalar

Necesitas un ordenador con **Docker** (una Raspberry Pi 4/5 va perfecta). Si no lo tienes:
`curl -fsSL https://get.docker.com | sh`

```bash
git clone https://github.com/pctecnikk/taller3dpanel.git
cd taller3dpanel
./install.sh       # la primera vez solo crea el archivo .env
nano .env          # elige dónde guardar los datos (DATA_DIR) y el puerto
./install.sh       # ahora sí: instala y arranca
```

Abre **http://IP-DE-TU-PI:8095**. La primera vez te pide **crear el usuario administrador** (nick,
email y contraseña). Después, en **Ajustes**, pon los **datos de tu empresa y tu logo**, añade
**tus impresoras** desde el catálogo y revisa los costes (precio de la luz, tu hora de trabajo y tu
margen).

**Ajustes del archivo `.env`:**

| Variable | Para qué sirve |
|---|---|
| `DATA_DIR` | Carpeta de los datos (la base de datos `taller3d.db`). En una Pi, mejor un disco externo. |
| `PORT` | Puerto de la web (8095). |
| `TZ` | Zona horaria (`Europe/Madrid`). |
| `PUID` / `PGID` | Tu usuario del sistema (`id -u`, `id -g`). |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Opcional: crea el administrador al arrancar. |
| `ALLOW_REGISTER` | `1` = otros pueden pedir cuenta (el administrador la activa); `0` = solo el administrador crea cuentas. |
| `REQUIRE_EMAIL` | `1` = pedir email al crear cuentas; `0` = solo nick y contraseña. |
| `TRUST_PROXY` | `1` si la publicas detrás de un proxy (Nginx Proxy Manager, Pangolin, Cloudflare Tunnel…). |
| `FARM_LAN` | `1` (por defecto) = conecta con las Bambu Lab en modo LAN de la granja; `0` = desactivado. |

**También con la imagen ya hecha** (sin compilar), en `docker-compose.yaml`:

```yaml
services:
  taller3d-panel:
    image: ghcr.io/pctecnikk/taller3dpanel:latest
    container_name: taller3d-panel
    restart: unless-stopped
    ports: ["8095:8095"]
    environment: [TZ=Europe/Madrid, ALLOW_REGISTER=1, REQUIRE_EMAIL=1]
    volumes: ["./data:/data"]
```

Funciona en PC (amd64), Raspberry Pi 4/5 (arm64) y Raspberry Pi de 32 bits (armv7).

## Granja de impresoras y servidor de impresión

**Un solo equipo hace de todo.** Instala la app en una Raspberry Pi o un PC (Ubuntu Server, Debian…)
que esté **en la misma red** que tus impresoras, y ese equipo es a la vez la app y el **servidor de
impresión**. No hace falta nada más.

1. Instala como arriba y dale **IP fija** al equipo en tu router.
2. En cada Bambu Lab: **Ajustes → Red → «Solo LAN» + «Modo desarrollador»**. Funciona por Wi-Fi o
   cable. Apunta la IP, el código de acceso y el nº de serie.
3. En la app: **Ajustes → Granja → Activada**, añade las impresoras (una a una o varias de golpe), pon
   IP, serie y código, e imprime sus **etiquetas QR**.

Todos los pasos, qué equipo elegir, cómo entrar desde fuera de casa y qué hacer si una impresora no
conecta: **[docs/GRANJA.md](docs/GRANJA.md)**.

![Granja de impresoras](docs/capturas/granja.png)

![Control en directo de una Bambu Lab](docs/capturas/granja-control.png)

## App para Android

Descarga **Taller3DPanel.apk** desde [Releases](https://github.com/pctecnikk/taller3dpanel/releases)
(las versiones `android-vX.Y.Z`), ábrela en el móvil y toca **Instalar**. La primera vez pide la
dirección de tu servidor (en casa, por ejemplo `192.168.1.50:8095`). Desde la app puedes leer códigos
con la **cámara**, subir fotos de tus piezas y archivos STL/3MF, y guardar tickets y presupuestos en
Descargas. Avisa cuando hay una versión nueva.

También puedes **instalar la web como app** desde el navegador del móvil (menú → *Añadir a pantalla de
inicio*).

## Lector de códigos QR y de barras

Vale **cualquier lector USB, Bluetooth o 2.4G** que funcione como teclado (casi todos): escribe el
código y pulsa Intro, y la app lo recoge esté donde esté. Si tu lector viene configurado como teclado
inglés y tu ordenador está en español, los enlaces llegan como `httpsÑ--…`: la app lo detecta y lo
corrige sola. En el móvil, usa la cámara.

Lee los códigos de las piezas (los genera la app), los de los tickets y servicios, y el **QR de las
bobinas de filamento**: si el QR es un enlace de la marca o lleva los datos en JSON, rellena la bobina
sola.

## Versión

La versión de la web sale en el menú lateral y en **Ajustes**; si entras desde la app de Android,
también la de la app (por ejemplo `Taller3D Panel 1.0.0 · App Android 1.0.0`).

## Actualizar

```bash
curl -fsSL https://raw.githubusercontent.com/pctecnikk/taller3dpanel/main/update.sh | bash
```

o, desde la carpeta: `./update.sh`. No toca tus datos ni tu `.env`.

## Copia de seguridad

En **Ajustes → Tus datos → Copia de seguridad completa** descargas un archivo con todo, y desde ahí
mismo lo puedes restaurar. También basta con copiar la carpeta `DATA_DIR` con el contenedor parado.

## Desinstalar

`bash uninstall.sh` (desde la carpeta). Pregunta antes de borrar nada, ofrece una copia de seguridad,
quita el contenedor y la imagen, y pregunta si borrar también los datos (hay que escribir `BORRAR`).

<details>
<summary><b>🇬🇧 English</b></summary>

### Taller3D Panel in English

Self-hosted management for a **3D printing workshop** (plus an **IT repair service**): stock of your
printed parts with photos, a point of sale with **QR / barcode scanner** support, receipts and quotes
with your company logo and tax details, a **print cost calculator** that reads **STL and 3MF** files
(exact grams and time from sliced Bambu Studio 3MF files, or an estimate from your printer profile),
customers, expenses, collaborators, an optional **printer farm** (QR per printer, live status and control of Bambu Lab printers in LAN Only + Developer Mode over MQTT; the install itself acts as the print server, see docs/GRANJA.md), filament spools (with a brand catalogue and spool QR reading),
printer catalogue with profiles, stock movements, sales on credit, Instagram post generator, users
with roles, CSV export and full backups. Light and dark mode, Android app, and all data in its own
SQLite database inside your installation. The interface is in Spanish.

**Install:** `git clone https://github.com/pctecnikk/taller3dpanel.git && cd taller3dpanel && ./install.sh`
(the first run creates `.env`; edit it and run `./install.sh` again). Open `http://YOUR-IP:8095` and
create the admin account. Docker image: `ghcr.io/pctecnikk/taller3dpanel` (amd64, arm64, armv7).
Android APK in Releases.

**License:** source-available for **non-commercial use** (PolyForm Noncommercial 1.0.0).

</details>

---

Hecho por [pctecnikk](https://github.com/pctecnikk). Si te falta algo o tienes una idea, cuéntalo en
[Issues](https://github.com/pctecnikk/taller3dpanel/issues).
