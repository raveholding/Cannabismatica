# Cannabismatica I+D · Sistema VB ONG (versión 3 · con nube)

Sistema de gestión (HTML5, sin instalación) de la **Fundación Cannabismatica Investigación y Desarrollo** (ONG de cannabis medicinal, Salta · Ley N.º 27.350 · REPROCANN).
Adelante está el **menú público** (REPROCANN, talleres, cursos, servicios, club, turnero); detrás de **Acceso del equipo** está el panel de gestión. Los datos viven en la nube (Supabase, región **São Paulo, Brasil**) y, cifrados, en cada equipo.

Sitio: https://raveholding.github.io/Cannabismatica/

## Novedades (2026-11-11) · Etapa 1: aporte sugerido, 5+1, cambio y caja v2
- **Dispensación**: aporte sugerido por unidad en cada lote (Trazabilidad / Stock → «Aporte sugerido»; un lote nuevo hereda el de la misma genética). Subtotal, descuento **5+1** (cada 5, 1 sin aporte) y total se calculan solos y se pueden cambiar: la donación sigue siendo voluntaria.
- **Recibido y cambio** (dispensación y donación suelta; efectivo, transferencia de más o parte en efectivo de un pago mixto): en la caja entra lo recibido y sale «Cambio entregado» en efectivo.
- **Caja v2** (`js/m-caja2.js`): caja principal opcional, **traspasos** entre cajas (colección `ctransf`, sólo se agregan; se corrigen con traspaso inverso; no son ingresos ni egresos), consolidado de cajas abiertas (pantalla «Cajas y traspasos»), **corte X** (colección `cortesx`) y número **Z** dentro del sello del cierre (los cierres viejos siguen íntegros).
- **Impresora térmica directa** (`js/m-ticket.js`, Periféricos y ticket): USB / serie / Bluetooth, PC850, corte parcial/total, cajón por pin 2/5. Pendiente de prueba física.
- Corregido: la hora de los movimientos de caja mostraba «p. m.» (ahora `CM.fmtHora`).
- Servidor: `supabase/07-caja-traspasos-cortes.sql` (instalado el 2026-11-11). Pruebas: `t/e2e_caja2_1111.py` (75).

## Novedades (2026-11-10) · Empezar de cero conservando pacientes
- **Configuración → Empezar de cero** ofrece dos modos. Por defecto **«Conservar los pacientes, sus legajos y documentos»**: quedan las fichas (datos, historia clínica, REPROCANN, consentimiento, N.º de socio), los documentos del legajo (`legDocs`: consentimiento informado, REPROCANN, escaneos y accesos a Drive del sistema anterior), los seguimientos y las historias clínicas del menú todavía sin revisar. Se retira lo demás: lotes, stock, dispensaciones, donaciones, comprobantes, cajas, sellos, cupones, membresías, inventario, cultivo, tareas, personal, turnos y altas al club pendientes. «Borrar todo» sigue existiendo.
- Servidor: `supabase/06-empezar-de-cero-conservando-pacientes.sql` (función `sync_vaciar_conservar`). Antes de retirar copia todo a `respaldo_registros` (sólo visible desde el SQL Editor). Sin esta actualización instalada el botón avisa y **no borra nada**.
- Pruebas: `supabase/tests/06-pruebas-conservar.sql` (17), `t/e2e_cero_conservar.py` (20, también con `PAGINA=index.html`).

