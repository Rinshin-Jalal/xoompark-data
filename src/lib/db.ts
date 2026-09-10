import {
  collection,
  doc,
  CollectionReference,
  DocumentReference,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  UserProfile, Provider, Site, Resource, ResourceHold, ResourceBooking,
  Offering, Operator, Asset, OperatorApiKey, Reservation, ReservationEvent,
  Session, UsageRecord, IdempotencyRecord,
} from './types';

function col<T>(path: string) {
  return collection(db, path) as CollectionReference<T>;
}

export const usersRef = col<UserProfile>('users');
export const providersRef = col<Provider>('providers');
export const sitesRef = col<Site>('sites');
export const resourcesRef = col<Resource>('resources');
export const offeringsRef = col<Offering>('offerings');
export const operatorsRef = col<Operator>('operators');
export const assetsRef = col<Asset>('assets');
export const operatorApiKeysRef = col<OperatorApiKey>('operatorApiKeys');
export const reservationsRef = col<Reservation>('reservations');
export const sessionsRef = col<Session>('sessions');
export const usageRecordsRef = col<UsageRecord>('usageRecords');
export const idempotencyKeysRef = col<IdempotencyRecord>('idempotencyKeys');

export const userDoc = (uid: string): DocumentReference<UserProfile> =>
  doc(db, 'users', uid) as DocumentReference<UserProfile>;

export const providerDoc = (id: string): DocumentReference<Provider> =>
  doc(db, 'providers', id) as DocumentReference<Provider>;

export const siteDoc = (id: string): DocumentReference<Site> =>
  doc(db, 'sites', id) as DocumentReference<Site>;

export const resourceDoc = (id: string): DocumentReference<Resource> =>
  doc(db, 'resources', id) as DocumentReference<Resource>;

export const offeringDoc = (id: string): DocumentReference<Offering> =>
  doc(db, 'offerings', id) as DocumentReference<Offering>;

export const operatorDoc = (id: string): DocumentReference<Operator> =>
  doc(db, 'operators', id) as DocumentReference<Operator>;

export const assetDoc = (id: string): DocumentReference<Asset> =>
  doc(db, 'assets', id) as DocumentReference<Asset>;

export const reservationDoc = (id: string): DocumentReference<Reservation> =>
  doc(db, 'reservations', id) as DocumentReference<Reservation>;

export function resourceHoldsRef(resourceId: string): CollectionReference<ResourceHold> {
  return collection(db, 'resources', resourceId, 'holds') as CollectionReference<ResourceHold>;
}

export function resourceBookingsRef(resourceId: string): CollectionReference<ResourceBooking> {
  return collection(db, 'resources', resourceId, 'bookings') as CollectionReference<ResourceBooking>;
}

export function reservationEventsRef(reservationId: string): CollectionReference<ReservationEvent> {
  return collection(db, 'reservations', reservationId, 'events') as CollectionReference<ReservationEvent>;
}
