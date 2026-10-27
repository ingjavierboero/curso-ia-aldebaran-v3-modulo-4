/** Formatos de los datos en pantalla (plan.md, Diseño de la interfaz). */

/** CUIT con guiones: `20111111112` → `20-11111111-2`. Un valor que no tiene 11 dígitos queda igual. */
export function formatCuit(cuit: string): string {
  return /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
}