## Novedades (2026-11-08, tarde)
- **Clave olvidada:** se pide a la administración del sistema (Usuarios y permisos → Clave temporal), no al soporte del desarrollador.
- **Donaciones:** la administración puede editar (medio, importe, mixto, con motivo) y quitar/restaurar donaciones; el servidor lo exige (`04-donaciones-admin.sql`). Las 38 donaciones de noviembre migradas de AppSheet quedaron «Quitadas» para volver a cargarlas con el medio correcto (respaldo en `respaldo_aportes_20261108`).
- **Caja:** «Ver» en cada movimiento abre el detalle de la operación (donación y sus medios, dispensación vinculada, correcciones y auditoría), también en cajas cerradas. El contraasiento queda vinculado al original. En la nube la donación mixta entra a la caja un movimiento por medio.
- **Tarjeta del Club** (portado de Sistema VB V26.3–V26.58): N.º de socio, tarjeta en el celular (`#/mitarjeta`) con QR y código de 4 cifras que cambian cada 2 minutos (un solo uso) y sellos que se actualizan solos (`05-club-tarjeta.sql`, `pub_club_estado`); enlace personal por WhatsApp; reemitir (invalida la anterior) y baja. La tarjeta vieja (firma fija) ya no se acepta.
- **Documentos del sistema anterior (AppSheet):** en Pacientes, la administración abre el selector oficial de Google, elige los archivos de «Documentos_Files_» y el sistema crea un acceso directo en la carpeta de cada legajo (los originales no se mueven). Funciones `picker` y `vincular` en `drive-legajos` (desplegada v5). Google Cloud configurado el 2026-11-08: Picker API habilitada, clave de API «Selector Picker - sistema ONG» restringida a Picker API y a `https://raveholding.github.io/*`, origen JavaScript autorizado en el cliente OAuth, y secretos `GOOGLE_PICKER_API_KEY` y `GOOGLE_PROJECT_NUMBER` cargados en Supabase (verificados por su huella SHA-256).
- Pruebas: `t/e2e_donaciones_1108.py` (16), `t/e2e_club_caja_1108.py` (28), `t/e2e_anteriores.py` (9), `t/drive-oauth.test.ts` (16).

## Novedades (2026-11-08) · Ajustes pedidos por la fundación

- **Membresías**: el campo Paciente lista a los pacientes cargados mientras se escribe (tocar = elegir). **Planes** editables («Plan de Salud», «Consulta Médica» u otros): sólo el administrador, o quien tenga nivel *admin* en Fidelización, puede crearlos, modificarlos o archivarlos (también lo exige el servidor). Al confirmar el pago se carga el importe recibido.
- **Cultivo**: el nombre del espacio (Sala 1, Sala 2, Carpa…) en negrita y el código más chico; **genéticas por espacio** (variedad, tipo, cantidad de plantas, estado y observaciones, con historial de cambios); fases nuevas después de Floración: **Stretching, Engorde, Maduración y Lavado de raíces (washing)**.
- **Dispensación**: el **origen de cultivo sale del lote** (el lote guarda su ciclo; ya no se elige a mano). Botón «Ciclo de un lote» en Trazabilidad / Stock para asignarlo a los lotes existentes.
- **Donación mixta** (varios medios que suman el total) y medios **tarjeta de débito / crédito**. La caja recibe una línea por medio: sólo el efectivo entra al arqueo.
- **Trazabilidad / Stock**: nuevo nombre, el stock por lote va primero y muestra el ciclo de origen.
- **Inicio** sin datos ni números de ejemplo; las donaciones del mes separan lo cargado en el sistema de lo importado del sistema anterior.
- **Tareas**: el responsable se elige entre todo el equipo (personal + usuarios del sistema).
- **Domicilio de cultivo** del paciente (Autocultivo / Cultiva la ONG / A completar) en REPROCANN y en la ficha.
- Con la nube activa ya no se ofrece la **Factura C simulada** (sólo existe en la demo).
- Servidor: `supabase/03-planes-y-equipo.sql` (aplicado). Prueba: `t/e2e_ajustes_1108.py` (56 verificaciones, modo local con datos ficticios).

## Novedades (2026-10-23) · Menú público con los bloques unificados de Sistema VB

