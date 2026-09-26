import clsx from "clsx";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  CircleHelp,
  RotateCcw,
  Search,
  X,
  AlertTriangle,
  Info,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DATAS_BASE, usePremissas } from "../../context/PremissasContext";
import { useAlertas } from "../../context/useDados";
import { fmtDate, fmtMonthLong } from "../../lib/dates";
import { Popover } from "../fiori/Popover";
import { SobreDialog } from "./SobreDialog";

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="w-8 h-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#0070F2" />
        <path d="M8 22V12m5.5 10V8m5.5 14v-7m5.5 7V10" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="text-base font-black tracking-tight text-text hidden sm:inline">Dexterity</span>
    </div>
  );
}

const SEV_ICON = { negative: XCircle, critical: AlertTriangle, information: Info };
const SEV_COR = { negative: "text-negative", critical: "text-critical-strong", information: "text-brand" };

/** sap.f.ShellBar – tema Horizon (barra branca) */
export function ShellBar({
  appTitle,
  back,
  search,
}: {
  appTitle?: string;
  back?: boolean;
  search?: { value: string; onChange: (v: string) => void };
}) {
  const navigate = useNavigate();
  const { premissas, atualizar, restaurar, alterado } = usePremissas();
  const alertas = useAlertas();
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [sobre, setSobre] = useState(false);
  const criticos = alertas.filter((a) => a.severidade !== "information").length;

  return (
    <>
      <header className="sticky top-0 z-40 bg-shell shadow-shell no-print">
        <div className="h-[3.25rem] px-2 sm:px-4 flex items-center gap-2">
          {back && (
            <button
              type="button"
              onClick={() => navigate("/")}
              className="p-2 rounded-lg text-link hover:bg-hover"
              aria-label="Voltar ao Launchpad"
              title="Voltar ao Launchpad"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <button type="button" onClick={() => navigate("/")} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-hover min-w-0">
            <Logo />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-label hidden md:inline whitespace-nowrap">Treasury Reporting Pack</span>
            {appTitle && (
              <>
                <span className="text-line hidden md:inline">/</span>
                <span className="text-sm font-semibold text-text truncate">{appTitle}</span>
              </>
            )}
            <span className="rounded-md bg-[#fff8d6] border border-[#e76500]/40 text-[#b44f00] text-[10px] font-bold px-1.5 py-0.5 tracking-wider shrink-0">
              DEMO
            </span>
          </div>

          <div className="flex-1" />

          {search && (
            <div className={clsx("items-center", buscaAberta ? "flex absolute inset-x-2 top-2 sm:static sm:inset-auto" : "hidden sm:flex")}>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-label" />
                <input
                  value={search.value}
                  onChange={(e) => search.onChange(e.target.value)}
                  placeholder="Pesquisar relatórios"
                  className="w-full h-9 rounded-full bg-[#eff1f2] pl-9 pr-9 text-sm text-text placeholder:text-label focus:outline-none focus:bg-white focus:shadow-[0_0_0_1px_#0070f2]"
                />
                {(search.value || buscaAberta) && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-label hover:bg-hover"
                    onClick={() => {
                      search.onChange("");
                      setBuscaAberta(false);
                    }}
                    aria-label="Limpar"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
          {search && !buscaAberta && (
            <button
              type="button"
              className="sm:hidden p-2 rounded-lg text-link hover:bg-hover"
              onClick={() => setBuscaAberta(true)}
              aria-label="Pesquisar"
            >
              <Search className="w-5 h-5" />
            </button>
          )}

          {/* Data-base */}
          <Popover
            width={260}
            trigger={({ toggle, open }) => (
              <button
                type="button"
                onClick={toggle}
                className={clsx(
                  "flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-sm hover:bg-hover",
                  open ? "bg-selected text-[#0057d2]" : "text-link",
                )}
                title="Data-base do relatório"
              >
                <CalendarDays className="w-[18px] h-[18px]" />
                <span className="hidden lg:inline text-label">Data-base</span>
                <span className="font-semibold tabular">{fmtDate(premissas.dataBase)}</span>
              </button>
            )}
          >
            {(close) => (
              <div>
                <div className="px-4 pt-3 pb-2 border-b border-line-soft">
                  <div className="text-sm font-bold text-text">Data-base do relatório</div>
                  <div className="text-xs text-label">Data de corte usada por todos os relatórios</div>
                </div>
                <ul className="py-1">
                  {DATAS_BASE.map((d) => (
                    <li key={d}>
                      <button
                        type="button"
                        onClick={() => {
                          atualizar({ dataBase: d });
                          close();
                          toast.success(`Data-base alterada para ${fmtDate(d)}`);
                        }}
                        className="w-full flex items-center justify-between px-4 py-2 text-sm text-text hover:bg-hover"
                      >
                        <span>
                          <span className="font-semibold tabular">{fmtDate(d)}</span>
                          <span className="text-label ml-2 capitalize">{fmtMonthLong(d)}</span>
                        </span>
                        {d === premissas.dataBase && <Check className="w-4 h-4 text-brand" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Popover>

          {/* Notificações */}
          <Popover
            width={380}
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="relative p-2 rounded-lg text-link hover:bg-hover"
                aria-label={`Notificações (${alertas.length})`}
                title="Notificações"
              >
                <Bell className="w-5 h-5" />
                {alertas.length > 0 && (
                  <span
                    className={clsx(
                      "absolute top-0.5 right-0.5 min-w-[1.05rem] h-[1.05rem] px-1 rounded-full text-[10px] leading-[1.05rem] font-bold text-white text-center",
                      criticos > 0 ? "bg-[#d20a0a]" : "bg-brand",
                    )}
                  >
                    {alertas.length}
                  </span>
                )}
              </button>
            )}
          >
            {(close) => (
              <div>
                <div className="px-4 pt-3 pb-2 border-b border-line-soft flex items-center justify-between">
                  <div className="text-sm font-bold text-text">Notificações</div>
                  <div className="text-xs text-label">{alertas.length} itens</div>
                </div>
                <ul className="max-h-[60vh] overflow-y-auto fiori-scroll divide-y divide-line-soft">
                  {alertas.length === 0 && <li className="px-4 py-6 text-sm text-label text-center">Nenhum alerta para a data-base.</li>}
                  {alertas.map((a) => {
                    const Icon = SEV_ICON[a.severidade];
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            navigate(a.rota);
                          }}
                          className="w-full text-left flex gap-3 px-4 py-2.5 hover:bg-hover"
                        >
                          <Icon className={clsx("w-4 h-4 mt-0.5 shrink-0", SEV_COR[a.severidade])} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-text leading-snug">{a.titulo}</span>
                            <span className="block text-xs text-label leading-snug mt-0.5">{a.descricao}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Popover>

          <button
            type="button"
            onClick={() => setSobre(true)}
            className="p-2 rounded-lg text-link hover:bg-hover hidden sm:block"
            aria-label="Sobre esta demo"
            title="Sobre esta demo"
          >
            <CircleHelp className="w-5 h-5" />
          </button>

          {/* Perfil */}
          <Popover
            width={260}
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="ml-0.5 w-8 h-8 rounded-full bg-[#5d36ff] text-white text-xs font-bold flex items-center justify-center hover:ring-2 hover:ring-[#5d36ff]/30"
                aria-label="Perfil do usuário"
              >
                TS
              </button>
            )}
          >
            {(close) => (
              <div>
                <div className="px-4 py-3 border-b border-line-soft flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#5d36ff] text-white text-sm font-bold flex items-center justify-center">TS</div>
                  <div>
                    <div className="text-sm font-bold text-text">Tesouraria (usuário demo)</div>
                    <div className="text-xs text-label">Empresa ABC S.A.</div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!alterado}
                  onClick={() => {
                    restaurar();
                    close();
                    toast.success("Premissas restauradas para os valores da planilha base");
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <RotateCcw className="w-4 h-4 text-label" /> Restaurar premissas padrão
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setSobre(true);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text hover:bg-hover"
                >
                  <CircleHelp className="w-4 h-4 text-label" /> Sobre esta demo
                </button>
              </div>
            )}
          </Popover>
        </div>
      </header>
      {sobre && <SobreDialog onClose={() => setSobre(false)} />}
    </>
  );
}
