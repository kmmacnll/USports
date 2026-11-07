import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { Nav } from '@/components/nav';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'VarsityHQ', template: '%s · VarsityHQ' },
  description: 'Draft Battles: draft real U Sports athletes head-to-head and watch a live simulated match.',
  appleWebApp: { capable: true, title: 'VarsityHQ', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { themeColor: '#070B15', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800;1,900&display=swap" />
        <link rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..600,0..1,0&display=block" />
      </head>
      <body className="min-h-dvh font-sans">
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6 sm:pt-8">{children}</main>
      </body>
    </html>
  );
}