- **Tarjeta del Club de ejemplo** («Así se ve tu tarjeta»), con la meta de sellos y el beneficio que se configuran en *Menú público → Club y altas*. Dice «ejemplo»: no es la tarjeta de nadie.
- **Dónde estamos**: mapa de Google dentro del menú (se puede apagar), dirección, WhatsApp, correo y botón «Cómo llegar».
- **Reseñas**: botones «Dejar mi reseña» y «Ver reseñas» con los enlaces que cargue la fundación (sólo https). Nunca se muestran reseñas inventadas.
- **Redes**: grilla con ícono, nombre y usuario de cada red activa.
- **Información legal** (pestaña nueva): privacidad y datos de salud, historia clínica y REPROCANN, donaciones, Club, Wi-Fi y arrepentimiento, editables. Son plantillas: **confirmarlas con el asesor legal** [VERIFICAR].
- **Botón de arrepentimiento**: incluido pero **apagado por defecto** (organización sin fines de lucro). Al encenderlo abre WhatsApp con el pedido redactado.
- Todo pasa por borrador → publicar, como el resto del menú. Prueba: `t/e2e_pubext.py` (22 verificaciones, sin tocar la nube).

## Novedades (2026-10-22)
- **Ficha del paciente: una sola carpeta por legajo** (se abre directo) y **Documentos y escaneos**: subir PDF o fotos, o escanear con la cámara del celular. Cada archivo va a la carpeta del legajo con nombre único (legajo, tipo, fecha, versión y huella SHA-256), nunca reemplaza uno anterior y queda registrado quién lo subió y cuándo. El registro se sincroniza entre equipos (colección `legDocs`).
- **Google Drive**: por ahora la conexión es manual (Client ID OAuth de la ONG, el permiso dura la sesión del equipo). Si Drive no está conectado, el archivo queda guardado **en ese equipo** como «pendiente de subir» y se sube solo al conectar. Pendiente: cuenta de servicio de la ONG para que las carpetas y subidas sean automáticas.

## Cómo se usa (primera vez)

1. Abrí el sitio → **Acceso del equipo** (o tocá 5 veces el logo, o `#/acceso`).
2. Como el sistema está vacío, aparece **Primera configuración**: con el **código de configuración** que entrega Rave Holding (se usa una sola vez) se crea la cuenta de administración (correo + clave de al menos 8 caracteres con letras y números).
3. Desde **Usuarios y permisos** el administrador da de alta a su equipo (supervisor, mostrador, operador). Cada persona recibe una clave temporal y **debe elegir una propia** al entrar. Editando al usuario y desmarcando **Activo**, la persona queda afuera en todos los equipos en la próxima sincronización (hasta 15 s).
4. Cada computadora o celular que entra queda registrado como un **equipo** con su propio número de caja (la caja de cada equipo es independiente).

Sin conexión sigue funcionando (hasta 7 días desde la última conexión) y sube lo pendiente al reconectar. La clave nunca se guarda: de ella se deriva la llave que cifra la base de cada equipo.

## Qué incluye

| Módulo | Qué hace |
|---|---|
| **Búsqueda por documento / ficha del paciente** | Buscador global; ingreso breve; Historia clínica / Solicitud REPROCANN; dispensaciones, donaciones, seguimientos y accesos a Drive. |
| **REPROCANN** | Estado de la ONG y vigencia de cada paciente con alertas. |
| **Dispensaciones y trazabilidad** | Lotes con stock por movimientos (nunca negativo, ni con dos equipos vendiendo a la vez), anulación con motivo, etiqueta con QR, planilla de cultivo, CSV. |
| **Donaciones voluntarias y Factura C** | Factura C **simulada** (sin validez fiscal, sin ARCA). |
| **Caja · Arqueo · Cajas cerradas** | Rubro financiero obligatorio, arqueo, cierre sellado (SHA-256) y congelado en el servidor, historial, ficha A4. |
| **Inventario · Fidelización · Personal · Tareas · Dashboard** | Ver pantallas; todo sincronizado entre equipos. |
| **Menú público** | Se edita en Administración → Menú público (borrador → publicación con versiones). El público lo lee sin iniciar sesión. Los formularios públicos (Historia clínica, turnero, club) llegan al servidor y el equipo los incorpora al sincronizar. |
| **Importar / Exportar · Auditoría · Nube** | Importación CSV/XLSX con modo prueba; auditoría con cadena de hashes por equipo más registro propio del servidor (usuarios, claves, permisos); respaldo cifrado descargable. |

