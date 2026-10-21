# Data Model: Aldebaran MVP

SQLite con Drizzle. Convenciones:

- `id` entero autoincremental; timestamps como texto ISO 8601 en UTC (`*_at`); fechas civiles de
  Argentina como `YYYY-MM-DD` (`*_date`); períodos como `YYYY-MM`.
- Montos en **centavos** (`integer`) (RNF-13).
- Emails se guardan como se ingresan y además en una columna `*_normalized` en minúsculas con índice
  único, para las comparaciones sin distinguir mayúsculas (RF-15, RF-41, RF-112).
- Las mismas tablas existen en `aldebaran.db` y `aldebaran-mock.db`; la tabla `simulated_emails` solo
  se usa en modo mock (RF-204).

## Usuarios y acceso

### users (RF-04, RF-14 a RF-20, RNF-09)

| Campo | Tipo | Reglas |
|-------|------|--------|
| name | text | obligatorio |
| email / email_normalized | text | obligatorio; `email_normalized` UNIQUE |
| role | text | `admin` \| `editor` \| `consulta` |
| status | text | `activo` \| `inactivo` |
| password_hash | text | bcrypt costo ≥ 12; nunca se expone (RF-07) |
| created_at, updated_at | text | |

Invariante: siempre existe al menos un `admin` `activo`; las operaciones que lo romperían se
rechazan (RF-20). Contraseña ≥ 8 caracteres en toda alta o cambio (RF-22).

### sessions (RF-02, RF-03, RNF-10)

`token_hash` (UNIQUE), `user_id` → users, `created_at`, `last_activity_at`. Vence si
`now − last_activity_at ≥ 24 h`; cada request válido actualiza `last_activity_at`.

### password_reset_tokens (RF-23 a RF-33)

`token_hash` (UNIQUE), `user_id`, `sent_at`, `used_at` (null), `invalidated_at` (null). Válido si no
está usado ni invalidado y `now − sent_at < 10 min`. Al emitir uno nuevo se invalidan los anteriores
del usuario (RF-28). No se crean en modo mock (RF-199).

## Clientes y productos

### clients (RF-34 a RF-41)

| Campo | Tipo | Reglas |
|-------|------|--------|
| business_name | text | obligatorio (razón social) |
| cuit | text | 11 dígitos, dígito verificador válido, UNIQUE (RF-39, RF-40) |
| address | text | obligatorio |
| billing_email / billing_email_normalized | text | obligatorio; UNIQUE normalizado (RF-41) |
| iva_condition | integer \| null | uno de 1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16 (RF-38); null solo en datos heredados (RF-82) |
| status | text | `activo` \| `inactivo` |
| created_at | text | fecha de alta (RF-214) |

### products (RF-42 a RF-48)

`name`, `price_cents` (> 0, RF-44), `currency` (`ARS` \| `USD`), `status` (`activo` \| `inactivo`).

### client_products (RF-49, RF-50)

`client_id`, `product_id`, `assigned_at`; UNIQUE(`client_id`, `product_id`). Al desasignar se borra la
fila y se registra el evento en el historial. Solo se asignan productos `activo`.

## Facturación

### billing_periods (RF-51 a RF-61)

| Campo | Tipo | Reglas |
|-------|------|--------|
| period | text `YYYY-MM` | UNIQUE |
| status | text | `pendiente` → `en_curso` → `completado`; `cancelado` (desde `pendiente`, RF-54) |
| triggered_by | text \| null | `agente_dia_15`, `agente_recuperacion`, `reactivacion`, `facturar_ahora` |
| started_at, completed_at | text \| null | |
| cancelled_by_user_id, cancelled_at, reactivated_by_user_id, reactivated_at | | auditoría |

Transiciones: `pendiente → cancelado` (Admin, solo mes en curso y si no empezó); `cancelado →
pendiente` (Admin, solo mientras siga siendo ese mes; si ya pasó la hora del día 15 dispara la
facturación, RF-57); `pendiente → en_curso` (tick o "Facturar ahora"); `en_curso → completado` cuando
se intentó facturar a todos los clientes facturables (RF-61). Un período `en_curso` se retoma al
arrancar (RF-53).

### exchange_rates (RF-63 a RF-70)

`rate_cents`, `source` (`dolarhoy.com`), `read_at`. Además `fallback_alerts`: `exchange_rate_id`,
`used_at`, `confirmed_by_user_id`, `confirmed_at` (banner de cotización mientras haya una sin
confirmar).

