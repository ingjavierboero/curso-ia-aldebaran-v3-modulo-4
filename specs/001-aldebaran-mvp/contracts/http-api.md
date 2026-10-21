# Contract: API HTTP (`/api`)

API JSON que consume `web/`. Autenticación por cookie de sesión (research R-10). Convenciones:

- Montos en centavos (`*Cents`); fechas `YYYY-MM-DD`; períodos `YYYY-MM`; timestamps ISO 8601.
- Errores: `{ "error": { "code": string, "message": string } }` con `400` validación, `401` sin sesión,
  `403` perfil sin permiso o acción no disponible en el modo, `404`, `409` conflicto de estado o de
  unicidad, `422` regla de negocio (por ejemplo, recordatorio a cliente en revisión).
- Ninguna respuesta incluye `passwordHash` (RF-07).
- Columna **Perfiles**: A = Admin, E = Editor, C = Consulta, — = sin sesión.

## Autenticación y cuenta

| Método y ruta | Perfiles | Descripción | Requisitos |
|---------------|----------|-------------|------------|
| GET `/api/setup` | — | `{ needsFirstAdmin: boolean, mode: 'mock'\|'homologacion', emailRedirectTo: string\|null }` | RF-04, RF-209, RF-220 |
| POST `/api/setup/first-admin` | — | Registra el primer Admin; `403` si ya existe un usuario | RF-04, RF-05, AC-212 |
| POST `/api/auth/login` | — | `{ email, password }`; solo usuarios Activos | RF-02, AC-01, AC-18 |
| POST `/api/auth/logout` | A E C | Borra la sesión | RF-03, AC-02 |
| GET `/api/auth/me` | A E C | Usuario actual y perfil | RF-17 |
| POST `/api/auth/password` | A E C | `{ currentPassword, newPassword }`; solo la propia | RF-21, AC-218 |
| POST `/api/auth/recovery` | — | `{ email }`; siempre la misma respuesta; `403` en mock | RF-23 a RF-25, RF-199 |
| GET `/api/auth/recovery/:token` | — | Valida el token | RF-29, RF-30, RF-32 |
| POST `/api/auth/recovery/:token` | — | `{ newPassword }`; vuelve a validar | RF-27, RF-29, RF-33 |

## Usuarios (solo Admin)

| Método y ruta | Descripción | Requisitos |
|---------------|-------------|------------|
| GET `/api/users` | Listado Activos e Inactivos | RF-161, AC-213 |
| POST `/api/users` | Alta `{ name, email, role, password }` | RF-14, RF-15, RF-22 |
| PATCH `/api/users/:id` | `{ name?, email?, role? }` | RF-16, RF-17, RF-20 |
| POST `/api/users/:id/deactivate` · `/reactivate` | Baja y reactivación | RF-18 a RF-20 |

## Clientes, productos y asignaciones

| Método y ruta | Perfiles | Descripción | Requisitos |
|---------------|----------|-------------|------------|
| GET `/api/clients?status=&q=` | A E C | Listado con deuda vigente; búsqueda por razón social o CUIT | RF-158, RF-169 |
| GET `/api/clients/:id` | A E C | Detalle | RF-214 |
| POST `/api/clients` · PATCH `/api/clients/:id` | A E | Alta y modificación | RF-34 a RF-41 |
| POST `/api/clients/:id/deactivate` · `/reactivate` | A E | | RF-36, RF-37 |
| GET `/api/clients/:id/history` | A E C | Eventos en orden cronológico | RF-163 |
| PUT `/api/clients/:id/products` | A E | `{ productIds }` (solo Activos) | RF-49, RF-50 |
| GET `/api/products` | A E C | Listado | RF-159 |
| POST `/api/products` · PATCH `/api/products/:id` | A E | `{ name, priceCents, currency }` | RF-42 a RF-46 |
| POST `/api/products/:id/deactivate` · `/reactivate` | A E | | RF-47, RF-48 |

