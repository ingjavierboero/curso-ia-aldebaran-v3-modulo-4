# Feature Specification: Aldebaran MVP — facturación y cobranza automatizadas

**Feature Branch**: `001-aldebaran-mvp`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Generá el spec a partir del PRD en @PRD.md"

> **Fuente normativa**: esta especificación se deriva por completo de `PRD.md` (PRD-002). No agrega,
> quita ni reinterpreta funcionalidad (Constitución, Principio II). Cada requerimiento y escenario
> referencia sus identificadores del PRD (RF-xx, RNF-xx, AC-xx). Las definiciones del glosario del
> PRD (sección "Definiciones": factura adeudada, deuda vigente, cliente en revisión, coincidencia de
> monto, combinación más antigua, email validable, etc.) se aplican tal cual. Ante cualquier
> discrepancia entre este documento y el PRD, prevalece el PRD y la diferencia se deriva a un humano
> (Principio III).

> **Terminología de modos**: lo que el PRD llama "modo real" es, en el MVP, el modo **homologación**
> de la Constitución (Principio V); el modo producción no existe en el MVP.

## Clarifications

### Session 2026-10-19

- Q: ¿El horario máximo configurable para facturación y recordatorios es 23:39 o 23:59? → A: 23:59
  (era un error de tipeo; se corrigieron RF-62, RF-152, AC-62 y AC-160 en `PRD.md`).
- Q: Si el agente revisa la casilla sin ninguna factura emitida, ¿qué hace con los emails? → A: No
  procesa ninguno; la primera revisión es la primera posterior a emitir la primera factura (se amplió
  RF-107 en `PRD.md`).
- Q: Al reintentar a mano un recordatorio fallido, si el cliente cambió de situación, ¿qué pasa? → A:
  Se recalcula con la deuda vigente al reintentar y se bloquea (con mensaje, error sigue Pendiente)
  si el cliente no tiene deuda vigente, está en revisión o está Inactivo (se amplió RF-178 en
  `PRD.md`).
- Q: Si al decidir sobre una factura su estado ya cambió desde que el usuario abrió la pantalla, ¿qué
  pasa? → A: Se rechaza, se muestra un mensaje y se actualiza la vista (nuevos RF-218 y AC-240 en
  `PRD.md`).
- Q: Al reenviar el email de una factura tras una falla, ¿la deuda vigente total se recalcula? → A: Sí,
  se calcula en cada intento de envío; la factura y su PDF no cambian (se amplió RF-88 en `PRD.md`).

### Session 2026-10-20

- Q: ¿Qué cotización usa cada facturación? → A: La leída en el momento de generar cada factura,
  también en reintentos (RF-63, AC-241).
- Q: ¿Qué leyendas lleva una factura en modo mock? → A: La de modo mock y además la de homologación
  (RF-210, AC-207).
- Q: Resolución del checklist `gate-requisitos.md` → A: se aprobaron las recomendaciones: orden de
  emails por fecha (RF-108), moneda distinta del peso → "dudoso" (RF-119), asociación de emails
  (RF-139), retención sin límite y sin auditoría de configuración (Fuera de Alcance), datos del
  emisor faltantes (RF-219), rechazo de ARCA sin reintento y datos vigentes en reintentos (RF-171),
  bloqueo del reintento manual (RF-177), email "dentro del minuto" (RF-85), retomar el período en el
  mes siguiente (RF-53), recordatorios retomados el mismo día (RF-149), cierre de sesiones (RF-18,
  RF-21), indicador de redirección (RF-220), medición de RNF-03/RNF-04 y nuevos riesgos y supuestos.
- Q: ¿De dónde sale la dirección de la URL de recuperación? → A: De la variable `APP_URL` (por
  defecto `http://localhost:5173`), nunca del header Host (RF-24, AC-251).

## User Scenarios & Testing *(mandatory)*

Personas (PRD, "Personas"): **Admin** (hoy el único usuario), **Editor** y **Consulta** (perfiles
previstos, sin personas asignadas) y **Evaluador** (recorre el circuito completo en modo mock, sin
credenciales). El **agente** es la parte del sistema que ejecuta los procesos automáticos.

### User Story 1 - Acceso, usuarios, perfiles y contraseñas (Priority: P1)

El Admin registra el primer usuario del sistema, inicia sesión y gestiona otros usuarios con perfil
Admin, Editor o Consulta. Cada perfil ve y hace solo lo que le corresponde. Cualquier usuario cambia
su contraseña y, fuera del modo mock, puede recuperarla por email.

**Why this priority**: sin acceso autenticado y control de perfiles no se puede usar ninguna otra
pantalla (RF-01); es la base de todas las demás historias.

**Independent Test**: con el sistema vacío, registrar el primer Admin, crear un Editor y un
Consulta, y verificar con cada uno qué pantallas y acciones quedan permitidas o rechazadas.

**Acceptance Scenarios** (completos: AC-01 a AC-33, AC-211 a AC-218, AC-222 a AC-224 y AC-249 a AC-251):

1. **Given** el sistema sin usuarios, **When** se registra el primer usuario con una contraseña de
   7 caracteres, **Then** se rechaza; con 8 caracteres queda Activo con perfil Admin (AC-03).
2. **Given** un único Admin Activo, **When** un Admin intenta darlo de baja o cambiarle el perfil,
   **Then** el sistema lo rechaza (AC-20).
3. **Given** un Editor o un Consulta, **When** intenta ver datos de usuarios, cambiar la
   configuración, cancelar o reactivar un período o ejecutar "Facturar ahora", **Then** el sistema
   lo rechaza y nada cambia (AC-213 a AC-216).
4. **Given** un usuario Consulta, **When** intenta modificar cualquier registro salvo enviar un
   recordatorio manual o cambiar su propia contraseña, **Then** el sistema lo rechaza (AC-217).
