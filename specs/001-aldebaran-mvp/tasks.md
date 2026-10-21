---

description: "Task list for the Aldebaran MVP implementation"
---

# Tasks: Aldebaran MVP — facturación y cobranza automatizadas

**Input**: Design documents from `/specs/001-aldebaran-mvp/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: OBLIGATORIOS. La Constitución (Principio I, test-first no negociable) exige escribir cada
test antes de su implementación y verlo fallar. Cada test nombra en su `it(...)` los AC que verifica
(por ejemplo `it('AC-133: ...')`). Ningún test llama a ARCA, Gmail ni Claude: se usan los fakes de
`server/tests/helpers/fakes.ts` o los adapters mock.

**Organization**: tareas agrupadas por historia de usuario del spec. Las fases siguen la prioridad
(P1 → P2 → P3); dentro de P1, el orden respeta las dependencias de datos.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario del spec (US1 a US9)
- Rutas según la estructura de `plan.md`: `server/src`, `server/tests`, `web/src`, `web/tests`

## Reglas para todas las tareas

- Respetar literalmente el texto de los RF/AC citados en `PRD.md`; si algo no está claro, frenar y
  derivar a un humano (Constitución, Principios II y III).
- Montos en centavos enteros; fechas con el reloj de Argentina (`Clock` + `billing-dates.ts`).
- Ninguna credencial en el código, en los tests ni en los logs (Principio IV).
- Todo cambio de schema genera una migración nueva con `npm run db:generate -w server`; no se editan
  migraciones aplicadas.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: monorepo, dependencias aprobadas y herramientas de test

- [X] T001 Crear `package.json` raíz con workspaces `server` y `web` y los scripts `dev`, `dev:mock` (`MOCK_MODE=true`), `test`, `db:reset:mock` (borra `data/aldebaran-mock.db`) y `test:coverage-ac`, todos con `TZ=America/Argentina/Buenos_Aires` (plan.md, R-03)
- [X] T002 [P] Crear `.gitignore` con `.env`, `data/`, `certs/`, `*.crt`, `*.key`, `*.pem`, `node_modules/`, `dist/` (Constitución IV)
- [X] T003 [P] Crear `.env.example` con `ANTHROPIC_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `ARCA_CUIT`, `ARCA_CERT_PATH`, `ARCA_KEY_PATH`, `PORT`, `DATABASE_PATH`, `SCHEDULER_ENABLED`, `EMAIL_REDIRECT_TO`, `APP_URL`, `MOCK_MODE`, con valores de ejemplo no sensibles y un comentario por variable
- [X] T004 [P] Crear `server/package.json` y `server/tsconfig.json` (ESM, `strict`) con Express 5, drizzle-orm 0.45, better-sqlite3, drizzle-kit, @anthropic-ai/sdk, nodemailer, imapflow, node-cron, zod, bcrypt, pdfkit, node-forge, cheerio, fast-xml-parser y, en dev, vitest y supertest (research R-12)
- [X] T005 [P] Crear `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts` (proxy `/api` → server) e `web/index.html` con React 19, Vite 8, antd 6, zustand 5, styled-components 6, react-router 8 y, en dev, vitest, @testing-library/react y jsdom; alias `@api-types` → `server/src/http/types.ts` (plan.md, Structure Decision)
- [X] T006 [P] Crear `server/vitest.config.ts` y `web/vitest.config.ts` (jsdom en web) y `server/drizzle.config.ts` apuntando a `server/src/db/schema.ts` y `server/drizzle/`
- [X] T007 [P] Crear `scripts/check-ac-coverage.ts`: extrae los AC de `PRD.md`, busca su ID en `server/tests/**` y `web/tests/**` y lista los faltantes, excluyendo AC-109 a AC-111 y AC-232 a AC-234 (research R-15, SC-010)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: configuración por modo, base de datos, dominio común, puertos y adapters mock, esqueleto HTTP, web y scheduler

**⚠️ CRITICAL**: ninguna historia empieza antes de completar esta fase

### Tests for Foundational ⚠️ (escribirlos primero y verlos fallar)

- [X] T008 [P] Test de `server/src/config/mode.ts` en `server/tests/unit/config/mode.test.ts`: solo `MOCK_MODE === "true"` activa mock; en mock la base es siempre `data/aldebaran-mock.db` ignorando `DATABASE_PATH`; fuera de mock `DATABASE_PATH` o `data/aldebaran.db`, y error si resuelve a la base mock (RF-184, RF-211 a RF-213, AC-209, AC-210)
- [X] T009 [P] Test de `server/src/config/env.ts` en `server/tests/unit/config/env.test.ts`: en mock arranca solo con `MOCK_MODE`, `ARCA_CUIT` por defecto `20111111112` y `SCHEDULER_ENABLED` por defecto `true`; fuera de mock exige las credenciales y `SCHEDULER_ENABLED` solo vale con `"true"`; los mensajes de error no incluyen valores de secretos (RF-205 a RF-207, AC-205, AC-226, AC-227)
- [X] T010 [P] Test de `server/src/domain/money.ts` en `server/tests/unit/domain/money.test.ts`: parseo de montos decimales a centavos, rechazo de fracción de centavo y de montos ≤ 0, conversión USD→ARS con redondeo al centavo (RF-64, RNF-13, AC-64)
- [X] T011 [P] Test de `server/src/domain/cuit.ts` en `server/tests/unit/domain/cuit.test.ts`: dígito verificador (30711111118 inválido, 30711111111 válido), normalización solo dígitos, descarte si no tiene 11 dígitos (RF-39, RF-122, RF-125, AC-41, AC-132)
- [X] T012 [P] Test de `server/src/domain/billing-dates.ts` en `server/tests/unit/domain/billing-dates.test.ts`: fecha y hora civil de Argentina con reloj del servidor en UTC, período `YYYY-MM`, último día del mes, comparación de hora configurada (RNF-12, AC-229)
- [X] T013 [P] Test de `server/src/domain/invoice-status.ts` en `server/tests/unit/domain/invoice-status.test.ts`: transiciones permitidas por actor según data-model.md; el actor `agente` nunca puede pasar a `pagada`; salir de `revision_manual` limpia el motivo (FR-026, RF-140, Constitución III)
- [X] T014 [P] Test de `server/src/adapters/arca/endpoints.ts` en `server/tests/unit/adapters/arca-endpoints.test.ts`: todas las URLs contienen `homo` y ninguna es productiva (Constitución V, research R-06)
- [X] T015 [P] Test de `server/src/domain/mock-classifier.ts` en `server/tests/unit/domain/mock-classifier.test.ts`: tabla de contracts/adapters.md sin distinguir mayúsculas, incluidos `PAGO_x_15000.50.PDF` y `pago_30711111111_x.png` (RF-188 a RF-193)
- [X] T016 [P] Test del ARCA mock en `server/tests/integration/adapters/arca-mock.test.ts`: numeración siguiente por punto de venta empezando en 1, CAE de 14 dígitos con vencimiento a 10 días, sin ninguna llamada de red (RF-185, RF-186, AC-196)
- [X] T017 [P] Test de la casilla simulada en `server/tests/integration/adapters/mock-mailbox.test.ts`: el sender guarda destinatario, asunto, cuerpo, adjuntos y fecha; los recibidos cargados tienen Message-ID único y fecha de carga; `fetchSince` devuelve solo recibidos (RF-196, RF-201 a RF-203)
- [X] T018 [P] Test del scheduler en `server/tests/unit/jobs/scheduler.test.ts`: con `SCHEDULER_ENABLED` distinto de `true` no se registra el tick; el tick no solapa un proceso consigo mismo (research R-04)
- [X] T019 [P] Test del tema en `web/tests/theme.test.tsx`: sigue la preferencia del sistema operativo sin elección guardada, permite elegir claro/oscuro/sistema desde el header y recuerda la elección en `localStorage` (RNF-15, AC-235)