## Facturación

| Método y ruta | Perfiles | Descripción | Requisitos |
|---------------|----------|-------------|------------|
| GET `/api/billing/current` | A E C | Período en curso: estado y `billNow: { enabled, reason }` | RF-60, RF-61 |
| POST `/api/billing/current/bill-now` | A | "Facturar ahora"; `409` si cancelado, en curso o realizado | RF-58 a RF-61, AC-59, AC-60 |
| POST `/api/billing/current/cancel` · `/reactivate` | A | Cancelar y reactivar el período | RF-54, RF-56, RF-57 |
| GET `/api/invoices?status=&clientId=&period=` | A E C | Listado | RF-160, RF-168 |
| GET `/api/invoices/:id` | A E C | Detalle: ítems, cambios de estado, emails | RF-217 |
| GET `/api/invoices/:id/pdf` | A E C | PDF de la factura | RF-162 |
| POST `/api/invoices/:id/status` | A E | `{ to: 'pagada'\|'pendiente_de_pago', expectedStatus }`; `409` si el estado cambió | RF-143 a RF-147, RF-218 |

## Revisión, avisos, errores y banners

| Método y ruta | Perfiles | Descripción | Requisitos |
|---------------|----------|-------------|------------|
| GET `/api/review/payments` | A E C | Facturas en Pago recibido y Revisión manual con su evidencia | RF-141 |
| GET `/api/review/resolved?clientId=&from=&to=` | A E C | Decisiones tomadas | RF-216 |
| GET `/api/review/notices` | A E C | Avisos Pendientes | RF-142 |
| POST `/api/review/notices/:id/reviewed` | A E | | RF-148 |
| GET `/api/review/errors` | A E C | Errores de proceso Pendientes | RF-175 |
| POST `/api/review/errors/:id/retry` | A E | Un único intento; `422` si el cliente ya no corresponde | RF-176 a RF-179, FR-046 |
| POST `/api/review/errors/:id/resolve` | A E | Marcar Resuelto | RF-180 |
| GET `/api/dashboard` | A E C | Clientes con deuda y banners (errores, cotización, certificado) | RF-153, RF-69, RF-97, RF-98, RF-181, RF-208 |
| POST `/api/dashboard/exchange-rate/confirm` | A E | Confirmar cotización de respaldo | RF-70 |
| POST `/api/clients/:id/reminder` | A E C | Recordatorio manual; `422` sin deuda, en revisión o Inactivo | RF-154, RF-156, RF-157, RF-96 |

## Reportes

| Método y ruta | Perfiles | Requisitos |
|---------------|----------|------------|
| GET `/api/reports/billing?from=&to=` (`&format=csv`) | A E C | RF-164, RF-167, RF-170 |
| GET `/api/reports/collections?from=&to=` (`&format=csv`) | A E C | RF-165, RF-167, RF-170 |
| GET `/api/reports/debt` (`?format=csv`) | A E C | RF-166, RF-167 |

## Configuración (escritura solo Admin)

| Método y ruta | Perfiles | Requisitos |
|---------------|----------|------------|
| GET `/api/settings` | A E C | RF-09, RF-11 |
| PUT `/api/settings` | A | RF-62, RF-73, RF-91, RF-100, RF-152, RF-172, RF-173, AC-215 |

## Casilla simulada (solo modo mock; `403` fuera de mock, RF-204)

| Método y ruta | Perfiles | Descripción | Requisitos |
|---------------|----------|-------------|------------|
| GET `/api/mock-mailbox` | A E C | Admin: todo; Editor y Consulta: solo recibidos de clientes | RF-197, RF-198, AC-221 |
| POST `/api/mock-mailbox/received` | A E | Multipart: `from`, `subject`, `body`, `attachments[]` | RF-200 a RF-202, AC-219 |
| GET `/api/mock-mailbox/:id/attachments/:attachmentId` | A E C | Descarga de adjuntos | RF-197 |