5. **Given** un token de recuperación enviado hace 11 minutos, ya usado o reemplazado por uno nuevo,
   **When** el usuario abre la URL, **Then** ve un error y a los 5 s (±1 s) vuelve al inicio de
   sesión (AC-29 a AC-31).
6. **Given** un usuario sin actividad durante 24 h, **When** realiza una acción, **Then** debe
   iniciar sesión de nuevo; con 23 h de inactividad la acción se ejecuta (AC-222, AC-223).

---

### User Story 2 - Gestión de clientes, productos y asignaciones (Priority: P1)

Un Admin o Editor da de alta, modifica, da de baja y reactiva clientes y productos, y asigna o
desasigna productos a clientes, con las validaciones de CUIT, email, condición frente al IVA y precio.

**Why this priority**: los clientes con productos Activos asignados son la entrada de la
facturación mensual; sin ellos no hay nada que facturar ni cobrar.

**Independent Test**: dar de alta clientes y productos válidos e inválidos, asignar productos y
verificar listados, rechazos y el efecto sobre la próxima factura.

**Acceptance Scenarios** (completos: AC-34 a AC-50):

1. **Given** un Admin o Editor, **When** da de alta un cliente con CUIT 30711111118 (dígito
   verificador incorrecto), **Then** el sistema lo rechaza; con 30711111111 lo acepta (AC-41).
2. **Given** un cliente con email pagos@losandes.com, **When** se intenta dar de alta otro con
   Pagos@LosAndes.com, **Then** se rechaza y nada cambia (AC-42).
3. **Given** un producto, **When** se intenta guardar con precio 0 o -100, **Then** se rechaza; con
   0,01 se acepta (AC-44).
4. **Given** un cliente con facturas emitidas, **When** se modifica su razón social o el nombre o
   precio de un producto asignado, **Then** la siguiente factura usa el dato nuevo y las ya
   emitidas no cambian (AC-36, AC-45, AC-46).

---

### User Story 3 - Facturación mensual automática en homologación de ARCA (Priority: P1)

El día 15 de cada mes, a la hora de facturación, el agente genera una Factura C por cada cliente
Activo con al menos un producto Activo asignado, la autoriza en el ambiente de homologación de ARCA
y la envía por email con su PDF. El Admin puede facturar antes ("Facturar ahora"), cancelar o
reactivar el período y configurar la hora, el punto de venta y los datos de la empresa emisora.

**Why this priority**: es el objetivo principal del producto (PRD, "Objetivos": el 100 % de las
facturas generadas y enviadas cada mes).

**Independent Test**: con clientes y productos cargados, ejecutar el proceso del día 15 (o
"Facturar ahora") y verificar facturas, numeración, PDF, emails, ausencia de duplicados y casos
excluidos.

**Acceptance Scenarios** (completos: AC-51 a AC-91, AC-237, AC-241 y AC-242):

1. **Given** el día 15 a la hora de facturación (11:00 por defecto, hora de Argentina), **When** el
   agente ejecuta el proceso, **Then** se genera una factura por cada cliente facturable, en estado
   Pendiente de pago (AC-51, AC-52).
2. **Given** el sistema detenido el 15/10/2026, **When** vuelve el 17/10/2026, **Then** factura
   octubre dentro del minuto siguiente; si vuelve en noviembre, no factura octubre (AC-53).
3. **Given** un proceso interrumpido o ejecutado de nuevo en el mismo mes, **When** se retoma,
   **Then** no se genera una segunda factura ni un segundo comprobante en ARCA para el mismo cliente
   y período (AC-54, AC-72, AC-73).
4. **Given** un producto en dólares y una cotización de $1.555,50, **When** se factura USD 0,01,
   **Then** el ítem queda en $15,56 (AC-64); sin cotización disponible ni registrada, no se factura
   a ese cliente y se registra un error de proceso (AC-67).
5. **Given** el sistema facturando en homologación, **When** se envía una factura, **Then** el PDF y
   el email indican que no tiene validez fiscal (AC-82).
6. **Given** un cliente con una factura de septiembre de $15.000 adeudada, **When** se le factura
   octubre por $201.600, **Then** el email informa una deuda pendiente de $216.600 que incluye
   facturas anteriores (AC-81).

---

### User Story 4 - Control automático de pagos recibidos por email (Priority: P1)

El agente revisa periódicamente la casilla del sistema, identifica los emails de cada cliente,
clasifica sus adjuntos con un LLM ("si", "no" o "dudoso"), extrae CUIT y monto de cada comprobante y
aplica las reglas excluyentes RF-126 a RF-137: pasa a Pago recibido las facturas que el pago cubre o
a Revisión manual (con su motivo) todo caso que no puede validar. Nunca marca una factura como Pagada.

**Why this priority**: es el segundo objetivo del producto (el 100 % de los pagos recibidos
controlados por el sistema) y el que más reduce el trabajo manual.

**Independent Test**: con facturas adeudadas cargadas, inyectar emails con distintos adjuntos (con
el LLM y la casilla simulados) y verificar el estado final y el motivo de cada factura.

**Acceptance Scenarios** (completos: AC-92 a AC-108, AC-112 a AC-143, AC-230, AC-231 y AC-243 a AC-245; AC-109 a
AC-111 se verifican fuera de la suite automática):

1. **Given** un cliente con una sola factura adeudada, **When** llega un comprobante "si" con su
   CUIT y el monto exacto, **Then** la factura pasa a Pago recibido (AC-133).
2. **Given** facturas A, B y C de enero, febrero y marzo por $100, $200 y $300, **When** llegan dos
   comprobantes por $100 y $200, **Then** A y B pasan a Pago recibido y C sigue Pendiente de pago
   (AC-137).
3. **Given** dos facturas del mismo monto de distintos meses, **When** llega un comprobante por ese
   monto, **Then** pasa a Pago recibido la más antigua (AC-139).
