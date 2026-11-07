export function ErrorNote({ message }: { message: string }) {
  return <p role="alert" className="rounded-xl border border-loss/30 bg-loss/10 px-3 py-2 text-[13px] font-semibold text-loss">{message}</p>;
}
