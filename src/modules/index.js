import express from 'express';
import auth from './auth.routes.js';
import users from './users.routes.js';
import content from './content.routes.js';
import chat from './chat.routes.js';
import { referrals, adminReferrals } from './referrals.routes.js';
import { channelsModule, professionalModule, adminChannelsModule } from './channels.routes.js';
import { communityModule, reactionsModule, moderationModule } from './community.routes.js';
import media from './media.routes.js';
import { analytics_, adminAnalytics } from './analytics.routes.js';
import { publicAds, adminAds } from './ads.routes.js';
import ussd from './ussd.routes.js';
import { categories, articles } from './admin.content.routes.js';
import knowledge from './admin.knowledge.routes.js';
import { adminModule } from './admin.routes.js';

const modules = [
  auth, users, content, chat, referrals, channelsModule, professionalModule, communityModule, reactionsModule,
  moderationModule, media, analytics_, publicAds, ussd,
  categories, articles, knowledge, adminReferrals, adminChannelsModule, adminAds, adminAnalytics, adminModule,
];

export function apiRouter() {
  const r = express.Router();
  for (const m of modules) r.use(m.base || '/', m.router);
  return r;
}
