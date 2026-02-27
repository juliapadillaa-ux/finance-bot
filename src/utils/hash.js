import crypto from 'crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function movementHash({ user, dateISO, amount, concept }) {
  const base = `${user}|${dateISO}|${amount}|${(concept || '').trim().toLowerCase()}`;
  return sha256(base);
}