4. **Given** un cliente con deuda vigente que no está en revisión, **When** llega un comprobante
   "dudoso", sin CUIT o monto extraíble, con CUIT distinto, sin coincidencia de monto o con error de
   procesamiento, **Then** sus facturas adeudadas pasan a Revisión manual con el motivo que fija el
   PRD (AC-125 a AC-131, AC-143).
5. **Given** un cliente en revisión, **When** envía un nuevo email "si", "dudoso" o con error,
   **Then** todas sus facturas adeudadas quedan en Revisión manual con el motivo "revisión manual
   pendiente" (AC-122, AC-123).
6. **Given** un email de un remitente que no es ningún cliente, **When** el agente lo procesa,
   **Then** queda como aviso Pendiente y no se envía al LLM (AC-102).
7. **Given** un comprobante de $15.000,01 para una factura de $15.000,00, **When** se valida,
   **Then** la factura pasa a Revisión manual con el motivo "monto no coincide" (AC-230).

---

### User Story 5 - Revisión humana de pagos y avisos (Priority: P1)

Un Admin o Editor abre la interfaz de revisión, ve las facturas en Pago recibido o Revisión manual
con sus emails, adjuntos, clasificación, CUIT, monto y motivo, y decide si pasan a Pagada o vuelven
a Pendiente de pago. También revisa los avisos y consulta las decisiones ya tomadas.

**Why this priority**: es el único camino por el que una factura llega a Pagada (Constitución,
Principio III); sin esta historia el circuito de cobranza no se cierra.

**Independent Test**: con facturas en Pago recibido y Revisión manual y avisos Pendientes, tomar
cada decisión posible y verificar estados, motivos, registro del usuario y listado de resueltos.

**Acceptance Scenarios** (completos: AC-144 a AC-153, AC-238 y AC-240):

1. **Given** facturas en Pago recibido y Revisión manual, **When** un usuario abre la interfaz de
   revisión, **Then** las ve con su evidencia y motivo, y no ve facturas en otros estados (AC-144).
2. **Given** una factura en Pago recibido o Revisión manual, **When** un Admin o Editor confirma el
   pago, **Then** pasa a Pagada y deja de ser adeudada; si indica que no se pagó, vuelve a Pendiente
   de pago y deja de mostrar su motivo (AC-146 a AC-149, AC-151).
3. **Given** una decisión tomada, **When** se abre el listado de resueltos, **Then** aparece con la
   decisión, el usuario, la fecha y hora, el estado y el motivo anteriores y los comprobantes
   (AC-238).

---

### User Story 6 - Recordatorios de fin de mes y dashboard de deuda (Priority: P2)

El último día de cada mes el agente envía un recordatorio a cada cliente Activo con deuda vigente
que no está en revisión. El dashboard lista a los clientes con deuda vigente y permite enviar un
recordatorio manual.

**Why this priority**: mejora la cobranza, pero el circuito principal (facturar, recibir y validar
pagos) funciona sin ella.

**Independent Test**: con clientes en distintas situaciones de deuda, ejecutar el proceso de fin de
mes y el envío manual y verificar quién recibe recordatorio y con qué contenido.

**Acceptance Scenarios** (completos: AC-154 a AC-164, AC-88, AC-89 y AC-246):

1. **Given** un cliente Activo con deuda vigente que no está en revisión, **When** se ejecuta el
   proceso de fin de mes, **Then** recibe un único recordatorio, registrado en su historial (AC-154).
2. **Given** facturas adeudadas de $10.000 y $12.000, **When** se envía el recordatorio, **Then** las
   detalla e informa un total de $22.000 (AC-158).
3. **Given** un cliente en revisión, sin deuda vigente o Inactivo, **When** un usuario intenta el
   recordatorio manual, **Then** el sistema lo bloquea con el mensaje correspondiente (AC-89,
   AC-163, AC-164).

---

### User Story 7 - Manejo de errores de procesos automáticos (Priority: P2)

Cuando una generación de factura, un envío de factura o un recordatorio automático falla, el agente
reintenta según la configuración y, si sigue fallando, registra un error de proceso Pendiente que un
Admin o Editor puede reintentar manualmente o marcar como Resuelto. El dashboard muestra un banner
mientras haya errores Pendientes.

**Why this priority**: es la mitigación de los riesgos de ARCA, email y casilla; sin ella las fallas
pasan inadvertidas, pero el circuito feliz funciona.

**Independent Test**: simular fallas de ARCA y del email y verificar intentos, esperas, registro del
error, reintento manual y banner.

**Acceptance Scenarios** (completos: AC-178 a AC-194, AC-247 y AC-248):

1. **Given** la configuración por defecto y ARCA sin responder, **When** se genera una factura,
   **Then** se hacen 4 intentos con 5 minutos (±1) de espera y se registra un error de proceso
   Pendiente (AC-178, AC-179).
2. **Given** un error Pendiente de envío de factura, **When** se reintenta manualmente con éxito,
   **Then** se reenvía solo el email, no se genera otra factura y el error pasa a Resuelto (AC-189).
3. **Given** un recordatorio manual que falla, **When** el usuario lo envía, **Then** ve un error, se
   hace un único intento y no se registra error de proceso (AC-194).

---

### User Story 8 - Listados, historial y reportes (Priority: P3)

Cualquier usuario autenticado consulta los listados de clientes, productos y facturas (con filtros),
el detalle de clientes y facturas, el historial cronológico de cada cliente y los reportes de
facturación, cobranza y deuda, descargables en CSV. El Admin además ve el listado de usuarios.

**Why this priority**: da visibilidad y auditoría; el circuito de facturación y cobranza funciona
sin estas vistas.

**Independent Test**: con datos de varios períodos y estados, abrir cada listado y reporte, aplicar
filtros y comparar el CSV descargado con lo que muestra la pantalla.

**Acceptance Scenarios** (completos: AC-165 a AC-177, AC-236 y AC-239):