### Implementation for Foundational

- [X] T020 Implementar `server/src/config/env.ts` (lectura y validación con zod) y `server/src/config/mode.ts` (resolución del modo y de la ruta de base) según research R-01
- [X] T021 Implementar `server/src/db/schema.ts` con todas las tablas, índices únicos y columnas de data-model.md, y generar la migración inicial en `server/drizzle/`
- [X] T022 Implementar `server/src/db/client.ts` (abre la base resuelta por `mode.ts` y aplica migraciones al arrancar) y `server/tests/helpers/test-db.ts` (SQLite en memoria con migraciones y builders de datos de prueba)
- [X] T023 [P] Implementar `server/src/domain/money.ts`
- [X] T024 [P] Implementar `server/src/domain/cuit.ts`
- [X] T025 [P] Implementar `server/src/domain/billing-dates.ts` con `Intl.DateTimeFormat` y zona `America/Argentina/Buenos_Aires`
- [ ] T026 [P] Implementar `server/src/domain/invoice-status.ts`
- [ ] T027 Implementar `server/src/adapters/types.ts` con las interfaces de contracts/adapters.md y `server/src/adapters/clock.ts`
- [ ] T028 [P] Implementar `server/src/adapters/arca/endpoints.ts` (solo homologación) y `server/src/adapters/arca/mock.ts`
- [ ] T029 [P] Implementar `server/src/domain/mock-classifier.ts` y `server/src/adapters/llm/mock.ts`
- [ ] T030 [P] Implementar `server/src/adapters/mail/mock-mailbox.ts` (sender y mailbox sobre `simulated_emails` y `simulated_attachments`, dirección `aldebaran-mock@gmail.com`)
- [ ] T031 Implementar `server/src/adapters/index.ts`: arma `Adapters` según el modo (las implementaciones reales se agregan en sus historias)
- [ ] T032 [P] Implementar `server/tests/helpers/fakes.ts`: fakes programables de `ArcaClient`, `AttachmentClassifier`, `MailSender`, `Mailbox` y `ExchangeRateSource` que simulan éxito, error, timeout y códigos HTTP, y registran las llamadas
- [ ] T033 Implementar `server/src/services/history.ts`: registra eventos en `client_events` dentro de la transacción del cambio (RF-163)
- [ ] T034 Implementar `server/src/http/types.ts`, `server/src/http/middleware/errors.ts` (formato de error de contracts/http-api.md, sin filtrar secretos), `server/src/http/validate.ts` (zod) y `server/src/app.ts`
- [ ] T035 Implementar `server/src/jobs/scheduler.ts` (tick por minuto con node-cron y candados por proceso) y `server/src/index.ts` (env → modo → db → adapters → app → scheduler)
- [ ] T036 [P] Implementar `web/src/main.tsx`, `web/src/router.tsx`, `web/src/api/client.ts` (fetch con cookies y manejo de errores), `web/src/components/AppLayout.tsx` y `web/src/theme/` con el selector de tema del header

**Checkpoint**: `npm run test` en verde con los tests de esta fase; `npm run dev:mock` arranca con una página vacía

---

## Phase 3: User Story 1 - Acceso, usuarios, perfiles y contraseñas (Priority: P1) 🎯 MVP

**Goal**: registro del primer Admin, inicio y cierre de sesión, permisos por perfil, gestión de usuarios, configuración y contraseñas

**Independent Test**: con el sistema vacío, registrar el primer Admin, crear un Editor y un Consulta y verificar con cada uno qué pantallas y acciones quedan permitidas

### Tests for User Story 1 ⚠️

