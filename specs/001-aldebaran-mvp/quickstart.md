# Quickstart: validación de punta a punta

Guía para comprobar que el MVP funciona. Los detalles de datos y endpoints están en
[data-model.md](./data-model.md) y [contracts/](./contracts/).

## 1. Suite automática (gate obligatorio)

```bash
npm install
npm run test              # Vitest en server/ y web/; sin llamadas reales a ARCA, Gmail ni Claude
npm run test:coverage-ac  # lista los AC del PRD sin test (debe salir vacío, salvo los externos)
gitleaks detect           # AC-225: sin hallazgos
```

Resultado esperado: todo en verde, ningún AC faltante y ningún secreto detectado.

## 2. Modo mock (evaluador, sin credenciales)

```bash
npm run db:reset:mock
npm run dev:mock          # http://localhost:5173 ; solo MOCK_MODE=true
```

| Paso | Acción | Resultado esperado | AC |
|------|--------|--------------------|----|
| 1 | Abrir la app | Pantalla de registro del primer Admin; header con "Modo mock: ARCA, LLM y email simulados" | AC-03, AC-195 |
| 2 | Registrar el Admin e iniciar sesión | Acceso al dashboard, sin banner de certificado | AC-206 |
| 3 | Configuración: punto de venta 3 y datos de la empresa emisora | Valores guardados | AC-71, AC-83 |
| 4 | Alta del producto "Plan Base" a $15.000,50 y del cliente Los Andes SA, CUIT 30711111111, `pagos@losandes.com`, Responsable Inscripto; asignarle el producto. Dar de alta también los tres clientes del paso 9, con el mismo producto, para que la corrida les genere su factura | Clientes Activos con el producto | AC-34, AC-43, AC-49 |
| 5 | Facturación → "Facturar ahora" | Factura C n.º 1, punto de venta 3, Pendiente de pago, CAE de 14 dígitos; el botón queda deshabilitado con "facturación del mes ya realizada" | AC-58, AC-60, AC-196 |
| 6 | Casilla simulada | Email enviado desde aldebaran-mock@gmail.com con el PDF; PDF y cuerpo marcados como simulados | AC-200, AC-207 |
| 7 | Cargar un email recibido de `Pagos@LosAndes.com` con el adjunto `pago_30711111111_15000.50.pdf` | En la siguiente revisión (≤ 15 min, o bajando el intervalo a 5) la factura pasa a Pago recibido | AC-103, AC-197, AC-203 |
| 8 | Revisión → confirmar el pago | Factura Pagada; aparece en resueltos con el usuario | AC-146, AC-238 |
| 9 | Con los tres clientes del paso 4, cada uno con su factura adeudada y sin revisión manual, cargar un email por cliente con `dudoso_x.jpg`, `error_1.pdf` y `pago_x_100.pdf` | Revisión manual con "clasificación dudosa", "no se pudo procesar el comprobante" y "no se pudieron extraer el CUIT o el monto" | AC-198, AC-199 |
| 9b | Enviar un nuevo `pago_<CUIT>_<monto>.pdf` desde uno de esos clientes | Sigue en Revisión manual con "revisión manual pendiente" y dos comprobantes asociados | AC-122, AC-124 |
| 10 | Cargar un email de un remitente desconocido | Aviso Pendiente en la interfaz de revisión | AC-102 |
| 11 | Reiniciar con `npm run dev` (sin mock) | No aparece ningún dato creado en mock | AC-208 |

Productos en dólares requieren internet (dolarhoy.com se lee también en mock); sin conexión, usar
productos en pesos.

## Registro de ejecución

### 28/10/2026, rama `001-aldebaran-mvp` después de T139 (T140)

**§1 Suite automática**: todo en verde.

| Comando | Resultado |
|---------|-----------|
| `npm ci --dry-run` | Sin cambios en `package-lock.json` |
| `npm run test` | server 653/653 (63 archivos), web 101/101 (19 archivos) |
| `npm run test:coverage-ac` | "Todos los AC tienen al menos un test que los cita." (250 AC de la suite) |
| `gitleaks detect` (8.30.1) | "no leaks found" sobre todo el historial |
| `npm run typecheck --workspaces` y `npm run build` | Sin errores |

**§2 Modo mock**: los 11 pasos dieron el resultado esperado. Se recorrieron por la API (las mismas
llamadas que hace la web), con la app en modo mock sobre una base en memoria, para no tocar
`data/aldebaran-mock.db`. Lo visual de cada pantalla (indicador del modo mock, botones, mensajes) lo
cubren los tests de componentes de `web/tests`.

| Paso | Resultado |
|------|-----------|
| 1 | `needsFirstAdmin` y modo `mock` |
| 2 | Inicio de sesión del Admin; sin banner de certificado |
| 3 | Punto de venta 3 y emisor guardados; ningún dato faltante para facturar |
| 4 | Cuatro clientes Activos con "Plan Base" |
| 5 | Factura C 00003-00000001 de Los Andes en Pendiente de pago con CAE de 14 dígitos; "Facturar ahora" deshabilitado con "facturación del mes ya realizada" |
| 6 | Email desde aldebaran-mock@gmail.com con el PDF; la leyenda de simulado en el cuerpo y en el PDF |
| 7 | Pendiente de pago antes de la revisión de la casilla y Pago recibido después |
| 8 | Pagada; en Resueltos con el usuario que decidió |
| 9 | "clasificación dudosa", "no se pudo procesar el comprobante" y "no se pudieron extraer el CUIT o el monto" |
| 9b | Sigue en Revisión manual con "revisión manual pendiente" y dos emails asociados |
| 10 | Un aviso Pendiente de otro@desconocido.com |
| 11 | La base del modo mock y la del modo real son archivos distintos; lo prueba `db-separation.test.ts` |

Cambio en esta guía a partir del recorrido: el paso 9 necesita clientes con su factura del mes, así que
ahora se dan de alta en el paso 4, antes de "Facturar ahora".

**§3 Homologación**: pendiente. Necesita credenciales reales, el set de comprobantes de
`server/scripts/eval/fixtures/` y llamadas pagas a Claude; `eval:perf` se probó solo con `--mock`.

## 3. Homologación (credenciales reales, fuera de la suite)

Requiere `.env` con `ANTHROPIC_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `ARCA_CUIT`,
`ARCA_CERT_PATH`, `ARCA_KEY_PATH` y, opcionalmente, `APP_URL` (si la web no corre en
`http://localhost:5173`) y, en desarrollo, `EMAIL_REDIRECT_TO`.

```bash
npm run dev
```

1. Repetir los pasos 2 a 8 del modo mock, enviando el comprobante como respuesta real al email de
   la factura. Esperado: factura autorizada en homologación (PDF y email con la leyenda "sin validez
   fiscal", AC-82) y comprobante validado por Claude.
2. Evaluación del LLM: `npm run eval:llm -w server` con el set de ≥ 20 adjuntos por clase
   (AC-109 a AC-111: ≥ 95 % por clase y ningún comprobante legible como "no").
3. Rendimiento: `npm run eval:perf -w server` (AC-232 a AC-234: p95 < 60 s por email; 50 facturas y
   50 recordatorios en ≤ 20 min).

## 4. Producción

Fuera de alcance del MVP (Constitución V): no hay configuración ni endpoints productivos.
