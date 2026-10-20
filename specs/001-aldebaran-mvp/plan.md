# Implementation Plan: Aldebaran MVP — facturación y cobranza automatizadas

**Branch**: `001-aldebaran-mvp` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-aldebaran-mvp/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Sistema interno que factura cada mes a los clientes en el ambiente de homologación de ARCA, envía las
facturas por email, revisa la casilla para detectar comprobantes de pago, los clasifica con un LLM y
aplica las reglas de validación del PRD (RF-126 a RF-137), derivando a un humano todo lo que no puede
validar. El stack es exactamente el de `AGENTS.md`: monorepo npm con `server/` (Express 5 + SQLite con
Drizzle) y `web/` (React 19 + Vite + antd). El agente corre dentro del server con node-cron.

El enfoque técnico se apoya en cuatro decisiones (ver [research.md](./research.md)):

1. **Un puerto por servicio externo** (ARCA, LLM, envío de email, casilla, cotización) con una
   implementación real y una mock, elegidas en un único punto según el modo (Constitución V).
2. **Dominio puro y testeable** (montos en centavos, CUIT, fechas de facturación, clasificación del
   email, búsqueda de coincidencias de monto, reglas RF-126 a RF-137) sin dependencias de I/O,
   escrito test-first (Constitución I).
3. **Procesos automáticos persistentes**: el estado de cada período, intento y reintento vive en la
   base, así que un reinicio retoma sin duplicar (RF-53, RF-74 a RF-76) y los reintentos de un
   cliente no bloquean a otro (RF-87).
4. **Un "tick" por minuto** que decide qué corresponder ejecutar (facturación, recordatorios,
   revisión de casilla) a partir del reloj de Argentina y del estado persistido, en vez de cron
   fijos; así se cubren la recuperación tras una caída (RF-52, RF-57) y los cambios de horario
   (AC-61, AC-93) con la tolerancia de ±1 minuto.

## Technical Context

**Language/Version**: Node 24 LTS + TypeScript 7 (ESM, `strict`)

**Primary Dependencies**: server: Express 5, Drizzle ORM 0.45 + better-sqlite3 (drizzle-kit para
migraciones), `@anthropic-ai/sdk`, nodemailer, imapflow, node-cron. web: React 19, Vite 8, antd 6,
zustand 5, styled-components 6, react-router 8. Auxiliares aprobadas en
[research.md §R-12](./research.md).

**Storage**: SQLite: `data/aldebaran.db` (modo real, sobrescribible con `DATABASE_PATH`) y
`data/aldebaran-mock.db` (modo mock, fija). Montos como enteros en centavos.

**Testing**: Vitest en ambos workspaces; supertest para la API; SQLite en memoria; relojes falsos
(`vi.useFakeTimers` + puerto `Clock`); todas las integraciones externas reemplazadas por mocks.

**Target Platform**: servidor Node en una máquina local o VM Linux/macOS; navegador moderno de
escritorio.

**Project Type**: aplicación web (backend + frontend) con procesos en segundo plano.

**Performance Goals**: p95 < 60 s por email procesado (RNF-01); facturación y recordatorios de 50
clientes en ≤ 20 min sin contar reintentos (RNF-03 a RNF-06).

**Constraints**: solo endpoints de homologación de ARCA; timeouts de 30 s (ARCA, SMTP, IMAP) y 10 s
(dolarhoy.com, LLM); TZ `America/Argentina/Buenos_Aires`; precisión al centavo; sin secretos en el
código; modo mock sin ninguna otra variable de entorno.

**Scale/Scope**: volumen de referencia de 50 clientes, 2 productos por cliente, 10 productos; un
puñado de usuarios; ~15 pantallas; 220 RF y 251 AC.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple el plan | Estado |
|-----------|------------------------|--------|
| I. Test-First | `tasks.md` va a ordenar test → implementación por cada RF/AC. Dominio puro y puertos inyectables permiten testear sin red. Cada test nombra su AC (`it('AC-133: ...')`). AC-109 a AC-111 y AC-232 a AC-234 quedan como scripts manuales en `server/scripts/eval/`. | ✅ |
| II. PRD como fuente de verdad | El diseño no agrega funcionalidad: cada tabla, endpoint y proceso cita los RF/AC que lo motivan (ver data-model y contracts). Las decisiones técnicas no cambian comportamiento. | ✅ |
| III. Ante la duda, un humano | No existe ningún camino de código del agente que escriba el estado `pagada` (lo fuerza el servicio de transición de estados, con test). Las dependencias auxiliares de R-12 fueron aprobadas por un humano. | ✅ |
| IV. Secretos en variables de entorno | Toda credencial se lee en `server/src/config/env.ts`; `.env.example` y `.gitignore` en Setup; gitleaks en el gate de calidad (AC-225); logs sin secretos. | ✅ |
| V. Modos por fases | `server/src/config/mode.ts` resuelve `mock` u `homologacion`; `adapters/index.ts` arma las implementaciones por modo. No hay valor `produccion` ni URLs productivas de ARCA en el código. | ✅ |
| Restricciones adicionales | Stack de AGENTS.md sin cambios estructurales; migraciones nuevas por cambio de schema; validación de pagos solo por email. | ✅ |

