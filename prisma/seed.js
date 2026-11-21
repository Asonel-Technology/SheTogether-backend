// Seeds: first administrator, content categories and the national emergency contacts.
// Run: npm run db:seed   (reads SEED_ADMIN_* from the environment)
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES = [
  ['puberty-and-growing-up', 'Puberty & growing up', 'Changes in your body and feelings during adolescence'],
  ['menstrual-health', 'Menstrual health', 'Periods, cycles and managing menstruation'],
  ['reproductive-health', 'Reproductive health', 'Your reproductive system, pregnancy, contraception and STIs'],
  ['personal-hygiene', 'Personal hygiene', 'Staying clean and healthy'],
  ['consent-and-boundaries', 'Consent & boundaries', 'Understanding consent and respecting boundaries'],
  ['healthy-relationships', 'Healthy relationships', 'Friendship, dating and respect'],
  ['preventing-gbv', 'Preventing gender-based violence', 'Recognising abuse and how to stay safe'],
  ['harmful-practices', 'Harmful practices', 'Child marriage, FGM and other harmful practices'],
  ['getting-support', 'Getting support', 'Where to find help and trusted services'],
];

// National contacts for Rwanda. Re-verify against official sources before launch (numbers can change).
const EMERGENCY = [
  { name: 'Emergency – Rwanda National Police', phone: '112', serviceType: 'EMERGENCY', description: 'Police emergency line' },
  { name: 'Ambulance (SAMU)', phone: '912', serviceType: 'EMERGENCY', description: 'Medical emergencies' },
  { name: 'Rwanda Biomedical Centre health call centre', phone: '114', serviceType: 'HOTLINE', description: 'Free health advice line', isEmergency: true },
  { name: 'Child helpline', phone: '116', serviceType: 'HOTLINE', description: 'Report or ask for help about child abuse', youthFriendly: true },
  { name: 'Gender-based violence hotline (RIB)', phone: '3512', serviceType: 'GBV_SUPPORT', description: 'Report gender-based violence and child abuse', youthFriendly: true },
  { name: 'Isange One Stop Centre', phone: '3029', serviceType: 'GBV_SUPPORT', description: 'Free medical, psychosocial, police and legal support for GBV survivors', youthFriendly: true },
];

async function main() {
  for (const [i, [slug, name, description]] of CATEGORIES.entries()) {
    await prisma.contentCategory.upsert({ where: { slug }, create: { slug, name, description, sortOrder: i }, update: {} });
  }

  for (const s of EMERGENCY) {
    const exists = await prisma.referralService.findFirst({ where: { name: s.name }, select: { id: true } });
    if (!exists) {
      await prisma.referralService.create({
        data: { isEmergency: true, languages: ['en', 'rw', 'fr', 'sw'], verifiedAt: new Date(), ...s, ...(s.isEmergency === undefined ? {} : { isEmergency: s.isEmergency }) },
      });
    }
  }

  const email = (process.env.SEED_ADMIN_EMAIL ?? '').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
    const username = (process.env.SEED_ADMIN_USERNAME ?? 'admin').toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email, username, role: 'ADMIN', ageBand: 'AGE_25_35', preferredLanguage: 'en',
          passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date(),
          termsVersion: process.env.TERMS_VERSION ?? '2026-01', termsAcceptedAt: new Date(),
        },
      });
      console.log(`Admin created: ${email} (change this password after first login)`);
    } else console.log('Admin already exists – left unchanged');
  } else console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set – skipping admin creation');

  console.log('Seed complete');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