### invoices (RF-71 a RF-93, RF-160, RF-217)

| Campo | Tipo | Reglas |
|-------|------|--------|
| client_id, period | | UNIQUE(`client_id`, `period`) (RF-74) |
| point_of_sale | integer | 1 a 99999 (RF-72, RF-73) |
| voucher_type | integer | siempre 11 (Factura C, RF-71) |
| number | integer \| null | asignado al pedir CAE; UNIQUE(`point_of_sale`, `number`); vuelve a `null` si ARCA no lo autorizó (research R-05) |
| issue_date, service_from, service_to, due_date | text `YYYY-MM-DD` | RF-79 a RF-81 |
| total_cents | integer | suma de ítems |
| cae, cae_due_date | text \| null | 14 dígitos |
| iva_condition | integer | la informada a ARCA (RF-77, RF-78) |
| exchange_rate_id | integer \| null | si algún ítem estaba en USD (RF-93) |
| client_snapshot | json | razón social, CUIT, domicilio y condición al emitir (AC-36) |
| issuer_snapshot | json | datos de la empresa emisora y CUIT al emitir (RF-92) |
| status | text | ver máquina de estados |
| manual_review_reason | text \| null | solo si `revision_manual` (RF-138, RF-140) |
| arca_attempt_at | text \| null | último pedido de CAE, para la recuperación de R-05 |
| arca_request | json \| null | datos exactos de la última solicitud de CAE, para registrar lo autorizado (RF-171) |

### invoice_items

`invoice_id`, `product_id`, `description` (nombre al facturar, AC-45), `original_price_cents`,
`original_currency`, `amount_cents` (ARS, redondeado según RF-64).

### Máquina de estados de `invoices.status`

```text
generando ──(CAE obtenido)──▶ pendiente_de_pago
pendiente_de_pago ──agente──▶ pago_recibido | revision_manual
revision_manual   ──agente──▶ revision_manual (motivo "revisión manual pendiente", RF-128/129)
pago_recibido     ──usuario─▶ pagada | pendiente_de_pago            (RF-143, RF-144)
revision_manual   ──usuario─▶ pagada | pendiente_de_pago            (RF-145, RF-146)
pendiente_de_pago ──usuario─▶ pagada                                (RF-147)
```

- `generando` es técnico: no se lista, no cuenta como adeudada ni como factura emitida. Si se agotan
  los reintentos la fila se conserva (con el número pedido) y el error de proceso la referencia, para
  que el reintento manual consulte primero a ARCA ese número y nunca emita un segundo comprobante
  (RF-75, RF-76, RF-177). Si el reintento manual ocurre en otro mes, la fecha de emisión y el
  vencimiento se recalculan (AC-76).
- **El agente nunca escribe `pagada`** (Constitución III): `domain/invoice-status.ts` recibe el actor
  (`agente` \| `usuario`) y rechaza la transición.
- Toda transición de usuario exige el `expectedStatus` vigente (RF-218, R-14).
- Factura adeudada = `pendiente_de_pago` \| `revision_manual`; deuda vigente = suma de adeudadas;
  cliente en revisión = alguna en `revision_manual`.

### invoice_status_changes (RF-217, RF-216)

`invoice_id`, `from_status`, `to_status`, `reason` (motivo previo o nuevo), `actor_type`
(`agente` \| `usuario`), `user_id`, `received_email_id` (si lo disparó un email), `changed_at`. Las
decisiones de usuario sobre `pago_recibido`/`revision_manual` forman el listado de resueltos
(RF-216).

### invoice_emails (RF-139, RF-141, RF-217)

Vincula `invoice_id` ↔ `received_email_id` para mostrar todos los comprobantes asociados a una
factura y a la revisión manual pendiente del cliente.

## Emails

### sent_emails (RF-84, RF-149, RF-154, RF-196)

`kind` (`factura` \| `recordatorio` \| `recuperacion`), `trigger` (`automatico` \| `manual` \|
`reintento_manual`), `client_id`, `invoice_id` (null en recordatorios), `to_address`, `subject`,
`body`, `sent_at`, `sent_by_user_id`. El PDF no se guarda: se regenera desde los datos de la factura.

### received_emails (RF-107 a RF-125)