- [ ] T037 [P] [US1] Test de API en `server/tests/api/auth.test.ts`: registro del primer Admin y bloqueo posterior, login de Activos, rechazo de contraseña incorrecta y de Inactivos, logout, rechazo sin sesión en todo endpoint salvo los públicos (AC-01, AC-02, AC-03, AC-18, AC-19, AC-211, AC-212)
- [ ] T038 [P] [US1] Test de API en `server/tests/api/session.test.ts`: sesión vencida a las 24 h de inactividad y vigente a las 23 h con reloj falso (AC-222, AC-223). Además: la baja de un usuario cierra todas sus sesiones y el cambio de contraseña cierra las demás (AC-249)
- [ ] T039 [P] [US1] Test de API en `server/tests/api/users.test.ts`: alta, modificación, cambio de perfil aplicado en la siguiente acción, baja y reactivación, email único sin distinguir mayúsculas, protección del último Admin Activo, listado sin hash y acceso solo Admin (AC-05, AC-14 a AC-20, AC-168, AC-213, AC-214)
- [ ] T040 [P] [US1] Test de API en `server/tests/api/settings.test.ts`: Admin guarda el intervalo de revisión y los demás valores; rechaza fuera de rango conservando el anterior (horas 24:00 y 23:60 rechazadas, 23:59 aceptada; punto de venta 0 y 100000; intervalo 4 y 61; reintentos 11; espera 0 y 61); Editor y Consulta no pueden modificar (AC-06, AC-62, AC-71, AC-94, AC-160, AC-183, AC-185, AC-215)
- [ ] T041 [P] [US1] Test de API en `server/tests/api/password.test.ts`: cambio de la propia contraseña con la actual correcta, rechazo con la actual incorrecta, mínimo de 8 caracteres en todas las vías, imposibilidad de cambiar la de otro usuario (AC-21 a AC-25, AC-218)
- [ ] T042 [P] [US1] Test de API en `server/tests/api/recovery.test.ts`: email con token a usuarios Activos, mismo mensaje para emails desconocidos, vencimiento a 10 min, invalidación al usarse y al emitir otro, validación al confirmar (AC-26 a AC-28, AC-31 a AC-33). Además: la URL usa `APP_URL` (o `http://localhost:5173`) aunque el header Host sea otro (AC-251)
- [ ] T043 [P] [US1] Test de integración en `server/tests/integration/users/password-hash.test.ts`: la fila guardada tiene hash bcrypt con costo ≥ 12 y no contiene la contraseña (AC-224)
- [ ] T044 [P] [US1] Test del sender SMTP en `server/tests/unit/adapters/smtp-sender.test.ts` con nodemailer mockeado: usa `GMAIL_USER` y `GMAIL_APP_PASSWORD`, aplica `EMAIL_REDIRECT_TO`, falla a los 30 s (AC-227, AC-228)
- [ ] T045 [P] [US1] Test de componente en `web/tests/pages/reset-password.test.tsx`: token inválido muestra error y redirige al login a los 5 s (±1 s) con timers falsos; token válido muestra el formulario (AC-29, AC-30, AC-32)
- [ ] T046 [P] [US1] Test de componente en `web/tests/components/app-layout.test.tsx`: con `emailRedirectTo` en `/api/setup`, el header muestra "Emails redirigidos a <dirección>" en todas las pantallas; sin la variable no se muestra (AC-250)

### Implementation for User Story 1

- [ ] T047 [US1] Implementar `server/src/services/auth.ts` y `server/src/services/sessions.ts` (bcrypt costo 12, tokens hasheados, vencimiento deslizante) según research R-10. La baja de un usuario y el cambio de contraseña cierran sus sesiones (RF-18, RF-21)
- [ ] T048 [US1] Implementar `server/src/http/middleware/session.ts` y `server/src/http/middleware/require-role.ts` (perfil leído de la base en cada request, RF-06 a RF-13)
- [ ] T049 [US1] Implementar `server/src/http/routes/setup.ts` (con `emailRedirectTo`, RF-220) y `server/src/http/routes/auth.ts` según contracts/http-api.md
- [ ] T050 [P] [US1] Implementar `server/src/services/users.ts` y `server/src/http/routes/users.ts` (RF-14 a RF-20, RF-161)
- [ ] T051 [P] [US1] Implementar `server/src/services/settings.ts` y `server/src/http/routes/settings.ts` con los rangos de data-model.md
- [ ] T052 [US1] Implementar `server/src/adapters/mail/smtp-sender.ts` y registrarlo en `server/src/adapters/index.ts` para el modo homologación
- [ ] T053 [US1] Implementar `server/src/services/password-recovery.ts` y la plantilla de recuperación en `server/src/documents/email-templates.ts` (RF-23 a RF-33)
- [ ] T054 [P] [US1] Implementar en web las páginas `LoginPage`, `FirstAdminPage`, `RecoveryRequestPage`, `ResetPasswordPage` y `ProfilePage` en `web/src/pages/` y el store de sesión `web/src/stores/session.ts`, y el indicador de redirección de emails en `web/src/components/AppLayout.tsx` (RF-220)
- [ ] T055 [P] [US1] Implementar en web `UsersPage` y `SettingsPage` (todos los campos de configuración y datos de la empresa emisora, RF-91) en `web/src/pages/`, con navegación filtrada por perfil. `SettingsPage` es de solo lectura para Editor y Consulta

**Checkpoint**: acceso y perfiles funcionando de forma independiente

---

## Phase 4: User Story 2 - Gestión de clientes, productos y asignaciones (Priority: P1)

**Goal**: ABM de clientes y productos con sus validaciones, y asignación de productos

**Independent Test**: dar de alta clientes y productos válidos e inválidos, asignar productos y verificar listados y rechazos

### Tests for User Story 2 ⚠️

- [ ] T056 [P] [US2] Test de API en `server/tests/api/clients.test.ts`: alta con todos los obligatorios, rechazo sin cada uno, condición frente al IVA fuera de la lista de RF-38, CUIT con dígito inválido, CUIT y email duplicados (sin distinguir mayúsculas), baja y reactivación, Editor puede dar de alta (AC-08, AC-34, AC-38, AC-40 a AC-42)
- [ ] T057 [P] [US2] Test de API en `server/tests/api/products.test.ts`: alta con moneda ARS o USD, precio 0 y -100 rechazados y 0,01 aceptado, desactivación y reactivación (AC-43, AC-44, AC-47, AC-48)
- [ ] T058 [P] [US2] Test de API en `server/tests/api/assignments.test.ts`: Editor asigna productos Activos, no se asignan Inactivos, desasignación, eventos en el historial (AC-09, AC-49, AC-50)

### Implementation for User Story 2

- [ ] T059 [P] [US2] Implementar `server/src/services/clients.ts` y `server/src/http/routes/clients.ts` (alta, modificación, baja, reactivación, detalle) con eventos de historial
- [ ] T060 [P] [US2] Implementar `server/src/services/products.ts` y `server/src/http/routes/products.ts`
- [ ] T061 [US2] Implementar la asignación `PUT /api/clients/:id/products` en `server/src/services/clients.ts` y su ruta
- [ ] T062 [P] [US2] Implementar en web `ClientsPage`, `ClientDetailPage` y `ClientForm` en `web/src/pages/clients/`. `ClientDetailPage` incluye asignar y desasignar productos Activos (RF-49, RF-50)
- [ ] T063 [P] [US2] Implementar en web `ProductsPage` y `ProductForm` en `web/src/pages/products/`

