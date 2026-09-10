import type { App } from 'firebase-admin/app';

let adminApp: App | null = null;

export function getAdminApp(): App {
  if (typeof window !== 'undefined') {
    throw new Error('firebaseAdmin must only be used on the server');
  }
  if (adminApp) return adminApp;

  const { initializeApp, getApps, cert } = require('firebase-admin/app') as typeof import('firebase-admin/app');

  if (getApps().length) {
    adminApp = getApps()[0];
    return adminApp!;
  }

  const base64 = process.env.FIREBASE_ADMIN_CREDENTIAL_BASE64;
  const legacyJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (base64) {
    const serviceAccount = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    adminApp = initializeApp({ credential: cert(serviceAccount) });
  } else if (legacyJson) {
    adminApp = initializeApp({ credential: cert(JSON.parse(legacyJson)) });
  } else if (
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ) {
    adminApp = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } else {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
      ?? process.env.GCLOUD_PROJECT
      ?? process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) throw new Error('Firebase Admin: no credentials or project ID found. Set FIREBASE_ADMIN_CREDENTIAL_BASE64 or NEXT_PUBLIC_FIREBASE_PROJECT_ID.');
    console.log('[firebaseAdmin] emulator mode — projectId:', projectId);
    adminApp = initializeApp({ projectId });
  }
  return adminApp!;
}

declare global {
  var __firestoreConfigured: boolean | undefined;
  var __defaultFirestoreConfigured: boolean | undefined;
}

/**
 * The aggregated Firestore database — the PRIMARY database for this app.
 * All sourcing, charging, pitstop, fleet feedback, and BD pipeline data.
 */
export function getAdminFirestore() {
  const { getFirestore } = require('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
  const databaseId = process.env.FIRESTORE_AGGREGATED_DATABASE_ID ?? 'aggregated';
  const db = getFirestore(getAdminApp(), databaseId);
  if (!globalThis.__firestoreConfigured) {
    db.settings({ ignoreUndefinedProperties: true });
    globalThis.__firestoreConfigured = true;
  }
  return db;
}

export function getAdminAuth() {
  const { getAuth } = require('firebase-admin/auth') as typeof import('firebase-admin/auth');
  return getAuth(getAdminApp());
}

export function getAdminStorage(bucketName?: string) {
  const { getStorage } = require('firebase-admin/storage') as typeof import('firebase-admin/storage');
  const bucket = bucketName ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucket) throw new Error('Firebase Admin Storage: no storage bucket configured. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.');
  return getStorage(getAdminApp()).bucket(bucketName ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
}

/**
 * The DEFAULT Firestore database (xoompark core platform). Only used for
 * the operatorApiKeys cross-reference in fleet API auth — the core
 * platform's API keys live in the default DB, not the aggregated one.
 */
export function getDefaultFirestore() {
  const { getFirestore } = require('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  if (!globalThis.__defaultFirestoreConfigured) {
    db.settings({ ignoreUndefinedProperties: true });
    globalThis.__defaultFirestoreConfigured = true;
  }
  return db;
}