## Seguridad (qué hay y qué no)

- **Contraseñas**: las gestiona Supabase Auth (hash lento). No hay claves en el código ni claves compartidas. Mínimo 8 caracteres con letras y números (cliente, servidor y Auth). Bloqueo temporal tras 5 intentos fallidos. Cierre de sesión por inactividad (15 min). Registro de nuevas cuentas desactivado en Supabase: sólo el administrador crea usuarios.
- **Datos en el equipo**: AES-256-GCM, llave derivada con PBKDF2-SHA256 (200.000 iteraciones) de la clave de la persona; en `localStorage` no se guarda ningún dato personal, clave ni token (el menú público cacheado no contiene datos de pacientes).
- **Servidor**: RLS en todas las tablas; los navegadores no escriben tablas, sólo llaman funciones (`sync_push`, etc.) que validan rol, permisos por módulo, colecciones permitidas, stock no negativo, cajas cerradas congeladas y auditoría sólo-agregar. El público anónimo sólo puede leer el menú publicado y enviar solicitudes (con límite de uso y nonce de un solo uso).
- **Roles**: los permisos se aplican en el servidor; la interfaz sólo oculta lo que no corresponde. Un mostrador no puede crear usuarios, cambiar permisos ni modificar ajustes aunque lo intente por consola (probado).
- **Página**: CSP estricta (`connect-src` sólo al proyecto de Supabase y a Google), sin scripts de terceros. Los encabezados HTTP (HSTS, X-Frame-Options) los manda GitHub Pages; no se pueden personalizar.
- **Sin contraseña no hay datos**: si se pierden todas las claves de administración, `supabase/` incluye `soporte_restablecer_clave` (sólo desde el SQL Editor, por Rave Holding tras verificar la identidad del titular).

## Pruebas realizadas

- Servidor: `supabase/tests/02-pruebas-servidor.sql` → 49/49 (RLS, roles, stock, cierres congelados, auditoría, público, límites).
- Cliente contra un servidor simulado (flujos reales en navegador): alta inicial, ingreso, clave errónea y bloqueo, cifrado en reposo, ingreso sin conexión, sincronización entre dos equipos, ids y cajas sin colisión, stock concurrente (el rechazado se revierte y se avisa), usuarios y roles creados por pantalla, escrituras prohibidas rechazadas y restauradas, baja de usuario que cierra su sesión, cambio obligatorio de clave, formularios públicos de punta a punta con idempotencia, "Empezar de cero" que se propaga, cierre de caja congelado, cierre por inactividad.
- Regresión de las funciones de la versión 2 (suites 2, 3, 4, 6 y 7: 38 + 31 + 41 + 41 + 79 controles) en modo local.
- En vivo (producción, sin credenciales): el sitio carga, el servidor responde, el sistema vacío ofrece la primera configuración, el acceso anónimo a las tablas está denegado y el registro de cuentas está deshabilitado.

## Límites conocidos (decirle al cliente)

- Dos personas que editan **el mismo registro** a la vez: gana la última guardada (no hay fusión de campos).
- Una caja que quedó abierta en un equipo perdido no la puede cerrar otro equipo; hay que resolverla con soporte.
- Deshacer una importación y restaurar un respaldo sobre datos de la nube están desactivados con la nube activa (el respaldo cifrado se descarga y verifica).
- Los datos locales de alguien a quien se le quitó el acceso siguen cifrados en su equipo hasta que borre los datos del navegador.
- Plan gratuito de Supabase: las copias de seguridad automáticas diarias dependen del plan **[VERIFICAR en supabase.com/pricing]**; el proyecto puede pausarse por inactividad. Para producción real conviene un plan con respaldos.
- El texto del menú (precios, textos, leyendas, preguntas frecuentes) es **contenido inicial para que el dueño lo revise**. La normativa (vigencias REPROCANN, exención de la ONG, consentimiento, datos de salud, datos de menores) **[VERIFICAR con asesor legal y fuentes oficiales]**.
- **Factura C simulada**: el CAE real requiere certificado digital y servicios de ARCA **[VERIFICAR en arca.gob.ar]**. Google Drive probado sólo con Google simulado: falta una cuenta real. Pagos, correo, WhatsApp automático, biometría e impresoras no están conectados (la pantalla lo dice).
- La contraseña de la red Wi-Fi de invitados, si se activa el bloque, se publica en el menú público (por diseño: es para clientes).

