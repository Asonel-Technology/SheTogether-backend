import { z } from 'zod';
import { defineModule } from '../core/route.js';
import { language, uuid } from '../core/schemas.js';
import * as chat from '../services/chat.service.js';
import { chatLimiter } from '../middleware/rateLimit.js';

export default defineModule({
  tag: 'Chatbot',
  description: '🤖 **SRHR Chatbot** — AI assistant powered by RAG over published, reviewed knowledge only. Urgent safety signals are answered with escalation guidance and never forwarded to the AI model. Raw questions are not logged unless `CHAT_RETAIN_MESSAGES=true`. Responses include `safetyLevel` (NONE | SENSITIVE | URGENT) and `referrals` when relevant.',
  base: '/chat',
  routes: [
    {
      method: 'post', path: '/', summary: 'Ask the chatbot', auth: true, limit: chatLimiter,
      description: 'Returns `answer`, `sources`, `safetyLevel` (NONE | SENSITIVE | URGENT), `professionalSupportRecommended`, `referrals` and a `disclaimer` to display. `answered:false` means there was not enough reviewed information.',
      body: z.object({
        question: z.string().trim().min(2).max(1000).meta({ example: 'What is a normal menstrual cycle length?' }),
        sessionId: uuid.optional().describe('Omit to start a new chat session'),
        language: language.optional().describe("Defaults to the user's preferred language"),
        history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(1000) })).max(6).optional().describe('Optional recent turns for follow-up questions (kept client-side)'),
      }).strict(),
      example: { question: 'What is a normal menstrual cycle length?' },
      handler: ({ user, body }) => chat.chat(user, body),
    },
    {
      method: 'post', path: '/feedback', summary: 'Rate an answer (aggregate analytics only)', auth: true,
      body: z.object({ sessionId: uuid.optional(), rating: z.enum(['HELPFUL', 'NOT_HELPFUL']), reason: z.enum(['INACCURATE', 'NOT_RELEVANT', 'UNSAFE', 'UNCLEAR', 'OTHER']).optional() }).strict(),
      handler: ({ user, body }) => chat.submitFeedback(user, body),
    },
    { method: 'get', path: '/sessions/:id/messages', summary: 'Get retained messages of a session (empty unless retention is enabled)', auth: true, params: z.object({ id: uuid }), handler: ({ user, params }) => chat.sessionMessages(user, params.id) },
    { method: 'delete', path: '/sessions/:id', summary: 'Clear a chat session and its stored messages', auth: true, params: z.object({ id: uuid }), handler: ({ user, params }) => chat.deleteSession(user, params.id) },
  ],
});
