import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import {
  findMockAttachment,
  listMockEmails,
  loadReceivedEmail,
  MockEmailNotFoundError,
} from '../../services/mock-mailbox.ts';
import { sendAttachment } from '../attachment-response.ts';
import { AppError, notFound } from '../errors.ts';
import { canEdit } from '../middleware/require-role.ts';
import { currentUser } from '../middleware/session.ts';
import { email } from '../schemas.ts';
import { idParam, parse } from '../validate.ts';

/** Cuerpo de la carga de un email recibido (contracts/http-api.md); el tipo declarado no se usa (RNF-16). */
const receivedSchema = z.object({
  from: email,
  subject: z.string().trim().max(500, 'El asunto es demasiado largo.').default(''),
  body: z.string().default(''),
  attachments: z
    .array(
      z.object({
        filename: z.string().trim().min(1, 'Cada adjunto necesita un nombre.').max(255, 'El nombre es muy largo.'),
        mimeType: z.string().optional(),
        contentBase64: z.base64('El contenido del adjunto no es válido.'),
      }),
    )
    .default([]),
});

/** RF-204: fuera del modo mock la casilla simulada no existe. */
function mockOnly(ctx: AppContext): RequestHandler {
  return (_req, _res, next) => {
    next(
      ctx.env.mode === 'mock'
        ? undefined
        : new AppError(403, 'solo_modo_mock', 'La casilla simulada solo está disponible en modo mock.'),
    );
  };
}

/**
 * Casilla simulada del modo mock (RF-194 a RF-204): todos los perfiles la ven según lo que les
 * corresponde; Admin y Editor cargan emails recibidos, que el agente procesa en la siguiente revisión.
 */
export function mockMailboxRouter(ctx: AppContext): Router {
  const router = Router();
  router.use('/mock-mailbox', mockOnly(ctx));

  router.get('/mock-mailbox', (_req, res) => {
    res.json(listMockEmails(ctx.db, currentUser(res).role));
  });

  router.post('/mock-mailbox/received', canEdit(), (req, res) => {
    const input = parse(receivedSchema, req.body);
    const created = loadReceivedEmail(ctx.db, ctx.adapters.clock, {
      from: input.from,
      subject: input.subject,
      body: input.body,
      userId: currentUser(res).id,
      attachments: input.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: new Uint8Array(Buffer.from(attachment.contentBase64, 'base64')),
      })),
    });
    res.status(201).json(created);
  });

  router.get('/mock-mailbox/:id/attachments/:attachmentId', (req, res) => {
    try {
      const attachment = findMockAttachment(
        ctx.db,
        currentUser(res).role,
        idParam(req.params.id),
        idParam(req.params.attachmentId),
      );
      sendAttachment(res, { filename: attachment.filename, content: new Uint8Array(attachment.content) });
    } catch (error) {
      throw error instanceof MockEmailNotFoundError ? notFound(error.message) : error;
    }
  });

  return router;
}