1. **Given** facturas de octubre de 2026 por $10.000 Pagada, $20.000 en Pago recibido, $30.000
   Pendiente de pago y $40.000 en Revisión manual, **When** se abre el reporte de cobranza, **Then**
   muestra $100.000 facturado, $10.000 Pagada, $20.000 en Pago recibido y $70.000 adeudado (AC-172).
2. **Given** un cliente con una secuencia completa de eventos, **When** se abre su historial,
   **Then** ve todos los eventos en orden cronológico con fecha, hora y quién los originó (AC-170).
3. **Given** un reporte filtrado por rango de períodos, **When** se descarga como CSV, **Then**
   contiene exactamente las mismas filas y columnas que la pantalla (AC-174, AC-177).

---

### User Story 9 - Evaluación de punta a punta en modo mock (Priority: P1)

El Evaluador arranca el sistema solo con el modo mock activado, sin credenciales de ARCA, Anthropic
ni Gmail, y recorre todo el circuito: factura, ve los emails enviados en la casilla simulada, carga
emails de respuesta con adjuntos cuyo nombre determina la clasificación y observa cómo el agente los
valida, con una base de datos separada de la del modo real.

**Why this priority**: es un objetivo explícito del PRD y el primer modo de ejecución de la
Constitución (Principio V); habilita probar el resto de las historias sin servicios reales.

**Independent Test**: arrancar con MOCK_MODE como única variable definida, facturar, cargar un email
con `pago_<CUIT>_<monto>.pdf` y verificar que la factura pasa a Pago recibido sin ninguna conexión
externa salvo la cotización.

**Acceptance Scenarios** (completos: AC-195 a AC-210 y AC-219 a AC-221):

1. **Given** MOCK_MODE=true como única variable, **When** arranca el sistema, **Then** funciona, el
   agente factura el día 15 y procesa los emails de la casilla simulada (AC-204).
2. **Given** el modo mock y el punto de venta 3 sin facturas, **When** se generan dos facturas,
   **Then** no se llama a ARCA y quedan con números 1 y 2 y un CAE ficticio de 14 dígitos que vence
   a los 10 días (AC-196).
3. **Given** un cliente con CUIT 30711111111 y una factura de $15.000,50, **When** llega
   `pago_30711111111_15000.50.pdf`, **Then** no se llama al LLM real y la factura pasa a Pago
   recibido (AC-197).
4. **Given** datos creados en un modo, **When** el sistema se reinicia en el otro, **Then** no
   aparecen; y fuera del modo mock no arranca si la base configurada es la del modo mock (AC-208 a
   AC-210).
5. **Given** el modo mock, **When** se abre cualquier pantalla, **Then** el header muestra "Modo
   mock: ARCA, LLM y email simulados" y cada PDF y email indican que son simulados (AC-195, AC-207).

---

### Edge Cases

- Sistema detenido el día 15: se factura al volver dentro del mismo mes; nunca en el mes siguiente
  (RF-52, AC-53).
- ARCA autoriza la factura pero la respuesta no llega: el reintento registra el número y CAE ya
  otorgados, sin pedir otro comprobante (RF-76, AC-73).
- Cliente sin condición frente al IVA: no se factura y se registra un error de proceso con el
  mensaje fijado (RF-82, RF-83, AC-77).
- dolarhoy.com no responde: se usa la última cotización registrada y se muestra el banner; sin
  ninguna registrada, no se factura a clientes con productos en dólares (RF-67, RF-68).
- Email con adjuntos "si" y "dudoso" a la vez: prevalece "dudoso" (orden de RF-123, AC-127).
- Email solo con imagen embebida o con adjuntos de formatos no admitidos (.docx): se trata como sin
  adjunto (RF-116, RF-117, AC-106, AC-107).
- Casilla con emails antes de que exista cualquier factura: no se procesa ninguno; al emitirse la
  primera factura, la primera revisión procesa solo los recibidos desde ese día (RF-107).
- Mismo email leído dos veces (mismo Message-ID): se procesa una sola vez (RF-109, AC-100).
- Email enviado desde la propia casilla del sistema: se ignora (RF-110, AC-101).
- Varias coincidencias de monto sin combinación más antigua única: Revisión manual con "no se pudo
  determinar qué facturas cancela el pago" (RF-136, AC-141, AC-142).
- Monto igual o menor a cero o con fracción de centavo: no hay coincidencia de monto (RNF-13, AC-231).
- Cliente Inactivo que envía un comprobante: se procesa igual que uno Activo (RF-118, AC-108), pero
  no recibe emails (RF-96).
- Casilla no disponible varios intervalos seguidos: un intento por intervalo y un único error
  Pendiente, que se resuelve solo al recuperarse y procesar los emails atrasados (RF-103 a RF-106).
- Revisión de casilla que dura más que el intervalo: la siguiente espera a que termine (RF-102).
- Certificado de ARCA vencido, ilegible o a 30 días o menos de vencer: banner de certificado; en
  modo mock nunca se muestra (RF-97, RF-98, RF-208).
- Reintento manual de un recordatorio fallido cuando el cliente ya pagó, quedó en revisión o fue dado
  de baja: se bloquea con un mensaje y el error sigue Pendiente; si se envía, refleja la deuda del
  momento del reintento (RF-178).
- Decisión de un usuario sobre una factura que el agente u otro usuario cambió mientras tanto: se
  rechaza y se actualiza la pantalla (RF-218, AC-240).
- Servidor con reloj en UTC: los horarios se rigen igual por hora de Argentina (RNF-12, AC-229).

## Requirements *(mandatory)*

Cada FR resume y agrupa requerimientos del PRD; el texto completo y normativo de cada RF/RNF está en
`PRD.md` y debe respetarse literalmente al planificar e implementar.

### Functional Requirements

**Acceso y perfiles**