| Campo | Tipo | Reglas |
|-------|------|--------|
| message_id | text | UNIQUE (RF-109) |
| from_address / from_normalized | text | |
| subject, body_text, received_at | | |
| client_id | integer \| null | null → aviso (RF-113) |
| classification | text \| null | `si` \| `no` \| `dudoso` \| `error` \| null si sin adjuntos (RF-123) |
| applied_rule | text \| null | `RF-126` … `RF-137` |
| processed_at | text | |

### received_attachments

`received_email_id`, `filename`, `mime_type` (verificado por la firma del archivo, nunca el declarado;
research R-16), `content` (blob), `classification`
(`si` \| `no` \| `dudoso` \| `error`), `extracted_cuit` (null si no se extrajo o no tiene 11 dígitos),
`extracted_amount_cents` (null si no se extrajo), `extracted_amount_raw` (para RNF-13).

### notices (RF-113, RF-142, RF-148)

`received_email_id`, `status` (`pendiente` \| `revisado`), `reviewed_by_user_id`, `reviewed_at`.

### mailbox_checks (RF-99 a RF-108)

`started_at`, `finished_at`, `success`, `emails_detected`. La "fecha de corte" de la siguiente
revisión es el `started_at` de la última exitosa; la primera, el `issue_date` de la primera factura.
Sin facturas emitidas no se procesa nada (RF-107 aclarado).

### simulated_emails (RF-196 a RF-204; solo modo mock)

`direction` (`enviado` \| `recibido`), `message_id` (UNIQUE, generado al cargar, RF-202), `from_address`,
`to_address`, `subject`, `body`, `created_at` (fecha de envío o de carga, RF-201),
`loaded_by_user_id`. Sus adjuntos en `simulated_attachments` (`filename`, `mime_type` verificado o
`application/octet-stream`, `content`).

## Procesos automáticos y errores

### retry_queue (RF-171)

`operation` (`generacion_factura` \| `envio_factura` \| `envio_recordatorio`), `client_id`, `period`,
`invoice_id`, `attempt` (1-based), `next_attempt_at`, `last_error`.

### process_errors (RF-103, RF-174 a RF-181)

| Campo | Tipo | Reglas |
|-------|------|--------|
| operation | text | las tres de la cola + `revision_casilla` |
| client_id, period, invoice_id | \| null | cuando corresponda |
| attempts | integer | |
| last_error_message | text | sin secretos |
| status | text | `pendiente` \| `resuelto` |
| resolved_by | text \| null | `reintento_manual` \| `usuario` \| `agente` (casilla, RF-106) |
| resolved_by_user_id, resolved_at | | |

Como máximo un `revision_casilla` `pendiente` a la vez (RF-103).

### reminder_runs (RF-149)

`month` (`YYYY-MM`, UNIQUE), `started_at`, `finished_at` (null mientras no terminó). Los clientes que ya
recibieron el recordatorio automático del mes se obtienen de `sent_emails` para retomar una corrida
interrumpida el mismo día (RF-149, AC-246).

## Configuración e historial

### settings (fila única; RF-62, RF-73, RF-91, RF-100, RF-152, RF-172, RF-173)

| Campo | Default | Rango |
|-------|---------|-------|
| mailbox_interval_minutes | 15 | 5 a 60 |
| billing_time | `11:00` | `00:00` a `23:59` |
| reminders_time | `11:00` | `00:00` a `23:59` |
| retry_count | 3 | 0 a 10 |
| retry_wait_minutes | 5 | 1 a 60 |
| point_of_sale | — | 1 a 99999 |
| issuer_business_name, issuer_address, issuer_gross_income_number | — | obligatorios para facturar |
| issuer_iva_condition | — | obligatorio; `Responsable Monotributo`, `Monotributista Social`, `Monotributo Trabajador Independiente Promovido` o `IVA Sujeto Exento` (RF-91) |
| issuer_activity_start_date | — | obligatorio; fecha existente del calendario (RF-91) |
| issuer_trade_name | null | opcional (RF-215) |

El CUIT emisor no se guarda: sale de `ARCA_CUIT` (o `20111111112` en mock, RF-206).

### client_events (RF-163, AC-170)

`client_id`, `type` (alta, modificacion, baja, reactivacion, producto_asignado, producto_desasignado,
factura_generada, email_enviado, email_recibido, estado_factura, error_proceso), `payload` (json con el
detalle, por ejemplo campos modificados o clasificación por adjunto, RF-124), `actor_type`, `user_id`,
`occurred_at`. Se escribe en la misma transacción que el cambio que registra.

### arca_tokens

`service` (`wsfe`), `token`, `sign`, `expires_at`. Solo modo homologación.
