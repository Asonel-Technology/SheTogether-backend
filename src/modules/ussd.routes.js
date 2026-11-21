import express from 'express';
import { z } from 'zod';
import { defineModule } from '../core/route.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { safeEqual } from '../utils/helpers.js';
import { handleUssd } from '../services/ussd.service.js';

export default defineModule({
  tag: 'USSD Integration',
  description: '📱 **USSD Integration** — Africa\'s Talking provider webhook for feature-phone access. Disabled unless `USSD_ENABLED=true` in the environment. Authenticated via a shared secret (`x-ussd-secret` header or `?secret=` query param). Responds in `text/plain` with `CON …` (continue session) or `END …` (close session).',
  base: '/integrations/ussd',
  routes: [
    {
      method: 'post', path: '/webhook', summary: 'USSD session webhook', auth: false,
      contentType: 'application/x-www-form-urlencoded',
      use: [express.urlencoded({ extended: false, limit: '4kb' })],
      query: z.object({ secret: z.string().max(200).optional() }),
      body: z.looseObject({ sessionId: z.string().max(100).optional(), serviceCode: z.string().max(30).optional(), phoneNumber: z.string().max(30).optional().describe('Never stored'), text: z.string().max(100).regex(/^[0-9*]*$/).default('') }),
      example: { sessionId: 'abc123', serviceCode: '*123#', phoneNumber: '+250788000000', text: '2*3' },
      handler: async ({ req, res, query, body }) => {
        if (!env.USSD_ENABLED) throw new ApiError(503, 'USSD_DISABLED', 'USSD integration is disabled');
        const given = req.get('x-ussd-secret') ?? query.secret ?? '';
        if (!safeEqual(given, env.USSD_WEBHOOK_SECRET)) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid webhook secret');
        res.type('text/plain').status(200).send(await handleUssd(body.text));
      },
    },
  ],
});
