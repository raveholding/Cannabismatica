# Cannabismatica I+D · Sistema VB ONG (versión 3 · con nube)

Sistema de gestión (HTML5, sin instalación) de la **Fundación Cannabismatica Investigación y Desarrollo** (ONG de cannabis medicinal, Salta · Ley N.º 27.350 · REPROCANN).
Adelante está el **menú público** (REPROCANN, talleres, cursos, servicios, club, turnero); detrás de **Acceso del equipo** está el panel de gestión. Los datos viven en la nube (Supabase, región **São Paulo, Brasil**) y, cifrados, en cada equipo.

Sitio: https://raveholding.github.io/Cannabismatica/

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
