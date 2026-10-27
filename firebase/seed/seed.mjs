// Sample data, shared by the emulator seed script and the rules tests.
import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase/firestore';

const TIMESTAMP_FIELDS = ['publishedAt', 'expiresAt', 'start', 'end'];

// Returns [[collection, id, data], ...] with ISO strings turned into Timestamps.
// `updatedBy` is set to the email that writes the data, as the security rules require.
export function seedDocs(updatedBy) {
  const seed = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8'));
  return Object.entries(seed).flatMap(([col, docs]) =>
    Object.entries(docs).map(([id, data]) => {
      const out = { ...data, updatedBy };
      for (const key of TIMESTAMP_FIELDS) if (typeof out[key] === 'string') out[key] = Timestamp.fromDate(new Date(out[key]));
      return [col, id, out];
    }));
}
