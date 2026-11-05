'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="glass mx-auto mt-16 max-w-lg p-8 text-center">
      <p className="text-lg font-semibold">Something went wrong</p>
      <p className="mt-2 text-sm text-slate-400">{error.message || 'Unexpected error'}</p>
      <button onClick={reset} className="btn-primary mt-6">Try again</button>
    </div>
  );
}
