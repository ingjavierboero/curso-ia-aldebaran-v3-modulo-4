import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import { reminderRuns, sentEmails } from '../db/schema.ts';
import { currentPeriod, isAtOrAfterTime, isLastDayOfMonth } from '../domain/billing-dates.ts';
import { clientsToRemind, ReminderBlockedError, sendReminder } from '../services/reminders.ts';
import { getSettings } from '../services/settings.ts';
import type { ScheduledProcess } from './scheduler.ts';

/** Corrida de recordatorios del mes, si ya empezó. */
const runOf = (ctx: AppContext, month: string) =>
  ctx.db.select().from(reminderRuns).where(eq(reminderRuns.month, month)).get();

/** Clientes que ya recibieron el recordatorio automático de esa corrida (RF-149). */
function alreadyReminded(ctx: AppContext, month: string): Set<number> {
  const rows = ctx.db
    .select({ clientId: sentEmails.clientId })
    .from(sentEmails)
    .where(
      and(
        eq(sentEmails.kind, 'recordatorio'),
        eq(sentEmails.trigger, 'automatico'),
        eq(sentEmails.reminderMonth, month),
      ),
    )
    .all();
  return new Set(rows.flatMap((row) => (row.clientId === null ? [] : [row.clientId])));
}

/**
 * Recordatorios de fin de mes que el tick evalúa cada minuto (research R-04, RF-149): el último día del
 * mes, desde la hora de recordatorios de Argentina, una vez por mes. Una corrida interrumpida se retoma
 * ese mismo día solo para los clientes que faltan; al día siguiente ya no es el último día y no corre.
 */
export function createRemindersJob(ctx: AppContext): ScheduledProcess {
  return {
    name: 'recordatorios',
    shouldRun(now) {
      if (!isLastDayOfMonth(now) || !isAtOrAfterTime(now, getSettings(ctx.db).remindersTime)) return false;
      const run = runOf(ctx, currentPeriod(now));
      return !run || run.finishedAt === null;
    },
    async run(now) {
      const month = currentPeriod(now);
      ctx.db.insert(reminderRuns).values({ month, startedAt: now.toISOString() }).onConflictDoNothing().run();

      const reminded = alreadyReminded(ctx, month);
      for (const client of clientsToRemind(ctx.db)) {
        if (reminded.has(client.id)) continue;
        try {
          await sendReminder(ctx, { clientId: client.id, trigger: 'automatico', reminderMonth: month });
        } catch (error) {
          // El cliente pudo cambiar durante la corrida; un envío fallido no frena a los demás (sus
          // reintentos llegan con US7).
          if (!(error instanceof ReminderBlockedError)) {
            console.error(`No se pudo enviar un recordatorio: ${error instanceof Error ? error.name : typeof error}`);
          }
        }
      }

      ctx.db.update(reminderRuns)
        .set({ finishedAt: ctx.adapters.clock.now().toISOString() })
        .where(eq(reminderRuns.month, month))
        .run();
    },
  };
}