**Checkpoint**: clientes y productos listos para facturar

---

## Phase 5: User Story 3 - Facturación mensual automática en homologación de ARCA (Priority: P1)

**Goal**: facturas C del día 15 (y "Facturar ahora"), idempotentes, con cotización, PDF y email

**Independent Test**: con clientes y productos cargados, ejecutar el proceso del día 15 o "Facturar ahora" con el ARCA mock o fake y verificar facturas, PDF, emails y exclusiones

### Tests for User Story 3 ⚠️

- [ ] T064 [P] [US3] Test de `billing-dates.ts` en `server/tests/unit/domain/invoice-dates.test.ts`: emisión, período de servicio y vencimiento en el proceso del 15/10/2026 y en un reintento manual del 03/11/2026 (RF-79 a RF-81, AC-75, AC-76)
- [ ] T065 [P] [US3] Test del lector de dolarhoy.com en `server/tests/unit/adapters/dolarhoy.test.ts` con un HTML de ejemplo en `server/tests/fixtures/dolarhoy.html`: extrae el blue venta en centavos, falla si cambió el formato y a los 10 s (RF-63, AC-228)
- [ ] T066 [P] [US3] Test de integración en `server/tests/integration/billing/exchange-rate.test.ts`: conversión con la cotización leída y registro con valor, fuente y fecha; uso de la última por `read_at` si el sitio no responde y alta del banner; confirmación del banner por Admin o Editor; sin cotización no se factura a clientes con USD y sí a los de solo ARS (AC-63, AC-65, AC-66, AC-68, AC-69). Además: la cotización se lee al generar cada factura, también en reintentos automáticos y manuales (AC-241)
- [ ] T067 [P] [US3] Test de integración en `server/tests/integration/billing/billing-run.test.ts`: una factura C por cliente Activo con productos Activos en estado Pendiente de pago; sin factura para clientes sin productos, con solo productos Inactivos o Inactivos; nombres, precios, asignaciones, razón social y condición frente al IVA vigentes al facturar sin alterar facturas emitidas; una sola factura por cliente y período aunque se repita la corrida o se retome una interrumpida (AC-36, AC-39, AC-45 a AC-51, AC-54, AC-72, AC-74, AC-85 a AC-87)
- [ ] T068 [P] [US3] Test de integración en `server/tests/integration/billing/arca-idempotency.test.ts`: tipo 11 y punto de venta configurado en la solicitud; timeout después de autorizar → el siguiente intento registra el CAE de `findVoucher` sin pedir otro; cliente sin condición frente al IVA → sin llamada a ARCA y error de proceso Pendiente con el mensaje de RF-83 (con reintentos en 0); sin cotización → error de proceso Pendiente (AC-67, AC-70, AC-71, AC-73, AC-77). Además: pedidos de número y CAE serializados (un reintento de la cola no corre en paralelo con la corrida); número liberado si ARCA no lo autorizó, sin bloquear la factura siguiente; rechazo de validación sin reintento y con el mensaje de ARCA; datos vigentes en cada reintento salvo comprobante ya autorizado; sin datos del emisor o sin punto de venta → error sin llamar a ARCA (AC-242, AC-247, research R-05)
- [ ] T069 [P] [US3] Test de integración en `server/tests/integration/billing/scheduling.test.ts` con reloj falso: arranque a las 11:00 del 15 (±1 min) y no a las 11:00 UTC; recuperación el 17/10 y no en noviembre; período cancelado no se factura; reactivación el 20/10 dispara la facturación y el 01/11 se rechaza; "Facturar ahora" el 05/10 impide la corrida del 15; cambio de hora a 14:00 (AC-52, AC-53, AC-55, AC-57, AC-58, AC-61, AC-229). Además: el sistema que vuelve el 17/10 a las 09:00 arranca dentro del minuto; un período `en_curso` interrumpido el 31/10 se retoma el 01/11 (AC-53, RF-53)
- [ ] T070 [P] [US3] Test de API en `server/tests/api/billing.test.ts`: estado del botón "Facturar ahora" con sus motivos, rechazo directo del endpoint si está cancelado, en curso o realizado, rechazo de cancelar un período iniciado, solo Admin (AC-56, AC-59, AC-60, AC-216)
- [ ] T071 [P] [US3] Test de integración en `server/tests/integration/billing/invoice-email.test.ts`: email al email de facturación con el PDF, número, período, importe, vencimiento, deuda vigente calculada al enviar e indicación de facturas anteriores, pedido de comprobante, leyenda de homologación, remitente y firma con nombre de fantasía o razón social, registro en el historial (AC-78, AC-81, AC-82, AC-237, RF-88 aclarado). Además: el email sale dentro del minuto siguiente a la generación (RF-85)
- [ ] T072 [P] [US3] Test de `server/src/documents/invoice-pdf.ts` en `server/tests/unit/documents/invoice-pdf.test.ts`: el texto del PDF contiene todos los campos de RF-93, los datos del emisor y su CUIT, la cotización si hubo USD y la leyenda de homologación (AC-83, AC-84)
- [ ] T073 [P] [US3] Test de los adapters reales de ARCA en `server/tests/unit/adapters/arca-soap.test.ts` con `fetch` mockeado: TRA firmado con el certificado y la clave de las variables de entorno, cacheo del token, XML de `FECAESolicitar` con Concepto 2, fechas de servicio y `CondicionIVAReceptorId`, timeout a los 30 s (AC-70, AC-227, AC-228)
- [ ] T074 [P] [US3] Test de integración en `server/tests/integration/billing/certificate-banner.test.ts`: banner si el certificado venció o no se puede leer, con fecha si vence en 30 días y sin banner a 31 días (AC-90, AC-91)

### Implementation for User Story 3

