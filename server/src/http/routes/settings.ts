import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { getSettings, updateSettings } from '../../services/settings.ts';
import { onlyAdmin } from '../middleware/require-role.ts';
import { calendarDate } from '../schemas.ts';
import { ISSUER_IVA_CONDITIONS, type IssuerIvaCondition, type SettingsDto } from '../types.ts';
import { parse } from '../validate.ts';

/** `HH:MM` entre 00:00 y 23:59 (RF-62, RF-152). */
const time = (label: string) =>
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${label} debe tener el formato HH:MM, entre 00:00 y 23:59.`);

const integerBetween = (label: string, min: number, max: number) =>
  z
    .number({ error: `${label} debe ser un número.` })
    .int(`${label} debe ser un número entero.`)
    .min(min, `${label} debe estar entre ${min} y ${max}.`)
    .max(max, `${label} debe estar entre ${min} y ${max}.`);

const text = (label: string) => z.string().trim().min(1, `${label} no puede quedar vacío.`);

/**
 * Valores configurables con los rangos de data-model.md. Todos son opcionales: se guardan solo los que
 * se envían. Si alguno es inválido no se guarda ninguno. Un campo desconocido se rechaza.
 */
const updateSchema = z.strictObject({
  mailboxIntervalMinutes: integerBetween('El intervalo de revisión de la casilla', 5, 60), // RF-100
  billingTime: time('La hora de facturación'), // RF-62
  remindersTime: time('La hora de recordatorios'), // RF-152
  retryCount: integerBetween('La cantidad de reintentos', 0, 10), // RF-172
  retryWaitMinutes: integerBetween('La espera entre reintentos', 1, 60), // RF-173
  pointOfSale: integerBetween('El punto de venta', 1, 99999), // RF-73
  // Datos de la empresa emisora (RF-91); el nombre de fantasía es opcional y se puede quitar.
  issuerBusinessName: text('La razón social'),
  issuerAddress: text('El domicilio comercial'),
  issuerIvaCondition: z.enum(ISSUER_IVA_CONDITIONS, {
    error: `La condición frente al IVA debe ser ${ISSUER_IVA_CONDITIONS.join(', ')}.`,
  }),
  issuerGrossIncomeNumber: text('El número de ingresos brutos'),
  issuerActivityStartDate: calendarDate('La fecha de inicio de actividades no es válida.'),
  issuerTradeName: text('El nombre de fantasía').nullable(),
}).partial();

/** Configuración: todos los perfiles la ven (RF-09, RF-11); solo un Admin la modifica (RF-10, AC-215). */
export function settingsRouter(ctx: AppContext): Router {
  const router = Router();
  // El CUIT del emisor no se configura: sale de ARCA_CUIT (o del valor del modo mock, RF-206).
  // La columna es texto: solo se guardan valores de ISSUER_IVA_CONDITIONS, validados al escribir.
  const toDto = (): SettingsDto => {
    const current = getSettings(ctx.db);
    const issuerIvaCondition = current.issuerIvaCondition as IssuerIvaCondition | null;
    return { ...current, issuerIvaCondition, issuerCuit: ctx.env.arcaCuit };
  };

  router.get('/settings', (_req, res) => {
    res.json(toDto());
  });

  router.put('/settings', onlyAdmin(), (req, res) => {
    updateSettings(ctx.db, parse(updateSchema, req.body));
    res.json(toDto());
  });

  return router;
}
