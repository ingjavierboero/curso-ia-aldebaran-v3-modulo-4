/**
 * CSV para descargar los reportes (RF-167): separado por `;` y con coma decimal, como lo abre Excel en
 * español; con BOM UTF-8 para que respete los acentos y con fin de línea CRLF (RFC 4180).
 */

/** Un valor entre comillas si tiene el separador, comillas o saltos de línea; las comillas se duplican. */
function cell(value: string | number): string {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Arma el CSV con la fila de encabezados y una fila por cada registro. */
export function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  return `﻿${[header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`;
}

/** Centavos como importe en pesos con coma decimal y sin separador de miles: 2200000 → "22000,00". */
export const csvMoney = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
