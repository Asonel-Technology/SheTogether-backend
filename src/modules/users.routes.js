import { z } from 'zod';
import { defineModule, page } from '../core/route.js';
import { ageInput, ageInputMessage, hasAgeInput, language, pageQuery, uuid } from '../core/schemas.js';
import * as users from '../services/user.service.js';
import * as auth from '../services/auth.service.js';
import * as content from '../services/content.service.js';
import { passwordSchema, usernameSchema } from './auth.routes.js';

const userIdParams = z.object({ userId: uuid });

export default defineModule({
  tag: 'Users',
  description: '👤 **User Profile** — Read and update your own profile, change your age band, set accessibility preferences (font scale, high contrast, TTS, low-data mode), change your password, manage your saved articles, block/unblock other users, and request account deletion.',
  base: '/users',
  routes: [
    { method: 'get', path: '/me', summary: 'Get my profile', auth: true, handler: ({ user }) => users.getMe(user.id) },
    {
      method: 'patch', path: '/me', summary: 'Update username or preferred language', auth: true,
      body: z.object({ username: usernameSchema.optional(), preferredLanguage: language.optional() }).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }),
      handler: ({ user, body }) => users.updateMe(user.id, body),
    },
    {
      method: 'patch', path: '/me/age', summary: 'Update my age group', auth: true,
      description: 'The band can only stay the same or move to an older band.',
      body: z.object(ageInput).strict().refine(hasAgeInput, ageInputMessage),
      handler: ({ user, body }) => users.updateAge(user, body),
    },
    { method: 'get', path: '/me/preferences', summary: 'Get accessibility & low-data preferences', auth: true, handler: ({ user }) => users.getPreferences(user.id) },
    {
      method: 'put', path: '/me/preferences', summary: 'Set accessibility & low-data preferences', auth: true,
      body: z.object({
        fontScale: z.number().int().min(80).max(200).optional().describe('Percent, 100 = default'),
        highContrast: z.boolean().optional(),
        reduceMotion: z.boolean().optional(),
        ttsEnabled: z.boolean().optional(),
        lowDataMode: z.boolean().optional(),
        screenReaderOptimized: z.boolean().optional(),
      }).strict(),
      handler: ({ user, body }) => users.setPreferences(user.id, body),
    },
    {
      method: 'post', path: '/me/password', summary: 'Change my password', auth: true,
      description: 'Logs out all other devices and returns fresh tokens for this one.',
      body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict(),
      handler: ({ user, body }) => auth.changePassword(user.id, body),
    },
    {
      method: 'post', path: '/me/deletion-request', summary: 'Request account deletion', auth: true,
      description: 'Starts the grace period. The account and personal data are purged by the maintenance job afterwards.',
      body: z.object({ password: z.string().min(1).max(128) }).strict(),
      handler: ({ user, body }) => users.requestDeletion(user.id, body.password),
    },
    { method: 'delete', path: '/me/deletion-request', summary: 'Cancel a pending deletion request', auth: true, handler: ({ user }) => users.cancelDeletion(user.id) },
    { method: 'get', path: '/me/blocks', summary: 'List users I blocked', auth: true, handler: ({ user }) => users.listBlocks(user.id) },
    { method: 'put', path: '/me/blocks/:userId', summary: 'Block a user', auth: true, params: userIdParams, handler: ({ user, params }) => users.blockUser(user.id, params.userId) },
    { method: 'delete', path: '/me/blocks/:userId', summary: 'Unblock a user', auth: true, params: userIdParams, handler: ({ user, params }) => users.unblockUser(user.id, params.userId) },
    {
      method: 'get', path: '/me/saved', summary: 'List my saved articles', auth: true, query: pageQuery,
      handler: async ({ user, query }) => {
        const { items, meta } = await content.listSaved(user, query);
        return page(items, meta);
      },
    },
  ],
});