- **FR-001** (RF-01, RF-04, RF-05): El sistema MUST exigir sesión iniciada para toda pantalla y
  operación, salvo inicio de sesión, recuperación de contraseña, cambio de contraseña con token y,
  mientras no exista ningún usuario, el registro del primer Admin, que se deshabilita en cuanto
  existe un usuario.
- **FR-002** (RF-02, RF-03, RNF-10, RF-18, RF-21): El sistema MUST permitir iniciar sesión con email y contraseña
  solo a usuarios Activos, cerrar sesión y expirar la sesión tras 24 h de inactividad. La baja de un usuario MUST cerrar todas sus sesiones y el cambio de contraseña MUST cerrar las demás sesiones del usuario.
- **FR-003** (RF-06 a RF-13): El sistema MUST aplicar los permisos de cada perfil: Admin ve y hace
  todo; Editor ve todo salvo datos de usuarios y hace todo salvo gestionar usuarios, modificar la
  configuración, cancelar o reactivar períodos y "Facturar ahora"; Consulta ve lo mismo que Editor
  y solo puede enviar recordatorios manuales y cambiar su propia contraseña.
- **FR-004** (RF-07): El sistema MUST NOT exponer el hash de las contraseñas a ningún perfil.
- **FR-005** (RF-14 a RF-20): Un Admin MUST poder dar de alta, modificar (nombre, email, perfil), dar
  de baja y reactivar usuarios, con email único sin distinguir mayúsculas, y el sistema MUST
  rechazar toda acción que deje al sistema sin un Admin Activo.

**Contraseñas**

- **FR-006** (RF-21, RF-22): Todo usuario MUST poder cambiar su propia contraseña indicando la actual;
  toda contraseña de menos de 8 caracteres MUST rechazarse en cualquier punto de alta o cambio.
- **FR-007** (RF-23 a RF-33): El sistema MUST ofrecer recuperación de contraseña por email con un
  token que vence a los 10 minutos, se invalida al usarse o al emitirse uno nuevo, se valida al
  abrir la URL y al confirmar, muestra el mismo mensaje exista o no el usuario, y ante un token
  inválido muestra un error y redirige al inicio de sesión a los 5 segundos. La URL del email MUST armarse con `APP_URL` (por defecto `http://localhost:5173`) y nunca con datos de la solicitud.
- **FR-008** (RNF-09): Las contraseñas MUST almacenarse solo como hash seguro (bcrypt con costo ≥ 12
  o argon2id), nunca en texto plano.

**Clientes y productos**

- **FR-009** (RF-34 a RF-41): Un Admin o Editor MUST poder dar de alta, modificar, dar de baja y
  reactivar clientes con razón social, CUIT, domicilio, email de facturación y condición frente al
  IVA (todos obligatorios), con CUIT de dígito verificador válido y único, email de facturación
  único sin distinguir mayúsculas y condición frente al IVA restringida a la lista de RF-38.
- **FR-010** (RF-42 a RF-48): Un Admin o Editor MUST poder dar de alta, modificar (nombre, precio y
  moneda pesos/dólares), desactivar y reactivar productos, con precio mayor a cero.
- **FR-011** (RF-49, RF-50): Un Admin o Editor MUST poder asignar productos Activos a un cliente y
  desasignarlos.

**Facturación**

- **FR-012** (RF-51, RF-94, RF-95, RF-71, RF-72): El agente MUST generar el día 15, a la hora de
  facturación, una única Factura C por cliente Activo con al menos un producto Activo asignado, en
  el punto de venta configurado y contra el ambiente de homologación de ARCA, con el detalle de la
  cuota mensual completa de cada producto Activo asignado.
- **FR-013** (RF-52, RF-53, RF-59, RF-74, RF-75, RF-76): El agente MUST facturar el período al volver
  a funcionar si estaba detenido el día 15 (solo dentro del mismo mes), retomar procesos
  interrumpidos y garantizar una sola factura por cliente y período y un solo comprobante en ARCA
  por factura, registrando el número y CAE ya otorgados si la respuesta se perdió. Un proceso interrumpido MUST retomarse aunque ya haya empezado el mes siguiente, con las fechas de RF-79 a RF-81.
