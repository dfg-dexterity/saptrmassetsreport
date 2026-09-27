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
import { DATAS_BASE, usePremissas } from "../../context/MercadoContext";
import { useProduto } from "../../context/ProdutoContext";
import { DATA_BASE_PADRAO } from "../../data/mercado";
import { fmtDate, fmtMonthLong } from "../../lib/dates";
import { Popover } from "../fiori/Popover";
import { DexterityLogo } from "./DexterityLogo";
import { SobreDialog } from "./SobreDialog";

/** Marca no cabeçalho: lockup inline (só o símbolo no celular), com a animação das pétalas do .dx-brand */
export function Logo() {
  return (
    <>
      <DexterityLogo className="h-[22px] w-auto hidden sm:block" />
      <DexterityLogo simbolo className="h-[24px] w-auto sm:hidden" />
    </>
  );
}

/** Selo DEMO: etiqueta mono com filete âmbar */
function SeloDemo({ className }: { className?: string }) {
  return (
    <span className={clsx("border border-amarelo/60 text-amarelo font-mono text-[9.5px] leading-none tracking-[0.16em] px-1.5 py-[3px] shrink-0", className)}>
      DEMO
    </span>
  );
}

/** Botão de ícone do cabeçalho: sem fundo, ícone em cinza-areia que acende em creme */
const BOTAO_ICONE = "p-1.5 sm:p-2 text-label hover:text-text hover:bg-hover transition-colors";

/** Cabeçalho dos popovers do cabeçalho (padrão .dx-painel__hd) */
const CABECALHO_POPOVER = "px-4 pt-3.5 pb-3 bg-surface-2 border-b border-line-soft";
const TITULO_POPOVER = "font-display text-[17px] font-semibold uppercase tracking-[0.04em] leading-none text-text";

const SEV_ICON = { negative: XCircle, critical: AlertTriangle, information: Info };

