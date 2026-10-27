// Firebase setup. The web config is not a secret: access is controlled by the security rules.
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { createData } from './data.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyAKoxu9ZnUCVZjU4GLx-Kr7oFjMcWanUAk',
  authDomain: 'lifecentre-app.firebaseapp.com',
  projectId: 'lifecentre-app',
  storageBucket: 'lifecentre-app.firebasestorage.app',
  messagingSenderId: '290214030230',
  appId: '1:290214030230:web:7559db3c15f027e64a4bb7',
};

// Open the app as http://localhost:PORT/app/?emulator to use the local emulators instead of the real project.
const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emulator');

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
if (useEmulator) connectFirestoreEmulator(db, '127.0.0.1', 8080);

export const data = createData(db);

// Sign-in code is only loaded on the staff page.
export async function getAuthTools() {
  const mod = await import('firebase/auth');
  const auth = mod.getAuth(app);
  if (useEmulator && !auth.emulatorConfig) mod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  return {
    auth,
    onAuthStateChanged: mod.onAuthStateChanged,
    signOut: mod.signOut,
    signInWithGoogle: () => mod.signInWithPopup(auth, new mod.GoogleAuthProvider()),
  };
}
