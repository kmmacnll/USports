import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './battles.css';

export const metadata: Metadata = {
  title: 'Draft Battles',
  description: 'Draft six players head-to-head, then watch a live simulated match.',
};

export default function BattlesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Draft Battles brand fonts. React hoists these into <head>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" precedence="default"
        href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800;1,900&display=swap" />
      <link rel="stylesheet" precedence="default"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..600,0..1,0&display=block" />
      {/* Full-bleed below the 56px nav; a phone-width column on larger screens. */}
      <div className="fixed inset-x-0 bottom-0 top-14 z-30 bg-[#05080F]">
        <div className="mx-auto h-full w-full max-w-[430px] sm:border-x sm:border-white/10">{children}</div>
      </div>
    </>
  );
}
