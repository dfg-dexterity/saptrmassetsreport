import clsx from "clsx";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ChevronRight, LayoutGrid, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Area, AreaChart, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { fmtCompact, fmtDec } from "../../lib/format";
import { Card, SectionTitle } from "./Card";
import { DataTable, type Column } from "./DataTable";
import { SegmentedButton } from "./Inputs";
import { CHART_SEMANTIC } from "./Kpi";
import { ObjectStatus, type ValueState } from "./ObjectStatus";

/*
 * Painéis de KPIs (Aplicações e Captações): cartão numérico, cartão auxiliar, ponte de valores, placar, título de seção
 * e tabela – os dois produtos montam a tela com estas mesmas peças, no mesmo formato.
 */

const COR: Record<ValueState, string> = {
  positive: "#256f3a",
  critical: "#b44f00",
  negative: "#aa0808",
  information: "#0070f2",
  neutral: "#1d2d3e",
};

const COR_GRAFICO: Record<ValueState, string> = {
  positive: "#30914c",
  critical: "#e26300",
  negative: "#f53232",
  information: "#0070f2",
  neutral: "#758ca4",
};

export interface KpiIndicadorLateral {
  label: string;
  value: ReactNode;
  state?: ValueState;
}

export interface KpiTendencia {
  /** texto da variação (ex.: "+0,4 p.p. vs fev/26") */
  texto: string;
  direcao: "up" | "down" | "flat";
  /** a variação é boa para a empresa? define a cor da seta */
  favoravel: boolean | null;
}

/** Valor em R$ no cartão: "R$ 161,7" com a escala na unidade ("mi" ou "mil"); negativo com "−" colado */
export function reaisKpi(v: number): { valor: string; unidade: string } {
  const a = Math.abs(v);
  if (a >= 999_950) return { valor: `${v < 0 ? "−" : ""}R$ ${fmtDec(a / 1e6, 1)}`, unidade: "mi" };
  return { valor: `${v < 0 && a >= 50 ? "−" : ""}R$ ${fmtDec(a / 1e3, 1)}`, unidade: "mil" };
}

function corSetaDe(t?: KpiTendencia): string {
  return t?.favoravel === null || t?.direcao === "flat" ? "text-label" : t?.favoravel ? "text-positive" : "text-negative";
}

function SetaDe({ t, className }: { t?: KpiTendencia; className?: string }) {
  const Seta = t?.direcao === "up" ? ArrowUpRight : t?.direcao === "down" ? ArrowDownRight : ArrowRight;
  return <Seta className={className} aria-hidden />;
}

/** Link para o relatório de origem, no formato "R05 · Evolução ›" */
function LinkOrigem({ rota, origem, className }: { rota: string; origem: string; className?: string }) {
  return (
    <Link to={rota} className={clsx("text-[13px] text-link hover:underline inline-flex items-center gap-0.5 whitespace-nowrap", className)}>
      {origem}
      <ChevronRight className="w-3.5 h-3.5" />
    </Link>
  );
}

/**
 * Cartão analítico com cabeçalho numérico (sap.f.Card – Numeric Header): título, valor principal com unidade e cor de
 * estado, seta de tendência, indicadores laterais (meta, folga), micrográfico de 12 meses e rodapé com status e
 * navegação para o relatório de origem.
 */
