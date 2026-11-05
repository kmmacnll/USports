import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { Nav } from '@/components/nav';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'VarsityHQ', template: '%s · VarsityHQ' },
  description: 'Fantasy leagues for U Sports: real Canadian university athletes, real box scores.',
};

export const viewport: Viewport = { themeColor: '#0f172a' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans">
        <Nav />
        <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
