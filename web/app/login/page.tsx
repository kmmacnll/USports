import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthCard } from '@/components/auth-card';
import { SignInForm } from '@/components/sign-in-forms';
import { getMe } from '@/lib/api';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getMe()) redirect('/');
  return <AuthCard mode="signin"><SignInForm /></AuthCard>;
}