- [ ] T075 [P] [US3] Agregar a `server/src/domain/billing-dates.ts` las fechas de emisión, servicio y vencimiento de la factura
- [ ] T076 [P] [US3] Implementar `server/src/adapters/fx/dolarhoy.ts` con cheerio y timeout de 10 s (research R-13)
- [ ] T077 [P] [US3] Implementar `server/src/adapters/arca/wsaa.ts` (TRA, firma CMS con node-forge, cache en `arca_tokens`), `server/src/adapters/arca/wsfev1.ts` (fast-xml-parser) y `server/src/adapters/arca/certificate.ts`, y registrarlos en `server/src/adapters/index.ts` (research R-06)
- [ ] T078 [US3] Implementar `server/src/services/exchange-rates.ts` (lectura al generar cada factura, también en reintentos, registro, respaldo y banner, RF-63 a RF-70)
- [ ] T079 [US3] Implementar `server/src/services/process-errors.ts` con el alta de errores Pendientes (RF-174); los reintentos se agregan en US7
- [ ] T080 [US3] Implementar `server/src/services/billing.ts`: armado de ítems, snapshots, generación idempotente con estado `generando` y recuperación por `findVoucher` (research R-05, RF-71 a RF-83, RF-94, RF-95). Incluye el candado por punto de venta, la liberación del número, los rechazos sin encolar, los datos vigentes en reintentos y el control de datos del emisor (research R-05, RF-171, RF-219)
- [ ] T081 [US3] Implementar `server/src/services/billing-periods.ts` (cancelar, reactivar, "Facturar ahora", estados del botón, RF-54 a RF-61)
- [ ] T082 [P] [US3] Implementar `server/src/documents/invoice-pdf.ts` con pdfkit (RF-90, RF-92, RF-93)
- [ ] T083 [US3] Implementar la plantilla de factura en `server/src/documents/email-templates.ts` y `server/src/services/invoice-email.ts` (deuda vigente calculada en cada intento, RF-84 a RF-90, RF-96, RF-215)
- [ ] T084 [US3] Implementar `server/src/jobs/billing-job.ts` y su condición en el tick de `server/src/jobs/scheduler.ts`, retomando períodos `en_curso` al arrancar (research R-04)
- [ ] T085 [US3] Implementar `server/src/services/banners.ts` (certificado y cotización), `server/src/http/routes/billing.ts`, `GET /api/invoices` básico en `server/src/http/routes/invoices.ts` y la parte de banners de `GET /api/dashboard` en `server/src/http/routes/dashboard.ts`
- [ ] T086 [P] [US3] Implementar en web `BillingPage` (estado del período, "Facturar ahora", cancelar y reactivar), `InvoicesPage` básica y `web/src/components/Banners.tsx`. El banner de cotización incluye el botón para confirmarla (RF-70)

**Checkpoint**: facturación mensual de punta a punta con ARCA mock

---

## Phase 6: User Story 4 - Control automático de pagos recibidos por email (Priority: P1)

**Goal**: revisión periódica de la casilla, clasificación de adjuntos y aplicación de RF-126 a RF-137

**Independent Test**: con facturas adeudadas cargadas, inyectar emails en la casilla fake y verificar el estado final y el motivo de cada factura

### Tests for User Story 4 ⚠️

- [ ] T087 [P] [US4] Test de `server/src/domain/email-classification.ts` en `server/tests/unit/domain/email-classification.test.ts`: orden error > dudoso > si > no (RF-123, AC-113, AC-127, AC-136)
- [ ] T088 [P] [US4] Test de `server/src/domain/amount-matching.ts` en `server/tests/unit/domain/amount-matching.test.ts`: coincidencia única, por combinación, de todas, por comprobante y por suma, combinación más antigua, sin combinación más antigua, diferencia de un centavo, monto cero (AC-133 a AC-142, AC-230, AC-231)
- [ ] T089 [P] [US4] Test de `server/src/domain/payment-rules.ts` en `server/tests/unit/domain/payment-rules.test.ts`: exactamente una regla por caso con su motivo literal, para "no", sin deuda, cliente en revisión, error, dudoso, CUIT o monto no extraído, CUIT distinto (también con guiones), validable con y sin coincidencias (RF-126 a RF-137, AC-119 a AC-123, AC-125 a AC-132, AC-143)
- [ ] T090 [P] [US4] Test de `server/src/adapters/llm/retry-policy.ts` en `server/tests/unit/adapters/llm-retry-policy.test.ts` con timers falsos: esperas de 2, 4 y 8 s, éxito al tercer intento, 401 y 404 sin reintento, 429 y 408 con reintento, timeout de 10 s, respuesta ininterpretable, error tras el cuarto intento (RNF-02, AC-116 a AC-118, AC-125)
- [ ] T091 [P] [US4] Test de `server/src/adapters/llm/anthropic.ts` en `server/tests/unit/adapters/anthropic.test.ts` con el SDK mockeado: usa `ANTHROPIC_API_KEY` y el modelo de AGENTS.md, envía el cuerpo del email y el adjunto como bloque image o document, toma el CUIT del ordenante y descarta CUIT de menos de 11 dígitos (RF-119 a RF-122, AC-114, AC-226). Además: un pago en otra moneda se clasifica "dudoso" y los adjuntos de un mismo email se clasifican en paralelo (AC-244, RNF-01)
- [ ] T092 [P] [US4] Test de `server/src/adapters/mail/imap-mailbox.ts` en `server/tests/unit/adapters/imap-mailbox.test.ts` con imapflow mockeado: búsqueda desde la fecha de corte, imágenes embebidas ignoradas, solo JPEG, PNG, GIF, WebP y PDF, timeout de 30 s (RF-116, RF-117, AC-106, AC-107, AC-228)
- [ ] T093 [P] [US4] Test de integración en `server/tests/integration/payments/mailbox-check.test.ts` con reloj falso: revisión cada 15 min desde el inicio de la anterior, sin solaparse, nuevo intervalo aplicado, falla → un único error Pendiente con un intento por intervalo, recuperación que procesa los atrasados y resuelve el error, primera revisión desde la primera factura, sin facturas no se procesa nada, siguientes solo los nuevos (AC-92, AC-93, AC-95 a AC-99, RF-107 aclarado)
- [ ] T094 [P] [US4] Test de integración en `server/tests/integration/payments/email-processing.test.ts`: Message-ID repetido, remitente propio ignorado, aviso para desconocidos, remitente sin distinguir mayúsculas, registro en el historial, sin adjunto sin efecto, cliente Inactivo procesado, registro de clasificación, CUIT, monto y marca de error, asociación a la revisión pendiente, cambio de email y de CUIT del cliente, factura devuelta a Pendiente que vuelve a validarse (AC-35, AC-37, AC-100 a AC-105, AC-108, AC-112, AC-115, AC-120, AC-121, AC-124, AC-152). Además: emails de una misma revisión en orden de recepción y email asociado a cada factura cuyo estado cambió (AC-243, AC-245)

