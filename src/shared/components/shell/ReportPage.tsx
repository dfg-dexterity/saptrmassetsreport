import { ChevronRight, FileSpreadsheet, Printer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { usePremissas } from "../../context/MercadoContext";
import { useProduto } from "../../context/ProdutoContext";
import { AVISO_DADOS } from "../../data/mercado";
import type { RelatorioBase } from "../../data/relatorio";
import { EM_ARTIFACT, obterDownloads } from "../../lib/ambiente";
import { fmtDate } from "../../lib/dates";
import { Button } from "../fiori/Button";
import { MessageStrip } from "../fiori/MessageStrip";
import { DexterityLogo } from "./DexterityLogo";
import { ShellBar } from "./ShellBar";

/**
 * Página de relatório: cabeçalho com trilha, título, atributos do relatório, KPIs e ações; conteúdo sobre o grafite
 * da página e rodapé com a marca.
 */
export function ReportPage({
  relatorio,
  kpis,
  headerExtra,
  onExport,
  actions,
  children,
}: {
  relatorio: RelatorioBase;
  kpis?: ReactNode;
  headerExtra?: ReactNode;
  onExport?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { premissas } = usePremissas();
  const produto = useProduto();
  const secao = produto.secoes.find((s) => s.id === relatorio.secao) ?? { numero: 0, titulo: "" };
  const Icone = relatorio.icone;
  // No viewer do claude.ai o botão só aparece quando a capacidade `downloads` está disponível
  const [podeExportar, setPodeExportar] = useState(!EM_ARTIFACT);

  useEffect(() => {
    if (!EM_ARTIFACT) return;
    let ativo = true;
    obterDownloads().then((d) => ativo && setPodeExportar(d !== null));
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    const anterior = document.title;
    document.title = `${relatorio.tituloCurto} | ${produto.nome} – Demo`;
    return () => {
      document.title = anterior;
    };
  }, [relatorio, produto.nome]);

  return (
    <div className="min-h-screen flex flex-col">
      <ShellBar appTitle={relatorio.tituloCurto} back />

      {/* Cabeçalho da página no padrão .dx-phead: rótulo mono, título em Barlow Condensed e atributos em grade de filetes */}
      <header className="border-b border-line-soft print-flat">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-6">
          <nav className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-label mb-4 no-print" aria-label="Breadcrumb">
            <Link to="/" className="text-link hover:text-text transition-colors">
              Início
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-muted" />
            <span className="truncate">
              {secao.numero}. {secao.titulo}
            </span>
          </nav>

          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="flex items-start gap-3.5 sm:gap-4 min-w-0">
              <div className="w-11 h-11 border border-line-soft flex items-center justify-center shrink-0 text-link">
                <Icone className="w-[22px] h-[22px]" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h1 className="text-[30px] sm:text-[38px] xl:text-[44px] leading-[0.95] font-semibold text-text">{relatorio.titulo}</h1>
                <p className="text-[15px] font-light text-suave mt-3 max-w-3xl leading-relaxed">{relatorio.descricao}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 no-print">
              {actions}
              {onExport && podeExportar && (
                <Button variant="emphasized" icon={<FileSpreadsheet className="w-4 h-4" />} onClick={onExport}>
                  Exportar Excel
                </Button>
              )}
              {!EM_ARTIFACT && (
                <Button icon={<Printer className="w-4 h-4" />} onClick={() => window.print()} title="Imprimir / PDF">
                  <span className="hidden sm:inline">Imprimir</span>
                </Button>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col xl:flex-row xl:items-center gap-5 xl:gap-10">
            <dl className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 gap-px bg-line-soft border border-line-soft shrink-0 xl:w-[32rem]">
              <Attr label="Data-base" value={fmtDate(premissas.dataBase)} />
              <Attr label="Periodicidade" value={relatorio.periodicidade} />
              <Attr label="Público" value={relatorio.publico} />
              <Attr label="Norma / Referência" value={relatorio.norma} />
            </dl>
            {kpis && (
              <div className="flex flex-wrap gap-x-9 gap-y-5 xl:ml-auto xl:pl-10 xl:border-l xl:border-line-soft xl:self-stretch xl:items-center">{kpis}</div>
            )}
          </div>
          {headerExtra && <div className="mt-5">{headerExtra}</div>}
        </div>
      </header>

      <main className="flex-1 max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        <MessageStrip design="critical">{AVISO_DADOS}</MessageStrip>
        {children}
      </main>

      <footer className="no-print border-t border-line-soft">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-wrap gap-x-8 gap-y-3 items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.12em] text-label">
          <span className="dx-brand">
            <DexterityLogo className="h-[18px] w-auto" />
          </span>
          <span>
            Fonte: aba <strong className="text-text font-medium">{relatorio.aba}</strong> do Reporting Pack · SAP S/4HANA TRM
          </span>
          <span>Dados fictícios do ambiente de teste · premissas importadas do SAP</span>
        </div>
      </footer>
    </div>
  );
}

function Attr({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-page px-3 py-2.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.13em] text-label">{label}</dt>
      <dd className="text-[13px] text-text font-medium leading-snug break-words mt-1" title={value}>
        {value}
      </dd>
    </div>
  );
}
