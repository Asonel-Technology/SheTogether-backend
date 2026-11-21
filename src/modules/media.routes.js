import { z } from 'zod';
import { defineModule } from '../core/route.js';
import { idParams } from '../core/schemas.js';
import * as media from '../services/media.service.js';
import { mediaLimiter } from '../middleware/rateLimit.js';

const purpose = z.enum(['ARTICLE_IMAGE', 'AUDIO', 'CHANNEL_POST', 'COMMUNITY', 'ADVERTISEMENT']);

export default defineModule({
  tag: 'Media',
  description: '🖼️ **Media Uploads** — Server-signed direct-to-Cloudinary uploads. Three-step flow: `POST /media/signature` to get a signed upload URL → upload the file directly from the browser to Cloudinary → `POST /media` to register and verify the asset. Purposes: ARTICLE_IMAGE, AUDIO, CHANNEL_POST, COMMUNITY, ADVERTISEMENT.',
  base: '/media',
  routes: [
    {
      method: 'post', path: '/signature', summary: 'Get a signed upload authorisation', auth: true, limit: mediaLimiter, status: 201,
      description: 'Role-restricted per purpose. The signature fixes the folder, allowed file formats and an unguessable public id.',
      body: z.object({ purpose }).strict(),
      handler: ({ user, body }) => media.createSignature(user, body.purpose),
    },
    {
      method: 'post', path: '/', summary: 'Register an uploaded asset', auth: true, limit: mediaLimiter, status: 201,
      description: 'Verifies the asset exists in your folder and respects size/format limits; rejected files are deleted.',
      body: z.object({ publicId: z.string().min(10).max(250), purpose }).strict(),
      handler: ({ user, body }) => media.registerAsset(user, body),
    },
    { method: 'get', path: '/mine', summary: 'My uploaded assets', auth: true, handler: ({ user }) => media.myAssets(user.id) },
    { method: 'delete', path: '/:id', summary: 'Delete an asset', auth: true, params: idParams, handler: ({ user, params }) => media.deleteAsset(user, params.id) },
  ],
});