### Implementation for User Story 4

- [ ] T095 [P] [US4] Implementar `server/src/domain/email-classification.ts`
- [ ] T096 [P] [US4] Implementar `server/src/domain/amount-matching.ts` según research R-09
- [ ] T097 [US4] Implementar `server/src/domain/payment-rules.ts` usando `amount-matching.ts`, `cuit.ts` y `money.ts`
- [ ] T098 [P] [US4] Implementar `server/src/adapters/llm/retry-policy.ts` y `server/src/adapters/llm/anthropic.ts` (herramienta con esquema de salida, `maxRetries: 0`, `timeout: 10_000`) y registrarlo en `server/src/adapters/index.ts` (research R-07)
- [ ] T099 [P] [US4] Implementar `server/src/adapters/mail/imap-mailbox.ts` y registrarlo en `server/src/adapters/index.ts` (research R-08)
- [ ] T100 [US4] Implementar `server/src/services/payment-processing.ts`: identificación del cliente, avisos, clasificación por adjunto, decisión de `payment-rules.ts`, transiciones con `invoice-status.ts`, motivos, `invoice_emails` e historial en una transacción
- [ ] T101 [US4] Implementar `server/src/services/mailbox-check.ts` y `server/src/jobs/mailbox-job.ts` con su condición en el tick (RF-99 a RF-109)

**Checkpoint**: el circuito facturar → recibir comprobante → Pago recibido o Revisión manual funciona con fakes

---

## Phase 7: User Story 5 - Revisión humana de pagos y avisos (Priority: P1)

**Goal**: interfaz de revisión con evidencia, decisiones de usuario, avisos y resueltos

**Independent Test**: con facturas en Pago recibido y Revisión manual y avisos Pendientes, tomar cada decisión y verificar estados, motivos, usuario y resueltos

### Tests for User Story 5 ⚠️

- [ ] T102 [P] [US5] Test de API en `server/tests/api/review.test.ts`: listado de pagos con evidencia y motivo y sin otros estados, avisos Pendientes, pasar a Pagada o devolver a Pendiente desde Pago recibido y Revisión manual, motivo eliminado, pasar a Pagada desde el listado, aviso Revisado con usuario, resueltos con decisión, usuario, fecha, estado y motivo previos y comprobantes, filtros por cliente y fechas (AC-10, AC-144 a AC-151, AC-153, AC-238)
- [ ] T103 [P] [US5] Test de API en `server/tests/api/review-conflict.test.ts`: cambio de estado con `expectedStatus` desactualizado → `409` con el estado vigente y sin cambios (AC-240)
- [ ] T104 [P] [US5] Test de componente en `web/tests/pages/review.test.tsx`: ante `409` se muestra el mensaje y se recarga la vista (AC-240)

### Implementation for User Story 5

- [ ] T105 [US5] Implementar `server/src/services/review.ts` (pagos, avisos, resueltos y transiciones de usuario con `UPDATE ... WHERE status = ?`, research R-14)
- [ ] T106 [US5] Implementar `server/src/http/routes/review.ts` y `POST /api/invoices/:id/status` en `server/src/http/routes/invoices.ts`
- [ ] T107 [P] [US5] Implementar en web `ReviewPage` con las pestañas Pagos, Avisos, Errores (vacía hasta US7) y Resueltos en `web/src/pages/review/`, y el botón "Pasar a Pagada" en `InvoicesPage` para facturas Pendiente de pago, con `expectedStatus` (RF-147)

**Checkpoint**: el circuito de cobranza se cierra con la decisión humana

---

## Phase 8: User Story 9 - Evaluación de punta a punta en modo mock (Priority: P1)

**Goal**: el evaluador recorre todo el circuito solo con `MOCK_MODE=true`

**Independent Test**: arrancar con `MOCK_MODE` como única variable, facturar, cargar un email con `pago_<CUIT>_<monto>.pdf` y verificar Pago recibido sin conexiones externas salvo la cotización

### Tests for User Story 9 ⚠️

- [ ] T108 [P] [US9] Test de integración en `server/tests/integration/mock/end-to-end.test.ts` con el modo mock real: arranque solo con `MOCK_MODE`, facturación del día 15, sin llamadas a ARCA, al LLM ni a Gmail, clasificación por nombre de archivo y cambios de estado con sus motivos, procesamiento en la siguiente revisión (AC-196 a AC-199, AC-203, AC-204)
- [ ] T109 [P] [US9] Test de integración en `server/tests/integration/mock/mock-markings.test.ts`: PDF y emails marcados como simulados, CUIT emisor `20111111112` o `ARCA_CUIT`, sin banner de certificado (AC-205 a AC-207). Además: el PDF y el email de cada factura llevan también la leyenda de homologación (AC-207)
- [ ] T110 [P] [US9] Test de integración en `server/tests/integration/mock/db-separation.test.ts`: datos creados en un modo no aparecen en el otro; error de arranque con `DATABASE_PATH` apuntando a la base mock fuera de mock (AC-208 a AC-210)
- [ ] T111 [P] [US9] Test de API en `server/tests/api/mock-mailbox.test.ts`: Admin ve enviados y recibidos, Editor y Consulta solo recibidos de clientes, Consulta no puede cargar, email con remitente propio ignorado, recuperación de contraseña rechazada en mock, casilla inaccesible fuera de mock (AC-200 a AC-202, AC-219 a AC-221)
- [ ] T112 [P] [US9] Test de componente en `web/tests/components/header.test.tsx`: indicador "Modo mock: ARCA, LLM y email simulados" solo en mock y sin opción de recuperar contraseña en el login (AC-195, AC-202)

### Implementation for User Story 9

- [ ] T113 [US9] Implementar `server/src/services/mock-mailbox.ts` y `server/src/http/routes/mock-mailbox.ts` (multipart, `403` fuera de mock, visibilidad por perfil)
- [ ] T114 [US9] Agregar las marcas de modo mock (RF-210), conservando la leyenda de homologación, a `server/src/documents/invoice-pdf.ts` y `server/src/documents/email-templates.ts`, y ocultar el banner de certificado en mock en `server/src/services/banners.ts` (RF-208)
- [ ] T115 [P] [US9] Implementar en web `MockMailboxPage` (listado, detalle con adjuntos y formulario de carga) en `web/src/pages/mock-mailbox/`, el indicador en `web/src/components/AppLayout.tsx` y el ocultamiento de la recuperación en `LoginPage`

