<!--
Sync Impact Report
- Cambio de versión: (plantilla sin completar) → 1.0.0
- Principios definidos (adopción inicial):
  - [PRINCIPLE_1_NAME] → I. Test-First (NO NEGOCIABLE)
  - [PRINCIPLE_2_NAME] → II. El PRD es la única fuente de verdad
  - [PRINCIPLE_3_NAME] → III. Ante la duda, decide un humano
  - [PRINCIPLE_4_NAME] → IV. Secretos solo en variables de entorno
  - [PRINCIPLE_5_NAME] → V. Modos de ejecución por fases: mock → homologación → producción
- Secciones agregadas:
  - [SECTION_2_NAME] → Restricciones adicionales
  - [SECTION_3_NAME] → Flujo de desarrollo y quality gates
  - Governance (completada)
- Secciones eliminadas: ninguna
- TODOs diferidos: ninguno
-->

# Aldebaran Constitution

## Core Principles

### I. Test-First (NO NEGOCIABLE)

- Todo cambio de comportamiento MUST empezar por un test (Vitest) que lo describa y que falle
  antes de escribir la implementación. Ciclo obligatorio: Red → Green → Refactor.
- Cada requerimiento funcional (RF) y criterio de aceptación (AC) del PRD que se implementa MUST
  tener al menos un test automatizado que lo verifique y que referencie su identificador
  (por ejemplo `AC-122`) en el nombre o la descripción del test.
- Un PR o tarea que agrega código de producción sin el test correspondiente escrito previamente
  MUST NOT considerarse terminado.
- Los tests MUST NOT enviar emails reales ni llamar a ARCA, Gmail ni a la API de Claude: esas
  dependencias se reemplazan con mocks o con las implementaciones del modo mock.
- Única excepción: AC-109 a AC-111 (evaluación del LLM real), que el PRD define como
  verificaciones fuera de la suite automática.

**Rationale**: el sistema decide estados de facturas y cobranzas; escribir el test primero obliga
a fijar el comportamiento esperado del PRD antes de codificarlo y evita regresiones silenciosas.

### II. El PRD es la única fuente de verdad

- `PRD.md` define el alcance completo del producto. Specs, planes, tareas e implementación
  MUST derivarse de sus RF, RNF y AC, y MUST NOT agregar, quitar ni reinterpretar funcionalidad.
- Toda spec y todo plan MUST rastrear cada requerimiento o tarea a uno o más identificadores del
  PRD (RF-xx, RNF-xx, AC-xx).
- Si durante el trabajo se detecta algo que el PRD no cubre, es ambiguo o contradictorio, el
  trabajo sobre ese punto MUST detenerse y aplicarse el Principio III; MUST NOT resolverse con
  supuestos propios.
- Cambiar el alcance requiere primero modificar `PRD.md` con aprobación humana; recién después
  se actualizan specs, planes y código.

**Rationale**: mantener una sola fuente de verdad evita que el producto se desvíe de lo acordado
y permite verificar cada entrega contra criterios de aceptación explícitos.

### III. Ante la duda, decide un humano

- En desarrollo: ante cualquier ambigüedad del PRD, conflicto entre documentos o decisión no
  cubierta por esta constitución, el agente MUST derivar la pregunta a un humano y esperar su
  respuesta antes de continuar con ese punto.
- En ejecución: el agente MUST NOT marcar nunca una factura como "Pagada". Cuando valida un
  comprobante la pasa a "Pago recibido"; si el caso es dudoso, parcial, erróneo o no validable,
  la pasa a "Revisión manual" con el motivo que indica el PRD. Solo un usuario decide si pasa a
  "Pagada" o vuelve a "Pendiente de pago".
- Ante un resultado incierto del LLM o de un proceso automático, el sistema MUST elegir el camino
  que deriva a revisión humana, nunca el que asume éxito.

**Rationale**: los errores en facturación y cobranza tienen impacto económico y fiscal; es
preferible pedir una revisión de más que tomar una decisión equivocada de forma automática.

### IV. Secretos solo en variables de entorno

- Todo secreto (API key de Anthropic, credenciales de Gmail, CUIT/certificado/clave de ARCA y
  cualquier otro futuro) MUST leerse de variables de entorno. MUST NOT quedar hardcodeado en el
  código, en tests, en fixtures, en logs ni en el repositorio.
- `.env` MUST NOT versionarse; `.env.example` MUST listar todas las variables con valores de
  ejemplo no sensibles y mantenerse actualizado con cada variable nueva.
- Certificados y claves de ARCA (`certs/`, `*.crt`, `*.key`, `*.pem`) MUST NOT versionarse; se
  referencian con `ARCA_CERT_PATH` y `ARCA_KEY_PATH`.
