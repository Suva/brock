// Node ids are ULIDs: 48 bits of time and 80 random bits in Crockford's base 32.
// They are unique on every device without asking anyone, which a vault synced
// between devices later will need, and they sort by when they were made.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newId(now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let random = "";
  for (let i = 0; i < 16; i++) random += ALPHABET[bytes[i] % 32];
  return time + random;
}
