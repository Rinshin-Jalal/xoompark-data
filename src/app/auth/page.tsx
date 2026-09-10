'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, easeOut } from 'framer-motion';
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
import { Loader2, Mail, Lock, Phone, MoveRight, ArrowLeft } from 'lucide-react';

type Mode = 'signin' | 'signup';
type AuthMethod = 'email' | 'phone';
type PhoneStep = 'input' | 'verify';

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/dashboard';

  const [mode, setMode] = useState<Mode>('signin');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('email');
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('input');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.8, staggerChildren: 0.1 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOut } },
  };
  const buttonVariants = {
    hover: { scale: 1.02, transition: { duration: 0.2 } },
    tap: { scale: 0.98 },
  };

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
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) await updateProfile(cred.user, { displayName });
        await finishAuth(cred.user);
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await finishAuth(cred.user);
      }
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

  return (
    <div className="w-full min-h-screen bg-[#f6f8fa]">
      <div id="recaptcha-container" />
      <div className="relative min-h-screen z-10 flex items-center justify-center p-4">
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="w-full max-w-md">
          <motion.div
            variants={itemVariants}
            className="bg-white border border-[#e2e8ec] rounded-3xl p-8 shadow-2xl"
          >
            <motion.div variants={itemVariants} className="text-center mb-8">
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="logo-mark">
                  x<span>p</span>
                </span>
                <span className="text-2xl font-bold tracking-[-1.1px] text-[#21313c]">
                  xoompark<span className="text-[#caf28a]">.</span>
                </span>
              </div>
              <h1 className="text-3xl font-light text-[#21313c] mb-2">
                {mode === 'signin' ? 'Welcome back' : 'Create your account'}
              </h1>
              <p className="text-[#8b969e] text-sm">
                {mode === 'signin' ? 'Sign in to your supply workspace' : 'Join the XoomPark supply workspace'}
              </p>
            </motion.div>

            <motion.div variants={itemVariants} className="flex gap-2 mb-6">
              <button
                onClick={() => setAuthMethod('email')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-medium transition-colors ${
                  authMethod === 'email' ? 'bg-[#167456] text-white' : 'bg-[#f6f8fa] text-[#8b969e] hover:text-[#21313c]'
                }`}
              >
                <Mail className="h-4 w-4" /> Email
              </button>
              <button
                onClick={() => { setAuthMethod('phone'); setPhoneStep('input'); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-medium transition-colors ${
                  authMethod === 'phone' ? 'bg-[#167456] text-white' : 'bg-[#f6f8fa] text-[#8b969e] hover:text-[#21313c]'
                }`}
              >
                <Phone className="h-4 w-4" /> Phone
              </button>
            </motion.div>

            {authMethod === 'email' && (
              <motion.form variants={itemVariants} onSubmit={handleEmailSubmit} className="space-y-4 mb-6">
                {mode === 'signup' && (
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b969e]" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Full name"
                      className="w-full bg-[#f6f8fa] border border-[#e4e9ee] rounded-full pl-11 pr-6 py-4 text-[#21313c] placeholder-[#a0aab1] focus:outline-none focus:border-[#167456] transition-colors"
                    />
                  </div>
                )}
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b969e]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Please enter your email"
                    required
                    autoComplete="email"
                    className="w-full bg-[#f6f8fa] border border-[#e4e9ee] rounded-full pl-11 pr-6 py-4 text-[#21313c] placeholder-[#a0aab1] focus:outline-none focus:border-[#167456] transition-colors"
                  />
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b969e]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    required
                    minLength={6}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    className="w-full bg-[#f6f8fa] border border-[#e4e9ee] rounded-full pl-11 pr-6 py-4 text-[#21313c] placeholder-[#a0aab1] focus:outline-none focus:border-[#167456] transition-colors"
                  />
                </div>
                <motion.button
                  type="submit"
                  variants={buttonVariants}
                  whileHover="hover"
                  whileTap="tap"
                  disabled={loading}
                  className="w-full bg-[#167456] text-white rounded-full px-6 py-4 flex items-center justify-center gap-2 hover:bg-[#105c42] transition-colors disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{mode === 'signin' ? 'Sign in' : 'Create account'} <MoveRight className="w-4 h-4" /></>}
                </motion.button>
              </motion.form>
            )}

            {authMethod === 'phone' && phoneStep === 'input' && (
              <motion.form variants={itemVariants} onSubmit={handleSendOtp} className="space-y-4 mb-6">
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b969e]" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 555 000 0000"
                    required
                    className="w-full bg-[#f6f8fa] border border-[#e4e9ee] rounded-full pl-11 pr-6 py-4 text-[#21313c] placeholder-[#a0aab1] focus:outline-none focus:border-[#167456] transition-colors"
                  />
                </div>
                <p className="text-xs text-[#a0aab1] px-2">Include country code, e.g. +1</p>
                <motion.button
                  type="submit"
                  variants={buttonVariants}
                  whileHover="hover"
                  whileTap="tap"
                  disabled={loading}
                  className="w-full bg-[#167456] text-white rounded-full px-6 py-4 flex items-center justify-center gap-2 hover:bg-[#105c42] transition-colors disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Send OTP <MoveRight className="w-4 h-4" /></>}
                </motion.button>
              </motion.form>
            )}

            {authMethod === 'phone' && phoneStep === 'verify' && (
              <motion.form variants={itemVariants} onSubmit={handleVerifyOtp} className="space-y-4 mb-6">
                <button
                  type="button"
                  onClick={() => setPhoneStep('input')}
                  className="flex items-center gap-1 text-sm text-[#8b969e] hover:text-[#21313c]"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b969e]" />
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6-digit code"
                    maxLength={6}
                    required
                    className="w-full bg-[#f6f8fa] border border-[#e4e9ee] rounded-full pl-11 pr-6 py-4 text-[#21313c] placeholder-[#a0aab1] focus:outline-none focus:border-[#167456] transition-colors"
                  />
                </div>
                <motion.button
                  type="submit"
                  variants={buttonVariants}
                  whileHover="hover"
                  whileTap="tap"
                  disabled={loading}
                  className="w-full bg-[#167456] text-white rounded-full px-6 py-4 flex items-center justify-center gap-2 hover:bg-[#105c42] transition-colors disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Verify OTP <MoveRight className="w-4 h-4" /></>}
                </motion.button>
              </motion.form>
            )}

            <motion.div variants={itemVariants} className="flex items-center mb-6">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#e4e9ee] to-transparent" />
              <span className="px-4 text-[#a0aab1] text-sm">OR</span>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#e4e9ee] to-transparent" />
            </motion.div>

            <motion.div variants={itemVariants} className="space-y-4 mb-6">
              <motion.button
                variants={buttonVariants}
                whileHover="hover"
                whileTap="tap"
                onClick={handleGoogle}
                disabled={loading}
                className="w-full bg-[#f6f8fa] border border-[#e4e9ee] rounded-full px-6 py-4 text-[#21313c] flex items-center justify-between hover:bg-[#eef2f4] transition-colors group disabled:opacity-60"
              >
                <div className="flex items-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 mr-3">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <span>Continue with Google</span>
                </div>
                <MoveRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </motion.button>
            </motion.div>

            <motion.div variants={itemVariants} className="text-center">
              <p className="text-[#a0aab1] text-sm">
                {mode === 'signin' ? (
                  <>
                    Don&apos;t have an account?{' '}
                    <button onClick={() => setMode('signup')} className="text-[#167456] hover:text-[#105c42] font-medium">
                      Sign up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button onClick={() => setMode('signin')} className="text-[#167456] hover:text-[#105c42] font-medium">
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#f6f8fa]">
        <Loader2 className="w-8 h-8 animate-spin text-[#167456]" />
      </div>
    }>
      <AuthPageContent />
    </Suspense>
  );
}