import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { badRequest, conflict, forbidden, notFound, unavailable, unprocessable } from '../utils/errors.js';

const MB = 1024 * 1024;
/** Upload policy per purpose: who may upload, which file types, how big, which folder. */
export const MEDIA_POLICY = {
  ARTICLE_IMAGE: { folder: 'articles', resourceType: 'image', formats: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 3 * MB, roles: ['ADMIN', 'CONTENT_REVIEWER'] },
  AUDIO: { folder: 'audio', resourceType: 'video', formats: ['mp3', 'm4a', 'wav', 'ogg', 'aac'], maxBytes: 15 * MB, roles: ['ADMIN', 'CONTENT_REVIEWER'] },
  CHANNEL_POST: { folder: 'channel-posts', resourceType: 'image', formats: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 3 * MB, roles: ['ADMIN', 'PROFESSIONAL'] },
  COMMUNITY: { folder: 'community', resourceType: 'image', formats: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 2 * MB, roles: ['USER', 'PROFESSIONAL', 'MODERATOR', 'CONTENT_REVIEWER', 'ADMIN'] },
  ADVERTISEMENT: { folder: 'ads', resourceType: 'image', formats: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 2 * MB, roles: ['ADMIN'] },
};

const configured = () => Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
let ready = false;
function client() {
  if (!configured()) throw unavailable('Media storage is not configured', 'MEDIA_NOT_CONFIGURED');
  if (!ready) {
    cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
    ready = true;
  }
  return cloudinary;
}

const folderFor = (purpose, userId) => `${env.CLOUDINARY_ROOT_FOLDER}/${MEDIA_POLICY[purpose].folder}/${userId}`;

/** Server-signed upload authorisation: the API secret never leaves the backend. */
export function createSignature(user, purpose) {
  const p = MEDIA_POLICY[purpose];
  if (!p.roles.includes(user.role)) throw forbidden(`Your role cannot upload ${purpose} media`);
  const cl = client();
  const folder = folderFor(purpose, user.id);
  const publicId = crypto.randomUUID(); // unguessable
  const params = { allowed_formats: p.formats.join(','), folder, public_id: publicId, timestamp: Math.round(Date.now() / 1000) };
  const signature = cl.utils.api_sign_request(params, env.CLOUDINARY_API_SECRET);
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${p.resourceType}/upload`,
    apiKey: env.CLOUDINARY_API_KEY,
    signature,
    params, // the frontend must send exactly these fields + `file` + `api_key` + `signature`
    fullPublicId: `${folder}/${publicId}`,
    resourceType: p.resourceType,
    maxBytes: p.maxBytes,
    allowedFormats: p.formats,
    expiresInSeconds: 3600,
  };
}

/** After the browser uploaded to Cloudinary, register the asset (verified against Cloudinary's Admin API). */
export async function registerAsset(user, { publicId, purpose }) {
  const p = MEDIA_POLICY[purpose];
  if (!p.roles.includes(user.role)) throw forbidden(`Your role cannot register ${purpose} media`);
  const prefix = `${folderFor(purpose, user.id)}/`;
  if (!publicId.startsWith(prefix)) throw badRequest('publicId does not belong to your upload folder', undefined, 'INVALID_PUBLIC_ID');
  if (await prisma.mediaAsset.findUnique({ where: { publicId }, select: { id: true } })) throw conflict('Asset already registered', 'ALREADY_REGISTERED');

  const cl = client();
  let res;
  try {
    res = await cl.api.resource(publicId, { resource_type: p.resourceType });
  } catch {
    throw unprocessable('Asset not found on the media server. Upload it first.', 'ASSET_NOT_FOUND');
  }
  if (env.MEDIA_VERIFY_UPLOADS && (res.bytes > p.maxBytes || !p.formats.includes(String(res.format).toLowerCase()))) {
    await cl.uploader.destroy(publicId, { resource_type: p.resourceType }).catch(() => {});
    throw unprocessable(`File rejected: allowed ${p.formats.join(', ')} up to ${p.maxBytes / MB} MB`, 'FILE_REJECTED');
  }
  return prisma.mediaAsset.create({
    data: { ownerId: user.id, publicId, secureUrl: res.secure_url, resourceType: p.resourceType, format: res.format, bytes: res.bytes, purpose },
    select: { id: true, secureUrl: true, purpose: true, resourceType: true, format: true, bytes: true, status: true, createdAt: true },
  });
}

export async function deleteAsset(user, id) {
  const m = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!m) throw notFound('Media not found');
  if (m.ownerId !== user.id && user.role !== 'ADMIN') throw forbidden();
  await prisma.mediaAsset.delete({ where: { id } });
  if (configured()) await client().uploader.destroy(m.publicId, { resource_type: m.resourceType, invalidate: true }).catch(() => {});
  return { deleted: true };
}

export const myAssets = (userId) =>
  prisma.mediaAsset.findMany({ where: { ownerId: userId }, orderBy: { id: 'desc' }, take: 50, select: { id: true, secureUrl: true, purpose: true, status: true, createdAt: true } });

/** Ensure referenced media exists and is active (and owned by `ownerId` when given). */
export async function assertUsableMedia(ids, { ownerId, purposes } = {}) {
  const list = ids.filter(Boolean);
  if (!list.length) return;
  const found = await prisma.mediaAsset.findMany({ where: { id: { in: list }, status: 'ACTIVE', ...(ownerId ? { ownerId } : {}), ...(purposes ? { purpose: { in: purposes } } : {}) }, select: { id: true } });
  if (found.length !== new Set(list).size) throw badRequest('One or more media items do not exist, are disabled, or are not yours', undefined, 'INVALID_MEDIA');
}

export const mediaUrl = (m) => (m && m.status === 'ACTIVE' ? m.secureUrl : null);

/** Best-effort removal of an asset from Cloudinary (used by maintenance). */
export const destroyRemote = (publicId, resourceType) => (configured() ? client().uploader.destroy(publicId, { resource_type: resourceType, invalidate: true }).catch(() => {}) : Promise.resolve());
