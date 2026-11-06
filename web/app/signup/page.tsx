import type { Metadata } from 'next';

import { AuthCard } from '@/components/auth-card';
import { SignUpForm } from '@/components/sign-in-forms';

export const metadata: Metadata = { title: 'Create account' };
export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  return <AuthCard mode="signup"><SignUpForm /></AuthCard>;
}
