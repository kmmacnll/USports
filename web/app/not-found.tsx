import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="glass mx-auto mt-16 max-w-md p-8 text-center">
      <p className="text-5xl font-black text-accent">404</p>
      <p className="mt-2 text-slate-300">That page or league doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className="btn-primary mt-6">Back to dashboard</Link>
    </div>
  );
}
