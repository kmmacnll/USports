import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="glass mx-auto mt-16 max-w-md p-8 text-center">
      <p className="display text-7xl text-primary-text">404</p>
      <p className="mt-2 font-semibold text-ink-2">Not found</p>
      <Link href="/" className="btn-primary mt-6">Back home</Link>
    </div>
  );
}