**Re-check post-diseño (Phase 1)**: ✅ sin violaciones. El modelo de datos, los contratos y el
quickstart respetan los cinco principios; no hace falta Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-aldebaran-mvp/
├── plan.md              # Este archivo
├── research.md          # Phase 0: decisiones técnicas
├── data-model.md        # Phase 1: tablas, validaciones y transiciones
├── quickstart.md        # Phase 1: guía de validación de punta a punta
├── contracts/
│   ├── http-api.md      # Endpoints REST que consume web/
│   └── adapters.md      # Puertos de servicios externos (real y mock)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
package.json                 # workspaces: server, web; scripts dev, dev:mock, test, db:reset:mock
.env.example
.gitignore                   # .env, data/, certs/, *.crt, *.key, *.pem
data/                        # bases SQLite (no versionadas)

server/
├── drizzle.config.ts
├── drizzle/                 # migraciones generadas por drizzle-kit
├── src/
│   ├── index.ts             # arranque: env → modo → db → adapters → app → scheduler
│   ├── app.ts               # Express: middlewares y routers
│   ├── config/
│   │   ├── env.ts           # lectura y validación de variables de entorno
│   │   └── mode.ts          # resolución del modo y de la ruta de base (RF-184, RF-211 a RF-213)
│   ├── db/
│   │   ├── schema.ts        # tablas Drizzle (ver data-model.md)
│   │   └── client.ts
│   ├── domain/              # lógica pura, sin I/O
│   │   ├── money.ts         # centavos, conversión USD→ARS con redondeo (RF-64, RNF-13)
│   │   ├── cuit.ts          # dígito verificador y normalización (RF-39, RF-122, RF-125)
│   │   ├── billing-dates.ts # período, emisión, servicio, vencimiento (RF-79 a RF-81)
│   │   ├── email-classification.ts  # clasificación del email (RF-123)
│   │   ├── amount-matching.ts       # coincidencias y combinación más antigua (Definiciones)
│   │   ├── payment-rules.ts         # RF-126 a RF-137 → decisión
│   │   ├── invoice-status.ts        # transiciones permitidas; agente nunca → pagada
│   │   └── mock-classifier.ts       # reglas de nombre de archivo (RF-188 a RF-193)
│   ├── adapters/
│   │   ├── index.ts         # arma los adapters según el modo
│   │   ├── clock.ts
│   │   ├── arca/            # wsaa.ts, wsfev1.ts (SOAP homologación), mock.ts
│   │   ├── llm/             # anthropic.ts, mock.ts
│   │   ├── mail/            # smtp-sender.ts, imap-mailbox.ts, mock-mailbox.ts
│   │   └── fx/              # dolarhoy.ts
│   ├── services/            # casos de uso (usuarios, clientes, productos, facturación,
│   │                        # pagos, revisión, recordatorios, errores, reportes, historial)
│   ├── jobs/
│   │   ├── scheduler.ts     # tick por minuto con node-cron
│   │   ├── billing-job.ts
│   │   ├── reminders-job.ts
│   │   ├── mailbox-job.ts
│   │   └── retry-queue.ts   # reintentos persistidos (RF-171)
│   ├── documents/
│   │   ├── invoice-pdf.ts   # RF-93, RF-90, RF-210
│   │   └── email-templates.ts
│   └── http/
│       ├── middleware/      # sesión, perfiles, errores
│       └── routes/          # un router por recurso (ver contracts/http-api.md)
├── scripts/
│   └── eval/                # AC-109 a AC-111 y AC-232 a AC-234 (fuera de la suite)
└── tests/
    ├── unit/                # dominio puro
    ├── integration/         # servicios + db en memoria + adapters mock
    └── api/                 # endpoints con supertest, permisos por perfil

web/
├── index.html
├── vite.config.ts           # proxy /api → server
├── src/
│   ├── main.tsx
│   ├── api/                 # cliente HTTP tipado
│   ├── stores/              # zustand: sesión, tema, modo
│   ├── theme/               # tema claro/oscuro (RNF-15)
│   ├── components/          # layout, header (indicador mock, tema), banners
│   └── pages/               # login, registro inicial, recuperación, dashboard, clientes,
│                            # productos, facturas, revisión, reportes, usuarios,
│                            # configuración, casilla simulada, perfil
└── tests/
```

**Structure Decision**: aplicación web con los dos workspaces que fija `AGENTS.md` (`server/` y
`web/`). Los tipos de la API se definen en `server/src/http/types.ts` y `web/` los importa con un
alias de path de TypeScript, para no agregar un tercer workspace.

## Complexity Tracking

Sin violaciones de la Constitución que justificar.
