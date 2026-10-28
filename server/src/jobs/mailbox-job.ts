import type { AppContext } from '../context.ts';
import { checkMailbox, firstIssueDate, lastCheckStartedAt } from '../services/mailbox-check.ts';
import { getSettings } from '../services/settings.ts';
import type { ScheduledProcess } from './scheduler.ts';

/**
 * Revisión periódica de la casilla que el tick evalúa cada minuto (research R-04): cada N minutos desde
 * el inicio de la revisión anterior (RF-99 a RF-101). El candado del scheduler impide que una revisión
 * empiece mientras sigue la anterior (RF-102). Hasta que haya una factura emitida no se revisa (RF-107).
 */
export function createMailboxJob(ctx: AppContext): ScheduledProcess {
  return {
    name: 'casilla',
    shouldRun(now) {
      if (!firstIssueDate(ctx.db)) return false;
      const last = lastCheckStartedAt(ctx.db);
      if (!last) return true;
      return now.getTime() - last.getTime() >= getSettings(ctx.db).mailboxIntervalMinutes * 60_000;
    },
    run: () => checkMailbox(ctx),
  };
}
