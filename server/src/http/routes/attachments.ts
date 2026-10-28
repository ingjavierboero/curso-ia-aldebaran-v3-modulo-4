import { eq } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context.ts';
import { receivedAttachments } from '../../db/schema.ts';
import { sendAttachment } from '../attachment-response.ts';
import { notFound } from '../errors.ts';
import { idParam } from '../validate.ts';

/** Adjuntos de los emails recibidos, para cualquier perfil con sesión (RF-141, RF-217, RNF-16). */
export function attachmentsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/attachments/:id', (req, res) => {
    const id = idParam(req.params.id);
    const attachment = ctx.db.select().from(receivedAttachments).where(eq(receivedAttachments.id, id)).get();
    if (!attachment) throw notFound('El adjunto no existe.');
    sendAttachment(res, attachment);
  });

  return router;
}
