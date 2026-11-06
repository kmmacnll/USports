import type { Metadata } from 'next';

import { AuthCard } from '@/components/auth-card';
import { SignInForm } from '@/components/sign-in-forms';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <AuthCard mode="signin"><SignInForm /></AuthCard>;
}
