import { type FirebaseApp, initializeApp, getApps } from "firebase/app";
import { type Auth, getAuth } from "firebase/auth";
import { type Firestore, initializeFirestore } from "firebase/firestore";
import { type FirebaseStorage, getStorage } from "firebase/storage";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

// Your web app's Firebase configuration.
// Firebase web API keys are not secret — access is controlled by Firestore/Storage
// security rules (see firestore.rules) — so committing a working default here is
// safe. Values can still be overridden per-environment via .env.local (VITE_FIREBASE_*)
// without touching this file, e.g. to point a staging build at a different project.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDvcnG_bcSt0ODT-hsbxRjamxSzIlnvvCc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "nurba-6e70d.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "nurba-6e70d",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "nurba-6e70d.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "890276594199",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:890276594199:web:e624cc48aba78720c2d252",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-JWGQFF1TBS",
};

export const isFirebaseConfigured = true;

export const app: FirebaseApp = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);

// long-polling auto-detection avoids issues behind corporate proxies / ad-blockers
export const db: Firestore = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

export const storage: FirebaseStorage = getStorage(app);

// Analytics only works in a real browser context (not SSR, not every environment
// supports it, e.g. Safari private mode) — guard with isSupported().
export let analytics: Analytics | null = null;
if (typeof window !== "undefined") {
  isSupported()
    .then((supported) => {
      if (supported) analytics = getAnalytics(app);
    })
    .catch(() => {
      /* analytics unsupported in this environment — ignore */
    });
}
