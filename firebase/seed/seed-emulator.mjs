// Loads the sample data into the LOCAL emulator only. Start it first with: npm run emulators
// Also adds a demo admin so the staff page can be tried with a fake Google account in the Auth emulator.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { seedDocs } from './seed.mjs';

const DEMO_ADMIN = 'demo-admin@example.com';

const env = await initializeTestEnvironment({ projectId: 'lifecentre-app', firestore: { host: '127.0.0.1', port: 8080 } });
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'staff', DEMO_ADMIN), { role: 'admin', name: 'Demo admin (sample)', updatedBy: DEMO_ADMIN });
  for (const [col, id, data] of seedDocs('sample-data')) await setDoc(doc(db, col, id), data);
});
await env.cleanup();
console.log('Sample data loaded into the emulator. Demo admin:', DEMO_ADMIN);
