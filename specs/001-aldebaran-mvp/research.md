# Research: Aldebaran MVP

Decisiones técnicas para implementar el spec con el stack de `AGENTS.md`. Ninguna cambia el
comportamiento definido en `PRD.md`; solo fijan el cómo.

## R-01 · Modo de ejecución y selección de adapters

- **Decision**: `config/mode.ts` lee `MOCK_MODE` una sola vez al arrancar y devuelve
  `'mock' | 'homologacion'`. `adapters/index.ts` recibe el modo y arma un objeto `Adapters`
  (`arca`, `llm`, `mailSender`, `mailbox`, `fx`, `clock`) con la implementación real o mock. Los
  servicios solo conocen las interfaces de [contracts/adapters.md](./contracts/adapters.md).
  La ruta de base se resuelve en el mismo lugar: en mock, siempre `data/aldebaran-mock.db`; fuera de
  mock, `DATABASE_PATH` o `data/aldebaran.db`, y error de arranque si resuelve a la base mock
  (comparando rutas absolutas normalizadas) (RF-211 a RF-213).
- **Rationale**: Constitución V (resolución en un único lugar, interfaz común, lógica de negocio
  igual en todos los modos) y RF-184 a RF-213.
- **Alternatives considered**: flags por servicio (excluido por el PRD, "Fuera de Alcance"); módulos
  mock vía `vi.mock` en producción (mezcla tests con runtime).

## R-02 · Montos

- **Decision**: enteros en centavos (`integer`) en la base y en el dominio. La conversión USD→ARS usa
  la cotización en centavos (`ars_cents = usd_cents × rate_cents / 100`) y redondea "half away from
  zero" al centavo (RF-64, AC-64: 1 × 155550 / 100 = 1555,5 → 1556 ¢ = $15,56). Los montos extraídos por el LLM se parsean como string
  decimal; si tienen más de 2 decimales o son ≤ 0, el email no tiene coincidencias (RNF-13).
- **Rationale**: RNF-13 exige comparación al centavo exacto sin redondeos; los floats no lo garantizan.
- **Alternatives considered**: `REAL` de SQLite (errores de representación); librerías decimales
  (innecesarias con enteros).

## R-03 · Fechas y zona horaria

- **Decision**: puerto `Clock` (`now(): Date`) y helpers en `domain/billing-dates.ts` que trabajan con
  la fecha civil de `America/Argentina/Buenos_Aires` usando `Intl.DateTimeFormat` (Argentina no tiene
  horario de verano, pero no se asume un offset fijo). El proceso arranca con `TZ` forzada en el
  script npm además de usar el helper, para que node-cron y los logs coincidan (RNF-12, AC-229).
- **Rationale**: testeable con relojes falsos; sin dependencia extra.
- **Alternatives considered**: `date-fns-tz` (válida, pero innecesaria para las pocas operaciones);
  Temporal (no disponible sin flag en Node 24).

## R-04 · Scheduler

- **Decision**: node-cron ejecuta un `tick()` cada minuto. Cada tick evalúa, con el reloj de Argentina
  y el estado persistido:
  - **Facturación**: si el período del mes en curso no está cancelado ni `completado` y
    (día > 15, o día = 15 y hora ≥ hora de facturación) → ejecutar (RF-51, RF-52, RF-57, RF-59);
    así, si el sistema vuelve el 17 a las 09:00, arranca en ese mismo tick (AC-53). Un período que
    quedó `en_curso` se retoma siempre, aunque ya sea el mes siguiente (RF-53). Un período de un mes
    anterior que nunca empezó no se factura (RF-52).
  - **Recordatorios**: si es el último día del mes, hora ≥ hora de recordatorios y la corrida del mes
    no terminó → ejecutar o retomar, enviando solo a los clientes sin recordatorio automático de ese
    mes en `sent_emails` (RF-149, AC-246). Al día siguiente nunca se retoma (Fuera de Alcance).
  - **Casilla**: si no hay una revisión en curso y pasaron ≥ N minutos desde el inicio de la anterior
    → revisar (RF-99 a RF-102).
  - **Reintentos**: ejecutar las operaciones de `retry_queue` vencidas (RF-171).
  Con `SCHEDULER_ENABLED` distinto de `true` el tick no se registra (en mock, por defecto `true`,
  RF-207). Cada proceso tiene un candado en memoria para no solaparse consigo mismo.
