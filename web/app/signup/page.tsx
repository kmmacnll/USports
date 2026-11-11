import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthCard } from '@/components/auth-card';
import { SignUpForm } from '@/components/sign-in-forms';
import { api, getMe } from '@/lib/api';
import type { University } from '@/lib/types';

export const metadata: Metadata = { title: 'Create account' };
export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  if (await getMe()) redirect('/');
  const universities = await api<{ data: University[] }>('/universities', { auth: false, revalidate: 3600 })
    .then((r) => r.data).catch(() => []);
  return <AuthCard mode="signup"><SignUpForm universities={universities} /></AuthCard>;
}
