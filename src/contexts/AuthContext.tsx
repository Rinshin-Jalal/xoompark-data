'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import { auth } from '@/lib/firebase';
import { userDoc } from '@/lib/db';
import type { UserProfile } from '@/lib/types';

interface AuthContextValue {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  userProfile: null,
  loading: true,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // version guards against stale async callbacks if onAuthStateChanged fires
    // multiple times before the previous getIdToken promise resolves.
    let version = 0;
    let profileUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, (firebaseUser) => {
      version += 1;
      const myVersion = version;

      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }
      setUser(firebaseUser);

      if (!firebaseUser) {
        setUserProfile(null);
        setLoading(false);
        return;
      }

      // Force-refresh so Firestore rules always evaluate against current claims,
      // not a cached token that may predate a claims update.
      firebaseUser.getIdToken(true)
        .then(() => {
          if (myVersion !== version) return;
          profileUnsub = onSnapshot(
            userDoc(firebaseUser.uid),
            (snap) => {
              setUserProfile(snap.exists() ? ({ ...snap.data(), uid: snap.id } as UserProfile) : null);
              setLoading(false);
            },
            (err) => {
              console.error('[auth] userDoc snapshot error:', err.message);
              setLoading(false);
            },
          );
        })
        .catch((err) => {
          console.error('[auth] token refresh failed:', err.message);
          if (myVersion === version) setLoading(false);
        });
    });

    return () => {
      version = Infinity; // abandon any in-flight token refresh from this effect instance
      authUnsub();
      if (profileUnsub) profileUnsub();
    };
  }, []);

  const isAdmin = user?.email?.endsWith('@xoompark.co') ?? false;

  return (
    <AuthContext.Provider value={{ user, userProfile, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