- **Rationale**: un tick por minuto da la tolerancia de ±1 min de AC-52, AC-61, AC-93, AC-157 y cubre
  la recuperación tras una caída sin lógica especial.
- **Alternatives considered**: un cron por proceso con horario fijo (no cubre RF-52/RF-57 y hay que
  reprogramar al cambiar la configuración).

## R-05 · Idempotencia de la facturación (RF-74 a RF-76)

- **Decision**: restricción `UNIQUE(client_id, period)` en `invoices`. Cada factura se crea primero en
  estado técnico `generando` con el número a usar (= `FECompUltimoAutorizado` + 1, consultado a ARCA
  en el momento) y luego se pide el CAE. Ante un timeout o falla, el reintento primero consulta
  `FECompConsultar` para ese número: si ARCA ya lo autorizó y los datos coinciden (CUIT receptor,
  importe, fecha), registra ese CAE; si no existe, vuelve a pedir el CAE. La factura pasa a
  `pendiente_de_pago` solo con CAE. En mock, el número es el siguiente en la base mock por punto de
  venta y el CAE son 14 dígitos aleatorios con vencimiento a 10 días (RF-186).
- **Serialización**: todo pedido de número y de CAE (corrida, cola de reintentos y reintento manual)
  pasa por un único candado por punto de venta, así que nunca hay dos solicitudes en paralelo.
- **Liberación del número**: si `findVoucher` confirma que ARCA no autorizó el número reservado, la
  factura `generando` lo libera (`number = null`) y el próximo intento consulta de nuevo
  `FECompUltimoAutorizado`; así una factura fallida nunca bloquea la numeración de las siguientes.
- **Datos del reintento**: mientras ARCA no haya autorizado el comprobante, cada intento recalcula los
  ítems, la cotización y los datos del cliente vigentes (RF-171); si ya lo autorizó, se registra la
  factura con los datos guardados de la solicitud autorizada.
- **Rechazos**: una respuesta de ARCA con resultado rechazado (errores u observaciones de validación)
  libera el número y no se encola: genera el error de proceso de inmediato con el mensaje de ARCA
  (RF-171, AC-247).
- **Rationale**: asegura un solo comprobante por factura aunque la respuesta se pierda (AC-73).
- **Alternatives considered**: reintentar `FECAESolicitar` a ciegas (duplica comprobantes).

## R-06 · ARCA WSAA / WSFEv1 en homologación

