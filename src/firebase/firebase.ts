import { type FirebaseApp, initializeApp, getApps } from "firebase/app";
import {
  type Auth,
  getAuth,
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
} from "firebase/auth";
import { type Firestore, initializeFirestore } from "firebase/firestore";
import { type FirebaseStorage, getStorage } from "firebase/storage";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

/**
 * Google OAuth authorized redirect is
 * https://nurba-6e70d.firebaseapp.com/__/auth/handler (Firebase default).
 * Do NOT derive authDomain from window.location (e.g. nurba-6e70d.web.app):
 * that sends redirect_uri=https://nurba-6e70d.web.app/__/auth/handler and
 * Google returns Error 400 redirect_uri_mismatch («Доступ заблокирован»).
 *
 * To use *.web.app as authDomain instead, add
 * https://nurba-6e70d.web.app/__/auth/handler as an Authorized redirect URI
 * in Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client.
 * That cannot be done from this repo.
 */
const configuredAuthDomain =
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "nurba-6e70d.firebaseapp.com";
// Never compile *.web.app as authDomain: Google only authorizes
// https://nurba-6e70d.firebaseapp.com/__/auth/handler
const authDomain = String(configuredAuthDomain).replace(/\.web\.app$/i, ".firebaseapp.com");

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDvcnG_bcSt0ODT-hsbxRjamxSzIlnvvCc",
  authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "nurba-6e70d",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "nurba-6e70d.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "890276594199",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:890276594199:web:e624cc48aba78720c2d252",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-JWGQFF1TBS",
};

export const isFirebaseConfigured = true;

export const app: FirebaseApp = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);

function createAuth(firebaseApp: FirebaseApp): Auth {
  try {
    return initializeAuth(firebaseApp, {
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    const existing = getAuth(firebaseApp);
    void existing.setPersistence(browserLocalPersistence);
    return existing;
  }
}

export const auth: Auth = createAuth(app);

export const db: Firestore = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

export const storage: FirebaseStorage = getStorage(app);

export let analytics: Analytics | null = null;
if (typeof window !== "undefined") {
  isSupported()
    .then((supported) => {
      if (supported) analytics = getAnalytics(app);
    })
    .catch(() => {
      /* analytics unsupported */
    });
}
