import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const randomString = (length: number) =>
  [...randomBytes(length)].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');

export const newId = (prefix: 'MD' | 'CH' | 'EV' | 'WD' | 'WA') =>
  `${prefix}${randomString(14)}`;

export const newToken = () => randomBytes(24).toString('base64url');