- **Decision**: cliente SOAP propio con `fetch` y XML armado con plantillas.
  - WSAA homologación: `https://wsaahomo.afip.gov.ar/ws/services/LoginCms`; TRA firmado como CMS
    (PKCS#7 SignedData) con `ARCA_CERT_PATH`/`ARCA_KEY_PATH`; el token y el sign se cachean en la
    base hasta su vencimiento (~12 h).
  - WSFEv1 homologación: `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`; operaciones
    `FECompUltimoAutorizado`, `FECAESolicitar` (CbteTipo 11, Concepto 2 servicios, con
    `FchServDesde`/`FchServHasta`/`FchVtoPago`, `CondicionIVAReceptorId` según RF-77) y
    `FECompConsultar`.
  - Las URLs viven como constantes en `adapters/arca/endpoints.ts` y un test falla si alguna no
    contiene `homo` (Constitución V).
  - Timeout de 30 s con `AbortSignal.timeout` (RNF-07).
  - El banner de certificado lee la fecha `notAfter` del certificado (RF-97, RF-98).
- **Rationale**: `AGENTS.md` fija SOAP a mano; mantener las URLs en un solo archivo con test evita
  apuntar a producción por error.
- **Alternatives considered**: librerías de terceros para AFIP (descartadas por `AGENTS.md`).

## R-07 · Clasificación con el LLM

- **Decision**: `@anthropic-ai/sdk` con el modelo `claude-haiku-4-5-20251001` que fija `AGENTS.md`, una
  llamada por adjunto con el cuerpo del email como contexto (RF-119), el archivo como bloque `image`
  o `document` (PDF) y una herramienta con esquema de salida
  `{ clasificacion: 'si'|'no'|'dudoso', cuit_ordenante: string|null, monto: string|null }`. El SDK se
  configura con `maxRetries: 0` y `timeout: 10_000`; la política de RNF-02 (reintentos a 2/4/8 s,
  códigos que se reintentan y los que no) se implementa en `adapters/llm/retry-policy.ts`, testeada
  con relojes falsos (AC-116 a AC-118). El prompt indica tomar el CUIT del ordenante, nunca el del
  beneficiario (RF-121) y clasificar como "dudoso" los pagos en una moneda distinta del peso
  (RF-119, AC-244); el dominio descarta CUIT que no tengan 11 dígitos (RF-122). Los adjuntos de un
  mismo email se clasifican en paralelo, para que el peor caso de un email siga siendo el de un
  adjunto (54 s, RNF-01).
- **Rationale**: salida estructurada evita parseos frágiles; la política propia cumple los tiempos
  exactos de RNF-02.
- **Alternatives considered**: reintentos del SDK (no permiten fijar 2/4/8 s ni la lista exacta de
  códigos); parsear texto libre (más fallas de interpretación).

## R-08 · Casilla de email (IMAP) y envío (SMTP)

- **Decision**:
  - **Envío**: nodemailer con Gmail SMTP y contraseña de aplicación; remitente con el nombre de
    fantasía o la razón social (RF-215); timeout 30 s. `EMAIL_REDIRECT_TO` (solo desarrollo)
    reemplaza el destinatario.
  - **Lectura**: imapflow sobre `INBOX`, búsqueda `SINCE` desde la fecha de corte (primera factura o
    inicio de la revisión anterior, con un día de margen), deduplicación por `Message-ID` en la tabla
    `received_emails` y procesamiento en orden de fecha de recepción (RF-107 a RF-109, AC-243). Solo
    se revisa `INBOX` (supuesto documentado en los Riesgos del PRD). Se consideran adjuntos las partes con
    `Content-Disposition: attachment`; las partes `inline` con `Content-ID` son imágenes embebidas y
    se ignoran (RF-116). El formato de cada adjunto se determina por su firma y no por el tipo
    declarado (RF-117, research R-16).
  - **Mock**: la casilla simulada es la tabla `simulated_emails`; `mock-mailbox.ts` la lee como si
    fuera IMAP y `mock-sender` escribe en ella (RF-196, RF-203).
- **Rationale**: es el stack de `AGENTS.md`; Message-ID como clave cumple RF-109 aunque se relea.
- **Alternatives considered**: marcar emails como leídos en Gmail (el usuario podría abrirlos y
  perderlos).

## R-09 · Búsqueda de coincidencias de monto

- **Decision**: en `domain/amount-matching.ts`:
  - **Un comprobante**: enumerar los subconjuntos no vacíos de facturas adeudadas cuya suma es igual
    al monto (backtracking con poda por suma parcial, facturas ordenadas por antigüedad).
  - **Varios comprobantes**: asignar a cada comprobante un subconjunto disjunto no vacío de suma
    exacta (backtracking comprobante por comprobante); dos repartos con el mismo conjunto total de
    facturas cuentan como una coincidencia. Si no hay ninguna, se aplica la coincidencia por suma
    con el total de los comprobantes.
  - **Combinación más antigua**: comparar las listas de facturas ordenadas por período (y, a igual
    período, se consideran empatadas) posición a posición según la definición del PRD; si alguna
    lista se termina durante la comparación, la comparación termina y, si queda más de una
    candidata, no hay combinación más antigua (AC-141, AC-142).
  - El riesgo exponencial está aceptado por el PRD; no se agrega límite.
- **Rationale**: implementa literalmente las definiciones del PRD; función pura con tests por cada AC
  (AC-133 a AC-142).
- **Alternatives considered**: programación dinámica sobre sumas (no enumera las combinaciones, que
  hacen falta para elegir la más antigua).

## R-10 · Sesiones y contraseñas

- **Decision**: tabla `sessions` con token aleatorio de 32 bytes (se guarda su SHA-256) en cookie
  `HttpOnly`, `SameSite=Lax`; vencimiento deslizante de 24 h desde la última actividad (RNF-10);
  cerrar sesión borra la fila (AC-02); la baja de un usuario borra todas sus sesiones y el cambio de
  contraseña borra las demás (RF-18, RF-21, AC-249). La URL de recuperación se arma con `APP_URL`
  (por defecto `http://localhost:5173`) y nunca con el header `Host`, para evitar el envenenamiento
  del link (RF-24, AC-251). Contraseñas con bcrypt costo 12 (RNF-09). Los tokens de
  recuperación también se guardan hasheados, vencen a los 10 min y se invalidan al usarse o al emitir
  uno nuevo (RF-26 a RF-28). Los cambios de perfil se aplican en la siguiente solicitud porque el
  perfil se lee de la base en cada request (AC-17).
- **Rationale**: pocos usuarios, sin necesidad de JWT; revocación inmediata al cerrar sesión o dar de
  baja.
- **Alternatives considered**: JWT (no se revoca sin lista negra); express-session (dependencia y
  store extra para lo mismo).

## R-11 · Reintentos y errores de proceso

- **Decision**: tabla `retry_queue` con la operación (`generacion_factura`, `envio_factura`,
  `envio_recordatorio`), su referencia, el número de intento y `next_attempt_at`. El primer intento
  corre en línea; si falla, se encola con la espera configurada y el proceso sigue con el siguiente
  cliente (RF-85, RF-87). Al agotar los reintentos se crea el `process_error` Pendiente (RF-174).
  La revisión de la casilla no usa la cola: falla → error Pendiente único y reintento en el siguiente
  intervalo (RF-103, RF-104). Las acciones de usuario no se encolan (RF-183). Tras un reinicio, la cola se
  retoma con el número de intento guardado. Antes de ejecutar un reintento de recordatorio se
  revalida al cliente: si ya no tiene deuda, está en revisión o está Inactivo, se cancela sin error y
  se registra en el historial (RF-171, AC-247). Los rechazos de validación de ARCA no se encolan
  (R-05).
- **Rationale**: los reintentos sobreviven a reinicios y no bloquean el proceso.
- **Alternatives considered**: `setTimeout` en memoria (se pierden al reiniciar).

## R-12 · Dependencias auxiliares (aprobadas el 2026-10-20)

`AGENTS.md` no las menciona; la Constitución pide aprobación para cambios estructurales. Ninguna
reemplaza una pieza del stack:

| Paquete | Workspace | Uso |
|---------|-----------|-----|
| `zod` | server, web | validación de entradas y de variables de entorno |
| `bcrypt` | server | hash de contraseñas (RNF-09) |
| `pdfkit` | server | PDF de las facturas (RF-93) |
| `node-forge` | server | firma CMS del TRA de WSAA y lectura del vencimiento del certificado |
| `cheerio` | server | lectura de la cotización de dolarhoy.com (RF-63) |
| `fast-xml-parser` | server | parseo de respuestas SOAP de ARCA |
| `supertest` | server (dev) | tests de la API |
| `@testing-library/react`, `jsdom` | web (dev) | tests de componentes |
| `gitleaks` (binario) | repo | escaneo de secretos (AC-225), fuera de npm |
| `dayjs` | web | valores de los selectores de fecha y hora de antd; es la misma versión que ya trae antd |
| `@ant-design/icons` | web | íconos del menú lateral; es la misma versión que ya trae antd |

**Estado**: aprobadas por el responsable del proyecto el 2026-10-20 (Constitución, Restricciones
adicionales). `dayjs` se aprobó el 2026-10-21, al pedir los selectores de fecha y hora de antd en la
configuración; `@ant-design/icons`, el 2026-10-27, al pedir el menú lateral de la versión anterior.

## R-13 · Cotización del dólar

- **Decision**: `adapters/fx/dolarhoy.ts` descarga la página de dolarhoy.com con timeout de 10 s
  (RNF-07) y extrae el valor "Venta" del bloque "Dólar Blue"; devuelve centavos o falla. Se usa
  también en mock, como fija el PRD. Cada lectura exitosa se guarda en `exchange_rates`; ante una
  falla se usa la de `read_at` más reciente y se marca el banner (RF-65 a RF-69). La cotización se lee
  en el momento de generar cada factura que tiene ítems en dólares, también en reintentos
  automáticos y manuales (RF-63, AC-241).
- **Rationale**: es lo que fija RF-63. Con 50 clientes en dólares son hasta 50 lecturas de ≤ 10 s, lo
  que entra en RNF-03.
- **Alternatives considered**: APIs de terceros (no son la fuente que fija el PRD); una lectura por
  corrida (descartada el 2026-10-20: contradice RF-63).

## R-14 · Concurrencia en la interfaz de revisión (RF-218)

- **Decision**: cada endpoint de cambio de estado recibe `expectedStatus` y hace el cambio con un
  `UPDATE ... WHERE id = ? AND status = ?` dentro de una transacción; si no afecta filas responde
  `409 Conflict` con el estado vigente, y la web muestra el mensaje y recarga la vista (AC-240). El
  procesamiento de pagos del agente usa la misma función de transición.
- **Rationale**: control optimista simple sobre SQLite; un solo lugar para las transiciones.
- **Alternatives considered**: bloqueos pesimistas (innecesarios con un solo proceso).

## R-15 · Estrategia de tests

- **Decision**: Vitest con tres niveles: `unit` (dominio puro), `integration` (servicios con SQLite en
  memoria, migraciones aplicadas y adapters mock o fakes programables que simulan fallas, timeouts y
  códigos HTTP) y `api` (supertest, permisos por perfil). Cada test incluye su ID:
  `it('AC-137: reparte dos comprobantes entre A y B y deja C pendiente', ...)`. Un script
  `npm run test:coverage-ac` lista los AC del PRD que no aparecen en ningún test (excepto AC-109 a
  AC-111 y AC-232 a AC-234), para el gate de la Constitución.
- **Rationale**: Constitución I y SC-010.
- **Alternatives considered**: tests E2E con navegador (lentos; se reservan para el quickstart manual).

## R-16 · Adjuntos como contenido no confiable (RF-117, RNF-16)

- **Contexto**: en la versión anterior del curso, un `comprobante.html` con un script, enviado por
  email con un tipo declarado falso, se servía inline desde la app y operaba con la sesión del Admin.
- **Decision**:
  - **Al recibir**: `domain/file-signature.ts` detecta el formato real por los primeros bytes
    (`%PDF-`, `\x89PNG\r\n\x1a\n`, `\xFF\xD8\xFF`, `GIF87a`/`GIF89a`, `RIFF....WEBP`) y devuelve el
    tipo MIME verificado o `null`. El procesamiento de emails solo considera adjuntos los que tienen
    tipo verificado, y guarda ese tipo, nunca el declarado (AC-254). Lo mismo al cargar emails en la
    casilla simulada: se aceptan archivos de cualquier formato (para poder probar RF-117), pero se
    guarda el tipo verificado o `application/octet-stream`.
  - **Al servir**: un único helper `http/attachment-response.ts` arma toda respuesta con un adjunto:
    `Content-Type` verificado; `Content-Disposition: inline` solo para PDF e imágenes verificadas y
    `attachment` para el resto, con el nombre de archivo saneado; `X-Content-Type-Options: nosniff`;
    `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'`;
    y `Cache-Control: private, no-store` (AC-255).
  - **Para toda la app**: `http/middleware/security-headers.ts` agrega a cada respuesta de la API
    `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` y una
    CSP restrictiva. Con `npm start`, `http/static-web.ts` sirve la web compilada (`web/dist`, con
    fallback a `index.html` para las rutas de la web) con la CSP `default-src 'self'; script-src 'self';
    style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'` (AC-256); antd
    necesita `'unsafe-inline'` en estilos. En `vite dev` (`npm run dev` y `dev:mock`), `server.headers`
    aplica la misma política más `'unsafe-inline'` en `script-src`, que necesita el preámbulo de React
    Refresh de `@vitejs/plugin-react`. Esa excepción no reabre el XSS por adjuntos, que se sirven con
    su propia CSP `sandbox` en todos los modos.
  - Los adjuntos se sirven desde endpoints propios (`GET /api/attachments/:id` y los de la casilla
    simulada), siempre con sesión y con el helper.
- **Rationale**: la firma del archivo no la controla el campo `Content-Type` del email; `nosniff`
  impide que el navegador reinterprete el archivo; `sandbox` evita que un PDF o una imagen ejecuten
  scripts con el origen de la app aunque el visor lo permita; servir el resto como descarga cierra el
  vector del HTML.
- **Alternatives considered**: servir los adjuntos desde otro dominio (más infraestructura para un
  sistema interno); confiar en el tipo declarado o en la extensión (es justo lo que explotó el
  ataque).
