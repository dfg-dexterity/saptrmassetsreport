export function Carregando() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-label">
      <div className="w-8 h-8 rounded-full border-[3px] border-brand border-r-transparent animate-spin" />
      <span className="text-sm">Carregando…</span>
    </div>
  );
}
