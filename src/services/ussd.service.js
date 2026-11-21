import { prisma } from '../config/db.js';
import { audienceWhere, AGE_BANDS } from '../config/policy.js';
import { emergencyContacts } from './referral.service.js';
import { TtlCache } from '../utils/cache.js';

/**
 * Menu-driven USSD (Africa's Talking style: `text` carries the whole path, e.g. "2*3*1").
 * Stateless, so no phone numbers or sessions are stored. Menus are short (≤182 chars) and only use
 * published articles that have a `ussdSummary`. Arabic is not offered on USSD (handset/script limits).
 */
const LANGS = { 1: 'rw', 2: 'en', 3: 'sw', 4: 'fr' };
const UI = {
  rw: { age: 'Imyaka yawe', topic: 'Hitamo isomo', emergency: 'Ubutabazi bwihuse', none: 'Nta makuru ahari. Hamagara 114.', invalid: 'Ihitamo ritemewe. Ongera ugerageze.' },
  en: { age: 'Your age', topic: 'Choose a topic', emergency: 'Emergency help', none: 'No content yet. Call 114 for health advice.', invalid: 'Invalid choice. Please dial again.' },
  sw: { age: 'Umri wako', topic: 'Chagua mada', emergency: 'Msaada wa dharura', none: 'Hakuna maudhui bado. Piga 114.', invalid: 'Chaguo si sahihi. Jaribu tena.' },
  fr: { age: 'Ton âge', topic: 'Choisis un sujet', emergency: 'Urgence', none: 'Pas de contenu. Appelle le 114.', invalid: 'Choix invalide. Recompose.' },
};
const AGE_LABELS = ['10-12', '13-15', '16-17', '18-24', '25-35'];
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const con = (s) => `CON ${cut(s, 178)}`;
const end = (s) => `END ${cut(s, 178)}`;
const cache = new TtlCache(60_000, 50);

async function topics(lang, band) {
  const key = `${lang}:${band}`;
  let t = cache.get(key);
  if (!t) {
    const rows = await prisma.article.findMany({
      where: { language: lang, publishedVersion: { ...audienceWhere(band), ussdSummary: { not: null } } },
      select: { category: { select: { id: true, slug: true, name: true } } },
      distinct: ['categoryId'],
      orderBy: { categoryId: 'asc' },
      take: 7,
    });
    t = cache.set(key, rows.map((r) => r.category));
  }
  return t;
}
const articlesIn = (lang, band, categoryId) =>
  prisma.article.findMany({
    where: { language: lang, categoryId, publishedVersion: { ...audienceWhere(band), ussdSummary: { not: null } } },
    orderBy: { id: 'desc' },
    take: 5,
    select: { publishedVersion: { select: { title: true, ussdSummary: true } } },
  });

export async function handleUssd(text) {
  const p = text ? text.split('*') : [];
  if (p.length === 0) return con('She Together\n1 Kinyarwanda\n2 English\n3 Kiswahili\n4 Francais');
  const lang = LANGS[p[0]];
  if (!lang) return end('Invalid choice / Ihitamo ritemewe');
  const ui = UI[lang];
  if (p.length === 1) return con(`${ui.age}\n${AGE_LABELS.map((l, i) => `${i + 1} ${l}`).join('\n')}`);

  const band = AGE_BANDS[Number(p[1]) - 1];
  if (!band) return end(ui.invalid);
  const list = await topics(lang, band);
  if (p.length === 2) return con(`${ui.topic}\n${list.map((c, i) => `${i + 1} ${cut(c.name, 20)}`).join('\n')}${list.length ? '\n' : ''}9 ${ui.emergency}`);

  if (p[2] === '9') {
    const contacts = await emergencyContacts();
    return end(contacts.slice(0, 6).map((c) => `${cut(c.name, 14)} ${c.phone}`).join(', '));
  }
  const cat = list[Number(p[2]) - 1];
  if (!cat) return end(ui.invalid);
  const arts = await articlesIn(lang, band, cat.id);
  if (!arts.length) return end(ui.none);
  if (p.length === 3) return con(arts.map((a, i) => `${i + 1} ${cut(a.publishedVersion.title, 24)}`).join('\n'));

  const art = arts[Number(p[3]) - 1];
  if (!art) return end(ui.invalid);
  prisma.analyticsEvent.create({ data: { eventType: 'USSD_VIEW', topic: cat.slug, ageBand: band, language: lang } }).catch(() => {});
  return end(art.publishedVersion.ussdSummary);
}