- **FR-014** (RF-54 a RF-61): Un Admin MUST poder cancelar la facturación del mes en curso antes de
  que empiece, reactivarla mientras siga siendo ese mes (facturando de inmediato si ya pasó la
  hora del día 15) y ejecutar "Facturar ahora" con las mismas reglas; el botón MUST deshabilitarse
  con el motivo correspondiente ("cancelada", "facturación en curso" o "facturación del mes ya
  realizada") y la operación MUST rechazarse también si se invoca directamente.
- **FR-015** (RF-62, RF-73, RF-91, RF-100, RF-152, RF-172, RF-173): Un Admin MUST poder configurar la
  hora de facturación y la de recordatorios (00:00 a 23:59), el punto de venta (1 a 99999), el
  intervalo de revisión de la casilla (5 a 60 min), la cantidad de reintentos (0 a 10), la espera
  entre reintentos (1 a 60 min) y los datos de la empresa emisora; los valores fuera de rango MUST
  rechazarse conservando el anterior.
- **FR-016** (RF-63 a RF-70, RNF-13): El agente MUST convertir a pesos los productos en dólares con
  la cotización del dólar blue venta de dolarhoy.com al facturar, redondeando cada cuota al
  centavo; registrar cada cotización leída; usar la última registrada si el sitio no responde
  (mostrando el banner de cotización, que un Admin o Editor confirma); y no facturar a clientes con
  productos en dólares si no hay ninguna cotización. La cotización MUST leerse en el momento de generar cada factura, también en reintentos automáticos y manuales.
- **FR-017** (RF-77 a RF-83): El agente MUST informar y registrar en cada factura la condición frente
  al IVA vigente del cliente, asignar fecha de emisión, período de servicio y vencimiento según
  RF-79 a RF-81, y no facturar (registrando un fallo con el mensaje de RF-83) a un cliente sin
  condición frente al IVA.
- **FR-018** (RF-84 a RF-90, RF-92, RF-93, RF-215): El agente MUST enviar cada factura apenas se
  genera, sin esperar ni demorarse por otros clientes, al email de facturación del cliente, con el
  PDF de RF-93, la información de RF-88 y RF-89, la leyenda de homologación sin validez fiscal
  (RF-90), los datos de la empresa emisora y, como remitente y firma, su nombre de fantasía o, si no
  existe, su razón social; un reintento de envío MUST NOT regenerar la factura. La deuda vigente
  total del email MUST calcularse en cada intento de envío (automático o manual), sin modificar la
  factura ni su PDF. El email MUST enviarse dentro del minuto siguiente a la generación de la factura.
- **FR-019** (RF-96): El sistema MUST NOT enviar ningún email a un cliente Inactivo.
- **FR-020** (RF-97, RF-98): El sistema MUST mostrar el banner de certificado mientras el certificado
  de ARCA esté vencido o ilegible (no se puede facturar) o falten 30 días o menos para su
  vencimiento.

**Control de pagos**

- **FR-021** (RF-99 a RF-108): El agente MUST revisar la casilla del sistema cada intervalo
  configurado (15 min por defecto) contado desde el inicio de la revisión anterior, sin solapar
  revisiones; ante una falla, registrar un único error de proceso Pendiente, reintentar en cada
  intervalo y, al recuperarse, procesar los emails atrasados y resolver el error; la primera
  revisión procesa desde el día de la primera factura emitida y las siguientes solo los emails
  nuevos. Mientras no exista ninguna factura emitida, el agente MUST NOT procesar ningún email (ni
  avisos, ni historial, ni clasificación); la primera revisión es la primera posterior a la emisión
  de la primera factura.
- **FR-022** (RF-109 a RF-118): El agente MUST procesar cada email una sola vez por Message-ID,
  ignorar los enviados por la propia casilla, identificar al cliente por su email de facturación
  sin distinguir mayúsculas, registrar como aviso Pendiente los de remitentes desconocidos,
  registrar en el historial del cliente cada email suyo y considerar posible comprobante solo los
  emails con al menos un adjunto de imagen (JPEG, PNG, GIF, WebP) o PDF no embebido, procesando
  igual a clientes Activos e Inactivos. Los emails de cada revisión MUST procesarse en orden de fecha de recepción, del más antiguo al más reciente.
- **FR-023** (RF-119 a RF-125, RNF-02): El agente MUST clasificar cada adjunto con un LLM como "si",
  "no" o "dudoso", extraer de cada comprobante el CUIT del ordenante (11 dígitos, comparado solo por
  sus dígitos) y el monto, reintentar las fallas del LLM según RNF-02, asignar la clasificación del
  email según el orden de RF-123 y registrar el resultado completo en el historial del cliente. Un comprobante de un pago en una moneda distinta del peso MUST clasificarse como "dudoso".
- **FR-024** (RF-126 a RF-137): El agente MUST aplicar a cada email con adjunto exactamente una de
  las reglas excluyentes RF-126 a RF-137, pasando a Pago recibido solo las facturas de la única
  coincidencia de monto o de la combinación más antigua, y a Revisión manual las facturas adeudadas
  del cliente en todos los demás casos que esas reglas indican, con el motivo literal de cada regla.
- **FR-025** (RF-138 a RF-140, RNF-13): El agente MUST registrar el motivo de cada pase a Revisión
  manual, asociar los emails nuevos a la revisión manual pendiente del cliente y evaluar las
  coincidencias de monto al centavo exacto; el motivo MUST dejar de mostrarse cuando la factura sale
  de Revisión manual. Todo email que dispara un cambio de estado (RF-128 a RF-137) MUST quedar asociado a cada factura afectada.
- **FR-026** (Constitución, Principio III; PRD, definición de "Pagada"): El agente MUST NOT pasar
  nunca una factura a Pagada.

**Revisión de pagos**

- **FR-027** (RF-141, RF-142, RF-175, RF-216): La interfaz de revisión MUST listar las facturas en Pago
  recibido o Revisión manual con su evidencia y motivo, los avisos Pendientes, los errores de
  proceso Pendientes y las decisiones ya tomadas (filtrables por cliente y rango de fechas, de la
  más reciente a la más antigua).
- **FR-028** (RF-143 a RF-148): Un Admin o Editor MUST poder pasar a Pagada o devolver a Pendiente de
  pago las facturas en Pago recibido o Revisión manual, pasar a Pagada una factura Pendiente de pago
  desde el listado de facturas y marcar avisos como Revisados, quedando registrado el usuario.
- **FR-047** (RF-218): Si al cambiar el estado de una factura esta ya no está en el estado que el
  usuario vio (porque la cambió el agente u otro usuario), el sistema MUST rechazar la acción,
  mostrar un mensaje y actualizar la pantalla con el estado vigente.
- **FR-048** (RF-219): Si faltan los datos obligatorios de la empresa emisora o el punto de venta, el
  agente MUST NOT generar la factura ni llamar a ARCA y MUST tratar la generación como fallida con el
  mensaje "faltan los datos de la empresa emisora o el punto de venta".
- **FR-049** (RF-220): Mientras la redirección de emails esté activa, el header MUST mostrar
  "Emails redirigidos a <dirección>".

**Recordatorios y dashboard**

- **FR-029** (RF-149 a RF-152, RF-155): El agente MUST enviar el último día del mes, a la hora de
  recordatorios, un recordatorio a cada cliente Activo con deuda vigente que no está en revisión,
  detallando cada factura adeudada y el total, y pidiendo responder con el comprobante. Si el proceso se interrumpe, MUST retomarse ese mismo día solo para los clientes que no recibieron el recordatorio, nunca al día siguiente.
- **FR-030** (RF-153, RF-154, RF-156, RF-157): El dashboard MUST listar los clientes con deuda vigente
  (razón social, deuda total, cantidad de facturas adeudadas, si está en revisión) y permitir el
  recordatorio manual, bloqueándolo para clientes sin deuda vigente, en revisión o Inactivos.

**Listados, historial y reportes**

- **FR-031** (RF-158 a RF-162, RF-168, RF-169, RF-214, RF-217): El sistema MUST mostrar los listados
  de clientes, productos, facturas y (solo a Admin) usuarios con los datos y filtros del PRD, el
  detalle de cliente y de factura (con cambios de estado y emails asociados) y permitir a todo
  perfil descargar el PDF de cualquier factura emitida.
- **FR-032** (RF-163): El sistema MUST mostrar el historial cronológico de cada cliente con todos los
  eventos que define el PRD, cada uno con fecha, hora y el usuario o el agente que lo originó.
- **FR-033** (RF-164 a RF-167, RF-170): El sistema MUST ofrecer los reportes de facturación por
  período, cobranza por período y deuda por cliente, filtrables por rango de períodos (los dos
  primeros) y descargables en CSV con las mismas filas y columnas que la pantalla.

**Errores de procesos automáticos**

- **FR-034** (RF-171 a RF-174): El agente MUST reintentar las generaciones de factura, envíos de
  factura y recordatorios automáticos fallidos según la configuración (3 reintentos y 5 min por
  defecto) y, si siguen fallando, registrar un error de proceso Pendiente con operación, intentos,
  último mensaje y, cuando corresponda, cliente y período. Un rechazo de validación de ARCA MUST NOT reintentarse automáticamente y registra el error de inmediato con el mensaje de ARCA; cada reintento de generación MUST usar los datos vigentes (cliente, productos, precios y cotización) salvo que ARCA ya haya autorizado el comprobante; un reintento automático de recordatorio cuyo cliente ya no corresponde MUST cancelarse sin error de proceso y quedar en el historial.
- **FR-035** (RF-176 a RF-181, RF-177): Un Admin o Editor MUST poder reintentar manualmente un error de
  proceso Pendiente con un único intento (regenerando y enviando la factura o reenviando solo el
  email, según la operación) o marcarlo como Resuelto; el dashboard MUST mostrar el banner de
  errores con la cantidad de errores Pendientes. El reintento manual de una generación MUST bloquearse con un mensaje, dejando el error Pendiente, si el cliente está Inactivo o sin productos Activos.
- **FR-046** (RF-178): El reintento manual de un recordatorio MUST armarse con las facturas adeudadas
  y la deuda vigente del cliente al momento del reintento, y MUST bloquearse (mostrando un mensaje y
  dejando el error de proceso Pendiente) si el cliente no tiene deuda vigente, está en revisión o
  está Inactivo.
- **FR-036** (RF-182, RF-183): Si falla una acción iniciada por un usuario, el sistema MUST mostrarle
  un error sin reintentar automáticamente ni registrar un error de proceso.

**Modo mock**

- **FR-037** (RF-184 a RF-193): El sistema MUST funcionar en modo mock solo con MOCK_MODE="true" y,
  en ese modo, no conectarse a ARCA ni al LLM real: numerar las facturas en secuencia por punto de
  venta con un CAE ficticio de 14 dígitos que vence a los 10 días y clasificar cada adjunto por su
  nombre de archivo según RF-189 a RF-193.
- **FR-038** (RF-194 a RF-204): En modo mock el sistema MUST NOT conectarse a Gmail y MUST usar una
  casilla simulada (dirección aldebaran-mock@gmail.com) que guarda los emails enviados y los
  recibidos que carga un Admin o Editor (con Message-ID único y fecha de carga), visible completa
  para Admin y solo los recibidos de clientes para Editor y Consulta, procesada en la siguiente
  revisión con las mismas reglas, sin recuperación de contraseña; fuera del modo mock la casilla
  simulada MUST ser inaccesible.
- **FR-039** (RF-205 a RF-210): En modo mock el sistema MUST arrancar con MOCK_MODE como única
  variable, usar 20111111112 como CUIT emisor y ejecutar los procesos automáticos si no se indica
  otra cosa, ocultar el banner de certificado, mostrar el indicador de modo mock en el header y
  marcar cada PDF y email como simulados. El PDF y el email de cada factura MUST llevar además la leyenda de homologación (RF-90).
- **FR-040** (RF-211 a RF-213): Los datos del modo mock y los del modo real MUST mantenerse en bases
  separadas, y fuera del modo mock el sistema MUST negarse a arrancar si se le indica usar la base
  del modo mock.

**Transversales**

- **FR-041** (RNF-08, RNF-11; Constitución, Principio IV): Todas las credenciales (API key del LLM,
  casilla de email, CUIT, certificado y clave de ARCA) MUST leerse de variables de entorno y nunca
  quedar en el código ni en el repositorio.
- **FR-042** (RNF-07): Las llamadas a servicios externos MUST darse por fallidas si no responden en
  30 s (ARCA y servidor de email) o 10 s (dolarhoy.com).
- **FR-043** (RNF-12): Todas las fechas y horarios MUST regirse por la zona horaria
  America/Argentina/Buenos_Aires.
- **FR-044** (RNF-13): Todos los montos MUST registrarse con precisión de centavos; la única
  operación que redondea es la conversión de dólares a pesos.
- **FR-045** (RNF-15): La interfaz MUST ofrecer tema claro y oscuro, seguir por defecto el del sistema
  operativo y recordar en el navegador la elección hecha desde el header.

Los criterios de aceptación transversales de FR-041 a FR-045 son AC-225 a AC-229 y AC-235 del PRD.

### Key Entities *(include if feature involves data)*

- **Usuario**: nombre, email (único, identifica el inicio de sesión), perfil (Admin, Editor,
  Consulta), contraseña (hash) y estado (Activo/Inactivo).
- **Token de recuperación**: pertenece a un usuario; vence a los 10 minutos; se invalida al usarse o
  al emitirse otro.
- **Cliente**: razón social, CUIT (único), domicilio, email de facturación (único), condición frente
  al IVA, estado y fecha de alta; tiene productos asignados, facturas, emails e historial.
- **Producto**: nombre, precio de la cuota mensual, moneda (pesos o dólares) y estado.
- **Asignación**: vínculo entre un cliente y un producto.
- **Período de facturación**: mes y año; puede estar cancelado, en curso o realizado, y registra si se
  ejecutó con "Facturar ahora".
- **Factura**: cliente, período, punto de venta, número, tipo (Factura C), fechas de emisión, servicio
  y vencimiento, ítems (cuotas), total en pesos, CAE y su vencimiento, condición frente al IVA
  informada, cotización usada, estado (Pendiente de pago, Pago recibido, Revisión manual, Pagada) y
  motivo (solo en Revisión manual); conserva sus datos al cambiar el cliente o los productos.
- **Cambio de estado de factura**: estado anterior y nuevo, motivo, fecha y hora, y usuario o agente.
- **Cotización**: valor, fuente y fecha de lectura; puede requerir confirmación de un usuario.
- **Email recibido**: Message-ID, remitente, asunto, cuerpo, fecha, cliente asociado (si lo hay) y
  clasificación del email; tiene adjuntos.
- **Adjunto**: archivo, clasificación ("si", "no", "dudoso" o procesamiento erróneo) y, si es
  comprobante, CUIT y monto extraídos.
- **Email enviado**: factura o recordatorio, automático o manual, destinatario, fecha y quién lo envió.
- **Aviso**: email de remitente desconocido; Pendiente o Revisado (con el usuario que lo revisó).
- **Error de proceso**: operación, cliente y período (si corresponde), cantidad de intentos, último
  mensaje y estado (Pendiente/Resuelto, con el usuario si lo resolvió a mano).
- **Evento de historial**: tipo, fecha y hora, cliente y usuario o agente que lo originó.
- **Configuración**: intervalo de revisión, horas de facturación y recordatorios, reintentos, espera,
  punto de venta y datos de la empresa emisora.
- **Revisión de la casilla**: inicio, fin y emails detectados.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (Objetivos): el 100 % de los clientes facturables reciben su factura y su email el día
  15 del mes (o antes con "Facturar ahora", o el día en que el sistema vuelva a funcionar dentro del
  mismo mes), salvo en los períodos cancelados.
- **SC-002** (RF-74, RF-75): en ningún período existe más de una factura por cliente ni más de un
  comprobante por factura.
- **SC-003** (Objetivos): el 100 % de los emails con adjunto recibidos de clientes quedan procesados
  con un resultado registrado.
- **SC-004** (RNF-01): el p95 del tiempo entre la detección de un email de respuesta y el registro de
  su resultado es menor a 60 segundos (AC-232).
- **SC-005** (RNF-03 a RNF-06): con 50 clientes, la facturación mensual completa y los recordatorios
  de fin de mes terminan cada uno en 20 minutos o menos, medidos hasta el primer intento con cada cliente y sin contar reintentos (AC-233, AC-234).
- **SC-006** (RNF-14): la clasificación de adjuntos acierta en al menos el 95 % de cada clase y
  ningún comprobante legible se clasifica como "no" (AC-109 a AC-111).
- **SC-007** (Objetivos; FR-026): el 0 % de las facturas pasa a Pagada sin la decisión de un usuario;
  la intervención humana se limita a confirmar pagos y resolver revisiones manuales.
- **SC-008** (Objetivos): un evaluador sin credenciales de ARCA, del LLM ni de email recorre el
  circuito completo (facturar, enviar, recibir y validar un comprobante) en modo mock.
- **SC-009** (AC-225): un escaneo de secretos sobre todo el historial del repositorio no reporta
  ningún hallazgo.
- **SC-010** (Constitución, Principio I): el 100 % de los criterios de aceptación del PRD que no se
  declaran externos a la suite tienen un test automatizado que los referencia.

## Assumptions

- `PRD.md` (PRD-002) es completo y normativo para el MVP; este spec no introduce requisitos nuevos.
  Cualquier vacío que aparezca al planificar se deriva a un humano (Constitución, Principio III).
- Alcance: el MVP completo descrito en el PRD, que se planifica como una sola feature y se implementa
  en el orden de prioridades de las historias. El modo de producción (ARCA productivo) queda fuera
  de alcance (PRD, "Fuera de Alcance"; Constitución, Principio V).
- Quedan fuera de alcance todos los puntos de la sección "Fuera de Alcance" del PRD (notas de
  crédito, otros comprobantes, prorrateos, intereses, portal de clientes, integración bancaria,
  bloqueo de cuentas, respaldos, simulación de fallas de ARCA o de dolarhoy.com en modo mock, entre
  otros).
- AC-109 a AC-111 (LLM real) y AC-232 a AC-234 (rendimiento) se verifican fuera de la suite
  automática, como indica el PRD; el resto de los AC se cubre con tests automatizados que no llaman
  a servicios reales.
- Dependencias externas (PRD, "Riesgos y Dependencias"): servicio del LLM, casilla de email, ambiente
  de homologación de ARCA y dolarhoy.com; en modo mock solo se depende de dolarhoy.com.
- Riesgos aceptados por el PRD: el crecimiento exponencial de la búsqueda de coincidencias con muchas
  facturas adeudadas y los requisitos de ARCA para el PDF productivo (QR RG 4892), que se resolverán
  antes de pasar a producción.
- Riesgos aceptados agregados el 2026-10-20: un comprobante reenviado puede imputarse a otra factura
  del mismo monto (lo frena la revisión humana de Pago recibido), y solo se revisa la carpeta INBOX
  de la casilla.
