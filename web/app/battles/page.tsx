import { permanentRedirect } from 'next/navigation';

/** Draft Battles moved to the home page; keep old /battles links (and their #screen) working. */
export default function BattlesRedirect() {
  permanentRedirect('/');
}