**Checkpoint**: quickstart.md §2 se puede recorrer completo

---

## Phase 9: User Story 6 - Recordatorios de fin de mes y dashboard de deuda (Priority: P2)

**Goal**: recordatorios automáticos y manuales y dashboard de clientes con deuda

**Independent Test**: con clientes en distintas situaciones de deuda, ejecutar el proceso de fin de mes y el envío manual y verificar quién recibe recordatorio y con qué contenido

### Tests for User Story 6 ⚠️

- [ ] T116 [P] [US6] Test de integración en `server/tests/integration/reminders/reminders-run.test.ts` con reloj falso: inicio a las 11:00 del último día (±1 min) y a las 14:00 tras el cambio, un único recordatorio por cliente Activo con deuda y sin revisión (también sin productos), ninguno a clientes en revisión, sin deuda o Inactivos, contenido con cada factura, total y pedido de comprobante (AC-88, AC-154 a AC-159, AC-162). Además: una corrida interrumpida se retoma el mismo día solo para los clientes que faltan y nunca al día siguiente (AC-246)
- [ ] T117 [P] [US6] Test de API en `server/tests/api/dashboard.test.ts`: listado de clientes con deuda vigente con total, cantidad y si está en revisión; recordatorio manual por cualquier perfil registrado con el usuario y visible para Editor y Consulta; bloqueos con mensaje para clientes sin deuda, en revisión o Inactivos (AC-12, AC-13, AC-89, AC-161, AC-163, AC-164)

### Implementation for User Story 6

- [ ] T118 [US6] Implementar `server/src/services/reminders.ts` (armado con las facturas adeudadas actuales y validaciones) y la plantilla de recordatorio en `server/src/documents/email-templates.ts`
- [ ] T119 [US6] Implementar `server/src/jobs/reminders-job.ts` con `reminder_runs` y su condición en el tick, retomando el mismo día una corrida interrumpida (RF-149)
- [ ] T120 [US6] Completar `GET /api/dashboard` con el listado de deuda y agregar `POST /api/clients/:id/reminder` en `server/src/http/routes/dashboard.ts`
- [ ] T121 [P] [US6] Implementar en web `DashboardPage` con el listado, los banners y el botón de recordatorio en `web/src/pages/DashboardPage.tsx`

**Checkpoint**: recordatorios y dashboard funcionando

---

## Phase 10: User Story 7 - Manejo de errores de procesos automáticos (Priority: P2)

**Goal**: reintentos configurables persistidos, errores de proceso, reintento manual y banner

**Independent Test**: simular fallas de ARCA y del email con fakes y verificar intentos, esperas, errores, reintento manual y banner

### Tests for User Story 7 ⚠️

- [ ] T122 [P] [US7] Test de integración en `server/tests/integration/errors/retry-queue.test.ts` con reloj falso: segundo intento a los 5 min (±1) con éxito sin error; 4 intentos y error Pendiente con cliente, operación, período, intentos y último mensaje para generación, envío de factura y recordatorio; reintentos en 0 → un intento; espera de 10 min; otro cliente no espera los reintentos; reenvío sin regenerar la factura (AC-79, AC-80, AC-178 a AC-182, AC-184). Además: la cola se retoma tras un reinicio con el intento guardado y un reintento de recordatorio se cancela sin error si el cliente ya no corresponde (AC-247)
- [ ] T123 [P] [US7] Test de API en `server/tests/api/process-errors.test.ts`: listado de Pendientes sin Resueltos, reintento manual con un único intento que genera y envía la factura, reenvío solo del email, error que sigue Pendiente con el nuevo mensaje, marcar Resuelto con usuario, banner con la cantidad y que desaparece, recordatorio manual fallido sin error de proceso (AC-186 a AC-194). Además: el reintento manual de una generación se bloquea con mensaje si el cliente está Inactivo o sin productos Activos (AC-248)
- [ ] T124 [P] [US7] Test de API en `server/tests/api/reminder-retry.test.ts`: reintento manual de un recordatorio recalculado con la deuda actual y bloqueado con mensaje, dejando el error Pendiente, si el cliente no tiene deuda, está en revisión o está Inactivo (RF-178 aclarado, FR-046)

### Implementation for User Story 7

- [ ] T125 [US7] Implementar `server/src/jobs/retry-queue.ts` y conectarlo a `billing.ts`, `invoice-email.ts` y `reminders.ts` (research R-11, RF-171 a RF-174)
- [ ] T126 [US7] Completar `server/src/services/process-errors.ts` con reintento manual, resolución y conteo para el banner (RF-176 a RF-181, FR-046)
- [ ] T127 [US7] Agregar las rutas de errores a `server/src/http/routes/review.ts` y el banner de errores a `server/src/services/banners.ts`
- [ ] T128 [P] [US7] Completar la pestaña Errores de `ReviewPage` y el banner de errores en `web/src/components/Banners.tsx`

**Checkpoint**: las fallas quedan visibles y se pueden resolver

---

## Phase 11: User Story 8 - Listados, historial y reportes (Priority: P3)

**Goal**: listados con filtros, detalles, historial y reportes con CSV

**Independent Test**: con datos de varios períodos y estados, abrir cada listado y reporte, filtrar y comparar el CSV con la pantalla

### Tests for User Story 8 ⚠️

- [ ] T129 [P] [US8] Test de API en `server/tests/api/listings.test.ts`: listado y detalle de clientes, productos y facturas con sus campos, filtros de facturas por estado, cliente y período, filtro de clientes por estado y búsqueda por razón social o CUIT, detalle de factura con cambios de estado y emails, descarga del PDF por cualquier perfil (AC-165 a AC-169, AC-175, AC-176, AC-236, AC-239)
- [ ] T130 [P] [US8] Test de API en `server/tests/api/history.test.ts`: historial con todos los eventos de AC-170 en orden y con su actor (AC-170)
- [ ] T131 [P] [US8] Test de API en `server/tests/api/reports.test.ts`: reportes de facturación, cobranza y deuda con los valores de los AC, filtro por rango de períodos y CSV con las mismas filas y columnas (AC-171 a AC-174, AC-177)

