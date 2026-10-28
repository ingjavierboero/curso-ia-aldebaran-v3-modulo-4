# Set de evaluación del LLM (RNF-14)

`npm run eval:llm -w server` clasifica con el LLM real los adjuntos de esta carpeta y reporta los
aciertos por clase (AC-109 a AC-111). Los archivos **no se versionan**: suelen tener datos reales de
clientes (CUIT, montos, cuentas). Solo este README está en el repo.

## Estructura

```
fixtures/
  si/       comprobantes legibles de pagos en pesos, con CUIT, fecha y monto (AC-109)
  no/       adjuntos que no son comprobantes: facturas, fotos, documentos (AC-110)
  dudoso/   ilegibles o que no permiten saber si es un pago; pagos en otra moneda (AC-111)
```

- Al menos **20 adjuntos por clase**, en PDF, JPEG, PNG, GIF o WebP. El tipo se toma de la firma del
  archivo, como en el sistema: lo demás se descarta con un aviso.
- El nombre del archivo no importa: se envía al LLM como `adjunto.<extensión>` para no delatar la clase.
- Opcional: `<archivo>.json` junto al adjunto, con el cuerpo del email y, en los comprobantes, el CUIT
  del ordenante y el monto esperados, para medir también la extracción:

  ```json
  { "cuerpo": "Adjunto el comprobante de octubre.", "cuit": "30711111111", "monto": "15000.50" }
  ```

## Resultado

Cumple RNF-14 si cada clase acierta al menos el 95 % y ningún comprobante de `si/` se clasifica como
"no". El detalle queda en `scripts/eval/reports/` (tampoco se versiona). Cada adjunto es una llamada
paga a la API de Anthropic.
