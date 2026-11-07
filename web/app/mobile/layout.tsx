import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './mobile.css';

export const metadata: Metadata = {
  title: 'VarsityHQ App',
  description: 'The VarsityHQ phone app: live matchups, lineups, players, scores and the draft room.',
};

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Brand fonts. React hoists these into <head>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" precedence="default"
        href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Barlow+Condensed:wght@500;600;700&display=swap" />
      <link rel="stylesheet" precedence="default"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..600,0..1,0&display=block" />
      {/* Full-bleed below the 56px nav; a phone-width column on larger screens. */}
      <div className="fixed inset-x-0 bottom-0 top-14 z-30 bg-[#060A12]">
        <div className="mx-auto h-full w-full max-w-[430px] sm:border-x sm:border-white/10">{children}</div>
      </div>
    </>
  );
}