export function KpiCard({
  titulo,
  subtitulo,
  valor,
  unidade,
  state = "neutral",
  tendencia,
  laterais,
  serie,
  referencia,
  status,
  rota,
  origem,
  detalhe,
  className,
}: {
  titulo: string;
  subtitulo?: string;
  valor: ReactNode;
  unidade?: string;
  state?: ValueState;
  tendencia?: KpiTendencia;
  laterais?: KpiIndicadorLateral[];
  /** série para o micrográfico (ex.: 12 fins de mês) */
  serie?: { x: string; y: number }[];
  /** linha de referência no micrográfico (meta ou limite) */
  referencia?: number;
  status?: { state: ValueState; texto: string };
  rota?: string;
  /** relatório de origem exibido no rodapé ("R05 · Evolução") */
  origem?: string;
  detalhe?: ReactNode;
  className?: string;
}) {
  const corSeta = corSetaDe(tendencia);
  const corLinha = COR_GRAFICO[state === "neutral" ? "information" : state];
  // domínio com margem mínima (1% do valor) para não exagerar variações ínfimas; a meta estende o domínio
  const dominio = (() => {
    if (!serie || serie.length < 2) return undefined;
    const ys = serie.map((d) => d.y).concat(referencia !== undefined ? [referencia] : []);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const pad = Math.max((max - min) * 0.15, Math.max(Math.abs(min), Math.abs(max)) * 0.01, 1e-9);
    return [min - pad, max + pad] as [number, number];
  })();
  const idGrad = `kpi-${titulo.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <section className={clsx("bg-white rounded-[var(--radius-card)] shadow-fiori print-flat flex flex-col min-w-0", className)}>
      <header className="px-4 pt-3.5">
        <h3 className="text-[15px] font-bold text-text leading-snug">{titulo}</h3>
        {subtitulo && <p className="text-[13px] text-label leading-snug mt-0.5">{subtitulo}</p>}
      </header>

      <div className="px-4 pt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[2rem] leading-none font-light tabular whitespace-nowrap" style={{ color: COR[state] }}>
              {valor}
            </span>
            {unidade && <span className="text-sm text-label whitespace-nowrap">{unidade}</span>}
            {tendencia && <SetaDe t={tendencia} className={clsx("w-5 h-5 self-center shrink-0", corSeta)} />}
          </div>
          {tendencia && <div className={clsx("text-xs mt-1 whitespace-nowrap", corSeta)}>{tendencia.texto}</div>}
        </div>
        {laterais && laterais.length > 0 && (
          <dl className="text-right shrink-0 space-y-1">
            {laterais.map((l) => (
              <div key={l.label}>
                <dt className="text-[11px] text-label leading-tight whitespace-nowrap">{l.label}</dt>
                <dd className="text-[13px] font-semibold tabular leading-tight whitespace-nowrap" style={{ color: COR[l.state ?? "neutral"] }}>
                  {l.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {serie && serie.length > 1 && (
        <div className="h-14 mt-2 px-1" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serie} margin={{ top: 4, right: 8, bottom: 2, left: 8 }}>
              <defs>
                <linearGradient id={idGrad} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={corLinha} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={corLinha} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <YAxis hide domain={dominio ?? ["auto", "auto"]} />
              {referencia !== undefined && (
                <ReferenceLine y={referencia} stroke="#1d2d3e" strokeDasharray="3 3" strokeWidth={1} ifOverflow="extendDomain" />
              )}
              <Area
                type="monotone"
                dataKey="y"
                stroke={corLinha}
                strokeWidth={1.75}
                fill={`url(#${idGrad})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {detalhe && <div className="px-4 pt-2 text-xs text-label leading-relaxed">{detalhe}</div>}

      <footer className="mt-auto px-4 py-2.5 mt-3 border-t border-line-soft flex items-center justify-between gap-2 min-h-[2.5rem]">
        {status ? <ObjectStatus state={status.state}>{status.texto}</ObjectStatus> : <span />}
        {rota && <LinkOrigem rota={rota} origem={origem ?? "Detalhes"} className="no-print" />}
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cartão auxiliar e ponte de valores
// ---------------------------------------------------------------------------

/** Cartão auxiliar do painel, com o mesmo cabeçalho e rodapé do KpiCard */
export function KpiPainel({
  titulo,
  subtitulo,
  rota,
  origem,
  rodape,
  className,
  children,
}: {
  titulo: string;
  subtitulo: string;
  rota: string;
  origem: string;
  rodape?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={clsx("bg-white rounded-[var(--radius-card)] shadow-fiori print-flat flex flex-col min-w-0", className)}>
      <header className="px-4 pt-3.5">
        <h3 className="text-[15px] font-bold text-text leading-snug">{titulo}</h3>
        <p className="text-[13px] text-label leading-snug mt-0.5">{subtitulo}</p>
      </header>
      <div className="px-4 pt-3 pb-1 flex-1">{children}</div>
      <footer className="mt-3 px-4 py-2.5 border-t border-line-soft flex items-center justify-between gap-2 min-h-[2.5rem]">
        <span className="text-xs text-label leading-snug min-w-0">{rodape}</span>
        <LinkOrigem rota={rota} origem={origem} className="no-print shrink-0" />
      </footer>
    </section>
  );
}

export interface KpiPonteLinha {
  rotulo: string;
  /** valor exibido: nas linhas "(−)" passe o valor positivo */
  valor: number;
  cor: string;
  forte?: boolean;
}

/** Barras horizontais de uma ponte (bruto → líquido, dívida bruta → líquida), proporcionais à base */
export function KpiPonte({ base, linhas }: { base: number; linhas: KpiPonteLinha[] }) {
  return (
    <ul className="space-y-2.5">
      {linhas.map((l) => (
        <li key={l.rotulo} className="min-w-0">
          <div className={clsx("flex items-baseline justify-between gap-2 text-[13px]", l.forte ? "font-semibold text-text" : "text-label")}>
            <span className="truncate">{l.rotulo}</span>
            <span className="tabular whitespace-nowrap text-text">{fmtCompact(l.valor)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-[#eef0f2]">
            <div
              className="h-full rounded-full"
              style={{ width: `${base > 0 ? Math.max(1.5, Math.min(100, (Math.abs(l.valor) / base) * 100)) : 0}%`, backgroundColor: l.cor }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Seção do painel
// ---------------------------------------------------------------------------

/** Seção numerada do painel: título, "x/y na meta", periodicidade e grade de 4 colunas (xl) */
export function KpiSecao({
  id,
  titulo,
  periodo,
  contagem,
  antes,
  children,
}: {
  id: string;
  titulo: string;
  periodo?: string;
  /** KPIs com meta ou limite da seção (sem = seção só com informativos) */
  contagem?: { ok: number; total: number; estado: ValueState };
  /** conteúdo entre o título e a grade (ex.: aviso de covenant) */
  antes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`secao-${id}`} className="pt-2">
      <SectionTitle
        id={`secao-${id}`}
        extra={
          contagem && contagem.total > 0 ? (
            <ObjectStatus state={contagem.estado}>
              {contagem.ok}/{contagem.total} na meta
            </ObjectStatus>
          ) : (
            <span className="text-xs text-label whitespace-nowrap">Informativos</span>
          )
        }
      >
        {titulo}
      </SectionTitle>
      {periodo && <p className="text-xs text-label -mt-1.5 mb-3">{periodo}</p>}
      {antes && <div className="mb-3">{antes}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Placar
// ---------------------------------------------------------------------------

export type KpiModo = "cartoes" | "tabela";

export interface KpiPlacarItem {
  id: string;
  secao: string;
  /** rótulo curto do chip */
  curto: string;
  nome: string;
  state: ValueState;
  statusTexto: string;
  /** faixa na contagem (null = informativo, sem meta) */
  faixa: "ok" | "atencao" | "fora" | null;
  /** valor e meta em uma linha ("10,1% · meta ≤ 25,0% · meta interna") */
  resumo: string;
  /** ordem nos pontos de atenção (0 = mais crítico) */
  prioridade: number;
}

/** Contagem do placar: KPIs com meta ou limite por faixa */
export function contarPlacar(itens: Pick<KpiPlacarItem, "faixa">[]) {
  const ok = itens.filter((k) => k.faixa === "ok").length;
  const atencao = itens.filter((k) => k.faixa === "atencao").length;
  const fora = itens.filter((k) => k.faixa === "fora").length;
  return { ok, atencao, fora, comMeta: ok + atencao + fora, informativos: itens.filter((k) => k.faixa === null).length };
}

function DonutPlacar({ ok, atencao, fora }: { ok: number; atencao: number; fora: number }) {
  const total = ok + atencao + fora;
  const dados = [
    { nome: "Na meta", v: ok, cor: CHART_SEMANTIC.good },
    { nome: "Em atenção", v: atencao, cor: CHART_SEMANTIC.critical },
    { nome: "Fora da meta", v: fora, cor: CHART_SEMANTIC.bad },
  ].filter((x) => x.v > 0);
  return (
    <div className="relative w-32 h-32 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={dados} dataKey="v" nameKey="nome" innerRadius="76%" outerRadius="100%" paddingAngle={2} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
            {dados.map((x) => (
              <Cell key={x.nome} fill={x.cor} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[1.75rem] font-light leading-none tabular" style={{ color: COR[fora ? "negative" : atencao ? "critical" : "positive"] }}>
          {ok}
        </span>
        <span className="text-[11px] text-label leading-tight mt-1 text-center">
          de {total}
          <br />
          na meta
        </span>
      </div>
    </div>
  );
}

/**
 * Placar do painel (mesmo layout nos dois produtos): rosca com a contagem, chips por seção (clique leva ao cartão),
 * pontos de atenção em ordem de criticidade e alternância Cartões/Tabela à direita do título.
 */
export function KpiPlacar({
  subtitulo,
  secoes,
  itens,
  modo,
  onModo,
  onIr,
  notaFora,
  rodape,
  className,
}: {
  subtitulo: string;
  secoes: { id: string; titulo: string }[];
  itens: KpiPlacarItem[];
  modo: KpiModo;
  onModo: (m: KpiModo) => void;
  onIr: (id: string) => void;
  /** observação na linha "fora da meta" (ex.: "1 com waiver") */
  notaFora?: string;
  rodape?: ReactNode;
  className?: string;
}) {
  const c = contarPlacar(itens);
  const alertas = itens.filter((k) => k.faixa === "atencao" || k.faixa === "fora").sort((a, b) => a.prioridade - b.prioridade);
  return (
    <Card
      className={className}
      title="Placar"
      subtitle={subtitulo}
      actions={
        <SegmentedButton
          value={modo}
          onChange={onModo}
          className="no-print"
          items={[
            { value: "cartoes", label: "Cartões", icon: <LayoutGrid className="w-3.5 h-3.5" /> },
            { value: "tabela", label: "Tabela", icon: <Table2 className="w-3.5 h-3.5" /> },
          ]}
        />
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-5 items-center">
        <div className="flex items-center gap-5">
          <DonutPlacar ok={c.ok} atencao={c.atencao} fora={c.fora} />
          <ul className="space-y-2">
            <li>
              <ObjectStatus state="positive">{c.ok} na meta</ObjectStatus>
            </li>
            <li>
              <ObjectStatus state="critical">{c.atencao} em atenção</ObjectStatus>
            </li>
            <li>
              <ObjectStatus state="negative">{c.fora} fora da meta</ObjectStatus>
              {notaFora && <span className="block text-xs text-label ml-5">{notaFora}</span>}
            </li>
            {c.informativos > 0 && (
              <li>
                <ObjectStatus state="neutral">{c.informativos} informativos</ObjectStatus>
              </li>
            )}
          </ul>
        </div>
        <div className="space-y-2 min-w-0 md:border-l md:border-line-soft md:pl-8">
          {secoes.map((s) => {
            const doGrupo = itens.filter((k) => k.secao === s.id);
            if (!doGrupo.length) return null;
            return (
              <div key={s.id} className="grid grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)] gap-x-3 gap-y-1 items-start">
                <div className="text-[13px] font-semibold text-text leading-6">{s.titulo}</div>
                <div className="flex flex-wrap gap-1.5">
                  {doGrupo.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => onIr(k.id)}
                      title={`${k.nome}: ${k.resumo} · ${k.statusTexto}`}
                      className="rounded-md cursor-pointer hover:brightness-95"
                    >
                      <ObjectStatus state={k.state} inverted>
                        {k.curto}
                      </ObjectStatus>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-line-soft">
        <div className="text-[13px] font-semibold text-text mb-1">Pontos de atenção</div>
        {alertas.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-3 rounded-lg bg-positive-bg text-positive text-[13px] font-semibold">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> Todos os KPIs com meta ou limite estão dentro do esperado
          </div>
        ) : (
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 -mx-2">
            {alertas.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  onClick={() => onIr(k.id)}
                  className="w-full flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 gap-y-1 px-2 py-2 rounded-lg text-left hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 basis-[13rem]">
                    <span className="block text-sm font-semibold text-text truncate">{k.nome}</span>
                    <span className="block text-xs text-label truncate">{k.resumo}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <ObjectStatus state={k.state} inverted>
                      {k.statusTexto}
                    </ObjectStatus>
                    <ChevronRight className="w-4 h-4 text-label hidden sm:block" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rodape && <p className="text-xs text-label mt-3 pt-3 border-t border-line-soft leading-relaxed">{rodape}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Visão em tabela
// ---------------------------------------------------------------------------

export function KpiTendenciaTexto({ t }: { t?: KpiTendencia }) {
  if (!t) return <span className="text-label">—</span>;
  const cor = corSetaDe(t);
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap text-[13px]", cor)}>
      <SetaDe t={t} className="w-4 h-4 shrink-0" />
      {t.texto}
    </span>
  );
}

export interface KpiLinha {
  id: string;
  nome: string;
  /** seção e periodicidade ("1. Tamanho da dívida · mensal") */
  secao: string;
  formula?: string;
  /** valor com a unidade, na mesma grandeza da meta */
  valor: string;
  valorOrdem: number | null;
  /** 2ª linha do valor: data de referência ou o equivalente em R$ */
  valorDetalhe?: string;
  /** meta ou limite (sem = informativo) */
  meta?: string;
  /** origem da meta ("meta interna (fictícia)", "covenant contratual"…) */
  metaDetalhe?: string;
  /** folga até a meta ou limite: positiva = dentro, negativa = fora */
  folga?: string;
  state: ValueState;
  statusTexto: string;
  statusOrdem: number;
  tendencia?: KpiTendencia;
  rota: string;
  origem: string;
}

/** Tabela de todos os KPIs (lista em cartões abaixo de lg, como a sap.m.Table com pop-in) */
export function KpiTabela({ linhas, subtitulo }: { linhas: KpiLinha[]; subtitulo: string }) {
  const corValor = (s: ValueState) => (s === "negative" ? COR.negative : s === "critical" ? COR.critical : undefined);
  const corFolga = (s: ValueState) => (s === "negative" ? "text-negative" : s === "critical" ? "text-critical" : s === "positive" ? "text-positive" : "text-text");
  const colunas: Column<KpiLinha>[] = [
    {
      key: "kpi",
      header: "KPI",
      minWidth: 240,
      value: (k) => k.nome,
      render: (k) => (
        <div className="leading-snug py-0.5" title={k.formula}>
          <div className="font-semibold text-text">{k.nome}</div>
          <div className="text-xs text-label">{k.secao}</div>
        </div>
      ),
    },
    {
      key: "valor",
      header: "Valor",
      align: "right",
      value: (k) => k.valorOrdem,
      render: (k) => (
        <div className="leading-snug whitespace-nowrap">
          <div className="font-bold tabular" style={{ color: corValor(k.state) }}>
            {k.valor}
          </div>
          {k.valorDetalhe && <div className="text-xs text-label">{k.valorDetalhe}</div>}
        </div>
      ),
    },
    {
      key: "meta",
      header: "Meta / limite",
      value: (k) => k.meta ?? "",
      render: (k) => (
        <div className="leading-snug whitespace-nowrap">
          <div className={k.meta ? "font-semibold text-text" : "text-label"}>{k.meta ?? "—"}</div>
          <div className="text-xs text-label">{k.metaDetalhe ?? (k.meta ? "" : "sem meta · informativo")}</div>
        </div>
      ),
    },
    {
      key: "folga",
      header: "Folga",
      align: "right",
      headerTitle: "Distância até a meta ou o limite: positiva = dentro, negativa = fora",
      value: (k) => k.folga ?? "",
      render: (k) => (k.folga ? <span className={clsx("font-semibold tabular whitespace-nowrap", corFolga(k.state))}>{k.folga}</span> : <span className="text-label">—</span>),
    },
    { key: "status", header: "Status", value: (k) => k.statusOrdem, render: (k) => <ObjectStatus state={k.state}>{k.statusTexto}</ObjectStatus> },
    { key: "tendencia", header: "Tendência", value: (k) => k.tendencia?.texto ?? "", render: (k) => <KpiTendenciaTexto t={k.tendencia} /> },
    { key: "fonte", header: "Fonte", value: (k) => k.origem, render: (k) => <LinkOrigem rota={k.rota} origem={k.origem} /> },
  ];

  return (
    <Card title={`Todos os KPIs (${linhas.length})`} subtitle={subtitulo} bodyClassName="px-0 pb-0" className="min-w-0 overflow-hidden">
      <div className="hidden lg:block">
        <DataTable columns={colunas} rows={linhas} rowKey={(k) => k.id} />
      </div>
      <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
        {linhas.map((k) => (
          <li key={k.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text">{k.nome}</div>
                <div className="text-xs text-label">{k.secao}</div>
              </div>
              <div className="shrink-0">
                <ObjectStatus state={k.state}>{k.statusTexto}</ObjectStatus>
              </div>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-2.5 text-[13px]">
              <PopIn rotulo="Valor">
                <span className="font-semibold" style={{ color: corValor(k.state) }}>
                  {k.valor}
                </span>
                {k.valorDetalhe && <span className="block text-xs text-label truncate">{k.valorDetalhe}</span>}
              </PopIn>
              <PopIn rotulo="Meta / limite">{k.meta ?? "—"}</PopIn>
              <PopIn rotulo="Folga">{k.folga ?? "—"}</PopIn>
              <PopIn rotulo="Fonte">
                <LinkOrigem rota={k.rota} origem={k.origem} />
              </PopIn>
              <div className="col-span-2 sm:col-span-4 min-w-0">
                <dt className="text-xs text-label">Tendência</dt>
                <dd>
                  <KpiTendenciaTexto t={k.tendencia} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PopIn({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-label">{rotulo}</dt>
      <dd className="text-text tabular truncate">{children}</dd>
    </div>
  );
}