- Los logs y mensajes de error MUST NOT incluir valores de secretos.

**Rationale**: el repositorio se comparte (curso, evaluadores); un secreto filtrado compromete la
casilla, la cuenta de Anthropic o la identidad fiscal ante ARCA.

### V. Modos de ejecución por fases: mock → homologación → producción

El sistema MUST soportar tres modos, que se habilitan en este orden para probar cada fase:

1. **Mock** (`MOCK_MODE=true`): simula ARCA, el LLM y el email según RF-184 a RF-213; arranca
   sin ninguna otra variable y usa siempre su propia base `data/aldebaran-mock.db`. MUST permitir
   recorrer el circuito completo de punta a punta sin credenciales.
2. **Homologación** (modo real del MVP): servicios reales de Gmail y Claude, y ARCA solo en su
   ambiente de homologación. Los PDFs y emails MUST indicar que el comprobante no tiene validez
   fiscal (RF-90).
3. **Producción**: facturación real contra los endpoints productivos de ARCA. Es una fase
   posterior al MVP: MUST NOT implementarse ni habilitarse hasta que el PRD se modifique para
   incluirla (Principio II) con aprobación humana explícita. Hasta entonces, el código MUST NOT
   apuntar nunca a endpoints productivos de ARCA.

- El modo activo MUST resolverse en un único lugar a partir de variables de entorno, y cada
  integración externa (ARCA, LLM, SMTP, IMAP) MUST exponer una interfaz común con una
  implementación por modo, de modo que pasar de una fase a otra no requiera cambiar la lógica de
  negocio.
- Los datos de un modo MUST NOT mezclarse con los de otro (RF-211 a RF-213).

**Rationale**: separar fases permite validar el flujo completo sin riesgo (mock), luego contra
servicios reales sin efecto fiscal (homologación) y solo al final emitir comprobantes reales.

## Restricciones adicionales

- Stack fijado en `AGENTS.md` (Node 24 + TypeScript, Express 5, SQLite con Drizzle, React 19 +
  Vite, antd, Vitest, `@anthropic-ai/sdk`, nodemailer, imapflow, node-cron). Cambiar o agregar
  dependencias estructurales requiere aprobación humana.
- La validación de pagos MUST basarse únicamente en el email del cliente: no se consultan ni se
  integran sistemas bancarios.
- Las migraciones ya aplicadas MUST NOT editarse: todo cambio de schema genera una migración nueva.
- Los procesos automáticos (node-cron) usan la zona horaria `America/Argentina/Buenos_Aires` y
  solo corren con `SCHEDULER_ENABLED=true` (salvo el default del modo mock definido en RF-207).

## Flujo de desarrollo y quality gates

- Flujo Spec Kit: `/speckit-specify` → `/speckit-clarify` (cuando haya dudas) → `/speckit-plan`
  → `/speckit-tasks` → `/speckit-implement`. Las preguntas de clarificación que el PRD no
  responda MUST derivarse a un humano.
- Todo plan MUST incluir un "Constitution Check" que verifique los cinco principios antes de
  diseñar y de nuevo después del diseño.
- En `tasks.md`, la tarea de test de cada historia o requerimiento MUST aparecer antes que su
  tarea de implementación.
- Gates para dar un cambio por terminado:
  - `npm run test` pasa completo.
  - Cada RF/AC tocado tiene su test referenciado.
  - El circuito afectado funciona en modo mock (`npm run dev:mock`).
  - No hay secretos en el diff ni referencias a endpoints productivos de ARCA.
- La revisión humana es obligatoria antes de integrar cambios a `main`.

## Governance

- Esta constitución prevalece sobre cualquier otra práctica o convención del proyecto. En caso de
  conflicto con `AGENTS.md`, se aplica la regla más restrictiva y se deriva a un humano para
  alinear ambos documentos.
- Enmiendas: se proponen por escrito con su motivo, requieren aprobación humana explícita y,
  cuando afectan specs, planes o código existentes, un plan de migración.
- Versionado semántico:
  - MAJOR: eliminación o redefinición incompatible de un principio o regla de gobierno.
  - MINOR: principio o sección nueva, o ampliación material de una regla.
  - PATCH: aclaraciones, redacción o correcciones sin cambio semántico.
- Cumplimiento: cada spec, plan, revisión de código y PR MUST verificar la conformidad con estos
  principios; toda excepción MUST justificarse por escrito y aprobarse por un humano.
- La guía operativa del día a día está en `AGENTS.md` y la especificación del producto en `PRD.md`.

**Version**: 1.0.0 | **Ratified**: 2026-10-19 | **Last Amended**: 2026-10-19
