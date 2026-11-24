import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const tokenLifetime = 3600;
const issuer = 'movietrack';
const audience = 'movietrack-api';
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, 64);
  return [salt, key].map(value => value.toString('hex')).join(':');
}

export async function verifyPassword(password, hash) {
  const [salt, key] = hash.split(':').map(value => Buffer.from(value, 'hex'));
  return timingSafeEqual(await deriveKey(password, salt, key.length), key);
}

export function jwt(secret) {
  const signature = value => createHmac('sha256', secret).update(value).digest();
  return {
    issue(user) {
      const iat = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(JSON.stringify({
        iss: issuer,
        aud: audience,
        sub: String(user.userId),
        role: user.role,
        ver: user.authVersion,
        iat,
        exp: iat + tokenLifetime
      })).toString('base64url');
      const content = header + '.' + payload;
      return { token: content + '.' + signature(content).toString('base64url'), expiresIn: tokenLifetime };
    },
    verify(token) {
      const parts = token?.match(/^([\w-]+)\.([\w-]+)\.([\w-]{43})$/);
      if (!parts || parts[1] !== header) return null;
      const expected = signature(parts[1] + '.' + parts[2]);
      const actual = Buffer.from(parts[3], 'base64url');
      if (!timingSafeEqual(actual, expected)) return null;
      try {
        const claims = JSON.parse(Buffer.from(parts[2], 'base64url').toString());
        const now = Math.floor(Date.now() / 1000);
        if (claims?.iss === issuer && claims.aud === audience
          && typeof claims.sub === 'string' && /^[1-9]\d*$/.test(claims.sub)
          && Number.isSafeInteger(Number(claims.sub))
          && Number.isSafeInteger(claims.ver) && claims.ver >= 0
          && Number.isSafeInteger(claims.iat) && claims.iat <= now
          && Number.isSafeInteger(claims.exp) && claims.exp > now
          && claims.exp - claims.iat === tokenLifetime) return claims;
      } catch {
        return null;
      }
      return null;
    }
  };
}