## Estructura

```
index.html        pantalla principal (CSP)
css/              estilos
js/config.js      URL y clave publicable de Supabase (no hay secretos en el repo)
js/core.js ext.js app.js ui.js m-*.js ident.js   núcleo y módulos
js/m-nube.js      cliente de la nube: cifrado local, sincronización, sesión, formularios públicos
js/m-nube2.js     ingreso, usuarios, permisos, cambio de clave, respaldo, caja por equipo
supabase/01-esquema.sql             esquema, RLS y funciones (idempotente)
supabase/tests/02-pruebas-servidor.sql   pruebas del servidor
supabase/90-reiniciar-para-entrega.sql   borra TODO y genera un código de configuración nuevo
docs/Sistema-VB-ONG.md              prompt maestro para ONG
```

Para reinstalar en otro proyecto de Supabase: crear el proyecto, pegar `01-esquema.sql` en el SQL Editor, correr `90-reiniciar-para-entrega.sql` (muestra el código de configuración), poner la URL y la clave publicable en `js/config.js`, desactivar "Allow new users to sign up" y fijar la clave mínima en 8 con letras y números.

Desarrollado por **VINCULAR BUSINESS** · «Tu idea, en buenas manos.» · WhatsApp (387) 4484132

## Legajo completo (carpeta + hoja + formularios)
- Cada paciente nuevo (formulario público, alta del club, historia clínica o ingreso breve) nace con un **legajo único**.
- Con el **Drive de la ONG conectado** (Client ID de Google cargado y un administrador que autoriza el acceso), el sistema crea solo la carpeta `Legajos/{legajo}_{DNI}` y la fila del legajo en la hoja **«Legajos · {ONG}»** (se crea sola, una fila por legajo, sin duplicar).
- Google obliga a que una persona de la ONG autorice el acceso desde el navegador: si nadie lo hizo, los legajos quedan **pendientes** y se procesan todos con un botón en *Pacientes*.
- La hoja guarda sólo identificación, estado de los formularios («Completo / Sin completar», con lo que falta) y el enlace a la carpeta. **No se copian datos clínicos.**
- En *Pacientes* se puede filtrar por «Formularios sin completar» y «Sin carpeta en Drive»; cada ficha muestra el estado de sus formularios.
- Pendiente: creación 100 % sin intervención (sin que nadie abra el sistema) requiere una cuenta de servicio de Google y un proceso en el servidor.

## Carga más rápida (2026-11-08)
- `index.html` ahora se **genera** con `python3 tools/build.py` a partir de `dev.html` (la fuente, un archivo por módulo): un solo JS minificado (`js/app.min.js`, 25 archivos → 1, ~190 KB comprimido) y un solo CSS (`css/app.min.css`), con el nombre versionado por su contenido. **Editar siempre `dev.html` y los módulos de `js/`, y volver a correr el armado antes de publicar.**
- `sw.js` (service worker, sólo en el sitio publicado): la segunda vez el sistema abre desde el equipo; la página y `config.js` se piden primero a la red (si tarda más de 4 s se usa lo guardado); nunca toca pedidos a Supabase ni a Google.
- Pruebas: las de módulos usan `dev.html`; `t/_bundle_smoke.py` (55) prueba el armado y `t/_sw_check.py` el service worker (también sin red).