### Implementation for User Story 8

- [ ] T132 [US8] Completar `server/src/http/routes/invoices.ts` con filtros, detalle y PDF, y `server/src/http/routes/clients.ts` con filtros, búsqueda e historial
- [ ] T133 [P] [US8] Implementar `server/src/services/reports.ts`, el generador CSV en `server/src/documents/csv.ts` y `server/src/http/routes/reports.ts`
- [ ] T134 [P] [US8] Completar en web `InvoicesPage` (filtros y detalle), `ClientDetailPage` (historial) y agregar `ReportsPage` con descarga CSV en `web/src/pages/`

**Checkpoint**: todas las historias funcionan de forma independiente

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: barridos transversales, evaluaciones externas y gates de la Constitución

- [ ] T135 [P] Test de API en `server/tests/api/permissions.test.ts`: Admin, Editor y Consulta pueden leer los listados, el dashboard, la revisión, los reportes y el historial (los datos de usuarios solo Admin); un usuario Consulta recibe `403` en cada endpoint de escritura salvo recordatorio manual y su propia contraseña, y nada cambia (AC-04, AC-07, AC-11, AC-217)
- [ ] T136 [P] Script de evaluación del LLM real en `server/scripts/eval/llm-classification.ts` (`npm run eval:llm -w server`) con el set de ≥ 20 adjuntos por clase en `server/scripts/eval/fixtures/` (no versionado si contiene datos reales) y reporte de aciertos por clase (AC-109 a AC-111, RNF-14)
- [ ] T137 [P] Scripts de rendimiento en `server/scripts/eval/performance.ts` (`npm run eval:perf -w server`) para p95 por email, 50 facturas y 50 recordatorios (AC-232 a AC-234)
- [ ] T138 Ejecutar `gitleaks detect` sobre todo el historial y corregir cualquier hallazgo (AC-225, SC-009)
- [ ] T139 Ejecutar `npm run test:coverage-ac` y agregar los tests que falten hasta que no quede ningún AC sin cubrir (SC-010)
- [ ] T140 Recorrer `specs/001-aldebaran-mvp/quickstart.md` §1 y §2 y registrar el resultado
- [ ] T141 [P] Verificar que los comandos y variables documentados en `AGENTS.md` coinciden con los scripts y con `.env.example`, y actualizar la documentación si cambió algo
- [ ] T142 Abrir el PR de la rama `001-aldebaran-mvp` a `main` con el resumen de historias completadas y gates cumplidos (`npm run test`, `npm run test:coverage-ac`, gitleaks, quickstart), para la revisión humana que exige la Constitución

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias
- **Foundational (Phase 2)**: depende de Setup y bloquea todas las historias
- **US1 (Phase 3)**: depende de Foundational
- **US2 (Phase 4)**: depende de US1 (los endpoints requieren sesión y perfiles)
- **US3 (Phase 5)**: depende de US2 (clientes y productos) y de la configuración de US1
- **US4 (Phase 6)**: depende de US3 (necesita facturas adeudadas); sus tests de dominio (amount-matching, payment-rules, email-classification, retry-policy) se pueden escribir en paralelo con US3
- **US5 (Phase 7)**: depende de US4 (facturas en Pago recibido o Revisión manual)
- **US9 (Phase 8)**: depende de US3, US4 y US5 (recorre el circuito completo)
- **US6 (Phase 9)**: depende de US3; puede ir en paralelo con US4, US5 y US9
- **US7 (Phase 10)**: depende de US3 y US6 (reintenta generación, envío de factura y recordatorios)
- **US8 (Phase 11)**: depende de US3; puede ir en paralelo con US4 en adelante
- **Polish (Phase 12)**: depende de todas las historias; T142 (PR a `main`) es la última tarea

### Within Each User Story

- Los tests se escriben primero y deben fallar (Constitución I)
- Dominio → adapters → servicios → rutas → web
- La historia queda completa, con su checkpoint validado, antes de pasar a la siguiente prioridad

### Parallel Opportunities

- Setup: todas las tareas [P] juntas
- Foundational: todos los tests [P] juntos; luego dominio y adapters mock [P] juntos
- En cada historia: todos sus tests [P] juntos; luego las implementaciones [P] (archivos distintos)
- Con más de una persona: US6 y US8 en paralelo con US4/US5 una vez terminada US3

---

## Parallel Example: User Story 4

```bash
# Tests de dominio de US4 (archivos distintos, sin dependencias entre sí):
Task: "Test de email-classification.ts en server/tests/unit/domain/email-classification.test.ts"
Task: "Test de amount-matching.ts en server/tests/unit/domain/amount-matching.test.ts"
Task: "Test de payment-rules.ts en server/tests/unit/domain/payment-rules.test.ts"
Task: "Test de retry-policy.ts en server/tests/unit/adapters/llm-retry-policy.test.ts"

# Implementaciones independientes:
Task: "Implementar server/src/domain/email-classification.ts"
Task: "Implementar server/src/domain/amount-matching.ts"
Task: "Implementar adapters/llm/retry-policy.ts y anthropic.ts"
Task: "Implementar adapters/mail/imap-mailbox.ts"
```

---

## Implementation Strategy

### MVP First

1. Setup + Foundational
2. US1 → US2 → US3: el sistema factura y envía (primer objetivo del PRD)
3. **STOP and VALIDATE**: facturación de punta a punta con ARCA mock
4. US4 → US5 → US9: cobranza completa y evaluación en modo mock (MVP evaluable, Constitución V fase 1)

### Incremental Delivery

1. MVP (US1 a US5 + US9) → validar con quickstart.md §2
2. US6 (recordatorios) → US7 (errores) → US8 (reportes), cada una con su checkpoint
3. Polish → gates de la Constitución → validación en homologación (quickstart.md §3)

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes
- Cada test cita sus AC; `npm run test:coverage-ac` debe terminar sin faltantes
- Todo el trabajo se hace en la rama `001-aldebaran-mvp`; se integra a `main` con un único PR revisado por un humano al terminar (T142, Constitución, Flujo de desarrollo)
- Commit después de cada tarea o grupo lógico, con Conventional Commits en español
- Ningún paso apunta a ARCA productivo; no existe modo producción en el MVP
