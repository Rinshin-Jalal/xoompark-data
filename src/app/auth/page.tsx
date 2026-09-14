'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getIdToken,
  type ConfirmationResult,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { createSessionCookie, ensureUserProfile } from '@/lib/authActions';
import { toast } from 'sonner';
import { Loader2, Mail, Lock, Phone, ArrowLeft } from 'lucide-react';

type AuthMethod = 'email' | 'phone';
type PhoneStep = 'input' | 'verify';

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/';

  const [authMethod, setAuthMethod] = useState<AuthMethod>('email');
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('input');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function finishAuth(user: import('firebase/auth').User) {
    await ensureUserProfile(user.uid, {
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    });
    const idToken = await getIdToken(user, true);
    await createSessionCookie(idToken);
    router.push(from);
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await finishAuth(cred.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      toast.error(msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim());
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await finishAuth(cred.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed';
      toast.error(msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim());
    } finally {
      setLoading(false);
    }
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (!(window as unknown as Record<string, unknown>).recaptchaVerifier) {
        (window as unknown as Record<string, unknown>).recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      }
      const appVerifier = (window as unknown as Record<string, unknown>).recaptchaVerifier as RecaptchaVerifier;
      const result = await signInWithPhoneNumber(auth, phone, appVerifier);
      setConfirmationResult(result);
      setPhoneStep('verify');
      toast.success('OTP sent to your phone');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send OTP';
      toast.error(msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim());
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmationResult) return;
    setLoading(true);
    try {
      const cred = await confirmationResult.confirm(otp);
      await finishAuth(cred.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid OTP';
      toast.error(msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim());
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    'w-full bg-white border border-[#e5e3e3] rounded-lg pl-10 pr-4 py-3 text-sm text-[#171717] placeholder-[#6b6868] focus:outline-none focus:border-[#3b7a57] transition-colors';

  return (
    <div className="w-full min-h-screen bg-[#fdfcfc]">
      <div id="recaptcha-container" />
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-center mb-8">
            <span className="text-2xl font-bold tracking-[-0.05em] text-[#171717]">
              XOOM<span className="font-normal">PARK</span>
            </span>
          </div>

          <div className="bg-white border border-[#e5e3e3] rounded-lg p-6">
            <h1 className="text-lg font-semibold text-[#171717] mb-1">
              Sign in
            </h1>
            <p className="text-sm text-[#6b6868] mb-5">Supply workspace</p>

            <div className="flex gap-1 mb-5">
              <button
                onClick={() => setAuthMethod('email')}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  authMethod === 'email' ? 'bg-[#111] text-white' : 'text-[#6b6868] hover:text-[#171717]'
                }`}
              >
                Email
              </button>
              <button
                onClick={() => { setAuthMethod('phone'); setPhoneStep('input'); }}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  authMethod === 'phone' ? 'bg-[#111] text-white' : 'text-[#6b6868] hover:text-[#171717]'
                }`}
              >
                Phone
              </button>
            </div>

            {authMethod === 'email' && (
              <form onSubmit={handleEmailSubmit} className="space-y-3">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b6868]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    required
                    autoComplete="email"
                    className={inputCls}
                  />
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b6868]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    minLength={6}
                    autoComplete="current-password"
                    className={inputCls}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#111] text-white rounded-md py-2.5 text-sm font-medium hover:bg-[#333] transition-colors disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Sign in'}
                </button>
              </form>
            )}

            {authMethod === 'phone' && phoneStep === 'input' && (
              <form onSubmit={handleSendOtp} className="space-y-3">
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b6868]" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 555 000 0000"
                    required
                    className={inputCls}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#111] text-white rounded-md py-2.5 text-sm font-medium hover:bg-[#333] transition-colors disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Send OTP'}
                </button>
              </form>
            )}

            {authMethod === 'phone' && phoneStep === 'verify' && (
              <form onSubmit={handleVerifyOtp} className="space-y-3">
                <button
                  type="button"
                  onClick={() => setPhoneStep('input')}
                  className="flex items-center gap-1 text-xs text-[#6b6868] hover:text-[#171717]"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b6868]" />
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6-digit code"
                    maxLength={6}
                    required
                    className={inputCls}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#111] text-white rounded-md py-2.5 text-sm font-medium hover:bg-[#333] transition-colors disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Verify OTP'}
                </button>
              </form>
            )}

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-[#e5e3e3]" />
              <span className="text-xs text-[#6b6868]">or</span>
              <div className="flex-1 h-px bg-[#e5e3e3]" />
            </div>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              className="w-full border border-[#e5e3e3] rounded-md py-2.5 text-sm text-[#171717] flex items-center justify-center gap-2 hover:bg-[#fdfcfc] transition-colors disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </button>

            <p className="text-center text-xs text-[#6b6868] mt-4">
              Accounts are created by an admin. Contact your team lead for access.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#fdfcfc]">
        <Loader2 className="w-8 h-8 animate-spin text-[#3b7a57]" />
      </div>
    }>
      <AuthPageContent />
    </Suspense>
  );
}