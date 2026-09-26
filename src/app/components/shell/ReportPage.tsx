import { ChevronRight, FileSpreadsheet, Printer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { SECOES, type Relatorio } from "../../data/catalogo";
import { usePremissas } from "../../context/PremissasContext";
import { EM_ARTIFACT, obterDownloads } from "../../lib/ambiente";
import { fmtDate } from "../../lib/dates";
import { Button } from "../fiori/Button";
import { ShellBar } from "./ShellBar";

/**
 * sap.f.DynamicPage – cabeçalho com breadcrumbs, título, atributos do relatório, KPIs e ações;
 * conteúdo em fundo sapBackgroundColor.
 */
export function ReportPage({
  relatorio,
  kpis,
  headerExtra,
  onExport,
  actions,
  children,
}: {
  relatorio: Relatorio;
  kpis?: ReactNode;
  headerExtra?: ReactNode;
  onExport?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { premissas } = usePremissas();
  const secao = SECOES.find((s) => s.id === relatorio.secao)!;
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
    document.title = `${relatorio.tituloCurto} | Reporting Pack – Demo`;
    return () => {
      document.title = "Reporting Pack – Aplicações Financeiras | Demo";
    };
  }, [relatorio]);

  return (
    <div className="min-h-screen flex flex-col">
      <ShellBar appTitle={relatorio.tituloCurto} back />

      <div className="bg-white shadow-[0_1px_0_#d9d9d9] print-flat">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-5">
          <nav className="flex items-center gap-1 text-[13px] text-label mb-2 no-print" aria-label="Breadcrumb">
            <Link to="/" className="text-link hover:underline">
              Início
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span>
              {secao.numero}. {secao.titulo}
            </span>
          </nav>

          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${relatorio.cor}14`, color: relatorio.cor }}
              >
                <Icone className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-text leading-tight">{relatorio.titulo}</h1>
                <p className="text-sm text-label mt-1 max-w-3xl leading-relaxed">{relatorio.descricao}</p>
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
                <Button variant="transparent" icon={<Printer className="w-4 h-4" />} onClick={() => window.print()} title="Imprimir / PDF">
                  <span className="hidden sm:inline">Imprimir</span>
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-col xl:flex-row xl:items-start gap-5 xl:gap-10">
            <dl className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 gap-x-8 gap-y-2 text-[13px] shrink-0 xl:max-w-[30rem]">
              <Attr label="Data-base" value={fmtDate(premissas.dataBase)} />
              <Attr label="Periodicidade" value={relatorio.periodicidade} />
              <Attr label="Público" value={relatorio.publico} />
              <Attr label="Norma / Referência" value={relatorio.norma} />
            </dl>
            {kpis && (
              <div className="flex flex-wrap gap-x-8 gap-y-3 xl:ml-auto xl:pl-8 xl:border-l xl:border-line-soft">{kpis}</div>
            )}
          </div>
          {headerExtra && <div className="mt-4">{headerExtra}</div>}
        </div>
      </div>

      <main className="flex-1 max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 space-y-5">{children}</main>

      <footer className="no-print border-t border-line-soft bg-white">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap gap-2 items-center justify-between text-xs text-label">
          <span>
            Fonte: aba <strong className="text-text font-semibold">{relatorio.aba}</strong> do Reporting Pack · SAP S/4HANA TRM
          </span>
          <span>Dados fictícios para demonstração</span>
        </div>
      </footer>
    </div>
  );
}

function Attr({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label">{label}</dt>
      <dd className="text-text font-semibold truncate max-w-[16rem]" title={value}>
        {value}
      </dd>
    </div>
  );
}