/** "março de 2026" → "Março de 2026" (só a primeira letra) */
function maiusculaInicial(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const SEV_COR = { negative: "text-negative", critical: "text-critical", information: "text-link" };

/** Cabeçalho fixo no padrão .dx-nav: barra grafite translúcida com filete inferior e a marca à esquerda */
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
  const { premissas, definirDataBase } = usePremissas();
  const produto = useProduto();
  const alertas = produto.alertas;
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [sobre, setSobre] = useState(false);
  const criticos = alertas.filter((a) => a.severidade !== "information").length;
  // "Aplicações Financeiras" → "Aplicações"; "Captações Financeiras" → "Captações"
  const nomeCurto = produto.nome.split(" ")[0];

  return (
    <>
      <header className="dx-nav top-[env(safe-area-inset-top,0px)] z-40 no-print">
        <div className="h-14 px-3 sm:px-4 lg:px-6 flex items-center gap-1 sm:gap-2">
          {back && (
            <button
              type="button"
              onClick={() => navigate("/")}
              className={BOTAO_ICONE}
              aria-label="Voltar ao Launchpad"
              title="Voltar ao Launchpad"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <button type="button" onClick={() => navigate("/")} className="dx-brand px-1 py-1.5 shrink-0" aria-label="Início – Launchpad">
            <Logo />
          </button>
          <span className="hidden sm:block w-px h-6 bg-line-soft mx-1 shrink-0" aria-hidden />
          {/* Celular: nome curto do produto (ex.: "Aplicações") com o selo DEMO embaixo */}
          <div className="flex flex-col items-start min-w-0 sm:hidden leading-none ml-1" title={produto.nome}>
            <span className="max-w-full font-mono text-[10.5px] uppercase tracking-[0.12em] text-text truncate">{nomeCurto}</span>
            <SeloDemo className="mt-1.5" />
          </div>
          <div className="hidden sm:flex items-center gap-2 min-w-0">
            {/* Tablet: nome curto; a partir de md, o nome completo */}
            <span className="font-mono text-[11px] uppercase tracking-[0.13em] text-label truncate min-w-0 md:hidden shrink-0" title={produto.nome}>
              {nomeCurto}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.13em] text-label hidden md:inline whitespace-nowrap">{produto.nome}</span>
            {appTitle && (
              <>
                <span className="text-muted">/</span>
                <span className="text-sm font-medium text-text truncate min-w-0" title={appTitle}>
                  {appTitle}
                </span>
              </>
            )}
            <SeloDemo />
          </div>

          <div className="flex-1" />

          {search && (
            <div className={clsx("items-center", buscaAberta ? "flex absolute inset-x-2 top-2.5 sm:static sm:inset-auto" : "hidden sm:flex")}>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-label pointer-events-none" />
                <input
                  value={search.value}
                  onChange={(e) => search.onChange(e.target.value)}
                  placeholder="Pesquisar relatórios"
                  className="w-full h-9 bg-surface-3 border border-line-soft pl-9 pr-9 text-sm text-text placeholder:text-muted hover:border-line focus:border-brand focus-visible:outline-offset-2"
                />
                {(search.value || buscaAberta) && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-label hover:text-text hover:bg-hover"
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
            <button type="button" className={clsx(BOTAO_ICONE, "sm:hidden")} onClick={() => setBuscaAberta(true)} aria-label="Pesquisar">
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
                  "flex items-center gap-1.5 h-9 px-1.5 sm:px-2.5 border text-text transition-colors",
                  open ? "border-brand bg-surface" : "border-transparent hover:border-line-soft",
                )}
                title="Data-base do relatório"
              >
                <CalendarDays className="w-[18px] h-[18px] text-link" />
                <span className="hidden lg:inline font-mono text-[10.5px] uppercase tracking-[0.13em] text-label">Data-base</span>
                <span className="font-mono text-[13px] tabular hidden min-[400px]:inline">{fmtDate(premissas.dataBase)}</span>
                {/* dd/mm/aa em telas muito estreitas */}
                <span className="font-mono text-[13px] tabular min-[400px]:hidden">{fmtDate(premissas.dataBase).replace(/\/(\d{2})(\d{2})$/, "/$2")}</span>
              </button>
            )}
          >
            {(close) => (
              <div>
                <div className={CABECALHO_POPOVER}>
                  <div className={TITULO_POPOVER}>Data-base do relatório</div>
                  <div className="text-xs text-label mt-1.5">Data de corte usada por todos os relatórios</div>
                </div>
                <ul className="py-1">
                  {DATAS_BASE.map((d) => (
                    <li key={d}>
                      <button
                        type="button"
                        onClick={() => {
                          definirDataBase(d);
                          close();
                          toast.success(`Data-base alterada para ${fmtDate(d)}`);
                        }}
                        className="w-full flex items-center justify-between px-4 py-2 text-sm text-text hover:bg-hover"
                      >
                        <span>
                          <span className="font-mono text-[13px] tabular">{fmtDate(d)}</span>
                          <span className="text-label ml-2">{maiusculaInicial(fmtMonthLong(d))}</span>
                        </span>
                        {d === premissas.dataBase && <Check className="w-4 h-4 text-link" />}
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
                className={clsx(BOTAO_ICONE, "relative")}
                aria-label={`Notificações (${alertas.length})`}
                title="Notificações"
              >
                <Bell className="w-5 h-5" />
                {alertas.length > 0 && (
                  <span
                    className={clsx(
                      "absolute top-0.5 right-0.5 min-w-[1.05rem] h-[1.05rem] px-1 font-mono text-[10px] leading-[1.05rem] font-semibold text-page text-center",
                      criticos > 0 ? "bg-amarelo" : "bg-brand",
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
                <div className={clsx(CABECALHO_POPOVER, "flex items-center justify-between")}>
                  <div className={TITULO_POPOVER}>Notificações</div>
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-label">{alertas.length} itens</div>
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
            className={clsx(BOTAO_ICONE, "hidden sm:block")}
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
                className="ml-1 w-8 h-8 border border-line bg-surface-2 text-text font-mono text-[11px] tracking-[0.06em] flex items-center justify-center hover:border-text transition-colors"
                aria-label="Perfil do usuário"
              >
                TS
              </button>
            )}
          >
            {(close) => (
              <div>
                <div className={clsx(CABECALHO_POPOVER, "flex items-center gap-3")}>
                  <div className="w-10 h-10 border border-line text-text font-mono text-[12px] tracking-[0.06em] flex items-center justify-center">TS</div>
                  <div>
                    <div className="text-sm font-semibold text-text">Tesouraria (usuário demo)</div>
                    <div className="text-xs text-label">Empresa ABC S.A.</div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={premissas.dataBase === DATA_BASE_PADRAO}
                  onClick={() => {
                    definirDataBase(DATA_BASE_PADRAO);
                    close();
                    toast.success(`Data-base restaurada para ${fmtDate(DATA_BASE_PADRAO)}`);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <RotateCcw className="w-4 h-4 text-label" /> Voltar à data-base padrão
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
