/** Public shape of a user – never includes password hash, lockout counters or token versions. */
export const toUserDto = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email ?? null,
  phone: u.phone ?? null,
  emailVerified: Boolean(u.emailVerifiedAt),
  phoneVerified: Boolean(u.phoneVerifiedAt),
  ageBand: u.ageBand,
  preferredLanguage: u.preferredLanguage,
  role: u.role,
  status: u.status,
  createdAt: u.createdAt,
});
