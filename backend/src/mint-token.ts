/**
 * Mint an HS256 test token signed with JWT_SECRET, for calling the API before
 * the app's real sign-in exists.
 *
 *   npm run token -- <subject> [display name] [ttl, default 7d]
 */
import { SignJWT } from 'jose';

const [subject, name, ttl = '7d'] = process.argv.slice(2);
const secret = process.env.JWT_SECRET;
if (!subject || !secret) {
  console.error('usage: JWT_SECRET=... npm run token -- <subject> [display name] [ttl]');
  process.exit(1);
}
const token = await new SignJWT(name ? { name } : {})
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(subject)
  .setIssuedAt()
  .setExpirationTime(ttl)
  .sign(new TextEncoder().encode(secret));
console.log(token);
