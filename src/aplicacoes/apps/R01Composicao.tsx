import clsx from "clsx";
import { Database, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, Field } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, SearchField, Select } from "../../shared/components/fiori/Inputs";
import { CHART_COLORS, HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { MAPEAMENTO_R01, relatorioPorId } from "../data/catalogo";
import { EMPRESAS, type ClassificacaoCPC48 } from "../data/carteira";
import { ESCOPOS, useCarteira, type Escopo } from "../context/useDados";
import { fmtDate } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { proximaFaixaIR, taxaContratada, type Posicao } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";
import { distribuicao, totalCarteira } from "../lib/indicadores";
import { useBenchmarks } from "../context/BenchmarkContext";
import type { Benchmark } from "../data/benchmark";
import { benchmarkDaOperacao, situacaoBenchmark, SITUACAO_STATE } from "../lib/benchmark";

const rel = relatorioPorId("r01");

export const CPC48_STATE: Record<ClassificacaoCPC48, ValueState> = {
  "Custo Amortizado": "information",
  "VJ por ORA": "neutral",
  "VJ por Resultado": "critical",
};

const TODOS = "__todos";

export function R01Composicao() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, posicoes } = useCarteira(escopo);
  const [busca, setBusca] = useState("");
  const [produto, setProduto] = useState(TODOS);
  const [indexador, setIndexador] = useState(TODOS);
  const [cpc, setCpc] = useState(TODOS);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const { cadastro } = useBenchmarks();
  const bmk = (x: Posicao) => benchmarkDaOperacao(x.op, cadastro, p.dataBase)?.pctCDI ?? 1;

  const opcoes = (fn: (x: Posicao) => string) =>
    [{ value: TODOS, label: "Todos" }, ...[...new Set(posicoes.map(fn))].sort().map((v) => ({ value: v, label: v }))];

  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return posicoes.filter(
      (x) =>
        (produto === TODOS || x.op.produto === produto) &&
        (indexador === TODOS || x.op.indexador === indexador) &&
        (cpc === TODOS || x.op.cpc48 === cpc) &&
        (!t || [x.op.transacao, x.op.contraparte, x.op.produto, x.op.portfolio].some((s) => s.toLowerCase().includes(t))),
    );
  }, [posicoes, busca, produto, indexador, cpc]);

  const sel = linhas.find((x) => x.op.transacao === selecionada) ?? null;
  const soma = (fn: (x: Posicao) => number) => linhas.reduce((s, x) => s + fn(x), 0);
  const filtrosAtivos = [produto, indexador, cpc].filter((f) => f !== TODOS).length + (busca ? 1 : 0);

  const colunas: Column<Posicao>[] = [
    {
      key: "transacao",
      header: "Transação",
      sticky: true,
      value: (x) => x.op.transacao,
      render: (x) => (
        <div>
          <div className="font-semibold text-link tabular">{x.op.transacao}</div>
          <div className="text-xs text-label">{x.op.empresa}</div>
        </div>
      ),
      total: () => <span>Total ({linhas.length})</span>,
    },
    {
      key: "contraparte",
      header: "Parceiro de Negócio",
      minWidth: 180,
      value: (x) => x.op.contraparte,
      render: (x) => (
        <div>
          <div className="font-semibold text-text">{x.op.contraparte}</div>
          <div className="text-xs text-label">{x.op.portfolio}</div>
        </div>
      ),
    },
    {
      key: "produto",
      header: "Produto",
      value: (x) => x.op.produto,
      render: (x) => (
        <div>
          <div className="text-text">{x.op.produto}</div>
          <div className="text-xs text-label">{x.op.indexador}</div>
        </div>
      ),
    },
    { key: "taxa", header: "Taxa contratada", value: (x) => x.op.taxa, render: (x) => <span className="whitespace-nowrap">{taxaContratada(x.op)}</span> },
    {
      key: "bmk",
      header: "Benchmark",
      headerTitle: "Benchmark cadastrado (% do CDI) × rentabilidade realizada desde a aplicação",
      align: "right",
      value: (x) => x.pctCDI - bmk(x),
      render: (x) => {
        const b = bmk(x);
        const sit = situacaoBenchmark(x.pctCDI, b);
        return (
          <div className="whitespace-nowrap">
            <div>{fmtDec(b * 100, 1)}% CDI</div>
            <div className={clsx("text-xs", sit === "abaixo" ? "text-critical font-semibold" : sit === "acima" ? "text-positive" : "text-label")}>
              Realizado {fmtDec(x.pctCDI * 100, 1)}%
            </div>
          </div>
        );
      },
    },
    { key: "aplicacao", header: "Aplicação", align: "right", value: (x) => x.op.dataAplicacao, render: (x) => fmtDate(x.op.dataAplicacao) },
    {
      key: "vencimento",
      header: "Vencimento",
      align: "right",
      value: (x) => x.op.dataVencimento ?? "9999",
      render: (x) =>
        x.op.dataVencimento ? (
          <div>
            <div>{fmtDate(x.op.dataVencimento)}</div>
            <div className={clsx("text-xs", x.prazoRemanescente! <= 30 ? "text-critical font-semibold" : "text-label")}>
              {x.prazoRemanescente} dias
            </div>
          </div>
        ) : (
          <span className="text-label">Liquidez diária</span>
        ),
    },
    { key: "principal", header: "Valor principal", align: "right", value: (x) => x.op.principal, render: (x) => fmtNum(x.op.principal), total: (r) => fmtNum(r.reduce((s, x) => s + x.op.principal, 0)) },
    { key: "juros", header: "Juros provisionados", align: "right", value: (x) => x.rendimento, render: (x) => fmtNum(x.rendimento), total: (r) => fmtNum(r.reduce((s, x) => s + x.rendimento, 0)) },
    {
      key: "ir",
      header: "IR s/ rendimento",
      align: "right",
      value: (x) => x.ir,
      render: (x) => (
        <div>
          <div>{fmtNum(x.ir)}</div>
          <div className="text-xs text-label">{x.op.regimeIR === "15% fixo" ? "15% fixo" : fmtPct(x.aliqIR, 1)}</div>
        </div>
      ),
      total: (r) => fmtNum(r.reduce((s, x) => s + x.ir, 0)),
    },
    {
      key: "iof",
      header: "IOF",
      align: "right",
      value: (x) => x.iof,
      render: (x) =>
        x.iof > 0 ? (
          <div>
            <div className="text-critical font-semibold">{fmtNum(x.iof)}</div>
            <div className="text-xs text-critical">{fmtPct(x.aliqIOF, 0)}</div>
          </div>
        ) : (
          <span className="text-label">–</span>
        ),
      total: (r) => fmtNum(r.reduce((s, x) => s + x.iof, 0)),
    },
    { key: "liquido", header: "Valor líquido", align: "right", value: (x) => x.valorLiquido, render: (x) => <span className="font-semibold">{fmtNum(x.valorLiquido)}</span>, total: (r) => fmtNum(r.reduce((s, x) => s + x.valorLiquido, 0)) },
    { key: "vj", header: "Valor justo (R$)", align: "right", value: (x) => x.valorJusto, render: (x) => fmtNum(x.valorJusto), total: (r) => fmtNum(r.reduce((s, x) => s + x.valorJusto, 0)) },
    {
      key: "cpc",
      header: "Classificação CPC 48",
      value: (x) => x.op.cpc48,
      render: (x) => (
        <ObjectStatus inverted icon={false} state={CPC48_STATE[x.op.cpc48]}>
          {x.op.cpc48}
        </ObjectStatus>
      ),
    },
    {
      key: "cp",
      header: "Circulante",
      align: "center",
      value: (x) => (x.circulante ? "CP" : "LP"),
      render: (x) => <Tag>{x.circulante ? "CP" : "LP"}</Tag>,
    },
  ];

  const exportar = () =>
    exportarExcel(
      `R01_Composicao_Detalhada_${p.dataBase}.xlsx`,
      [
        {
          nome: "R01 - Composição",
          titulo: "RELATÓRIO 01 – Composição Detalhada das Aplicações Financeiras",
          subtitulo: `${ESCOPOS.find((e) => e.value === escopo)!.label} · Valores em R$`,
          colunas: [
            { titulo: "Empresa", largura: 12 },
            { titulo: "Transação", largura: 12 },
            { titulo: "Parceiro de Negócio", largura: 26 },
            { titulo: "Tipo de Produto", largura: 18 },
            { titulo: "Indexador", largura: 10 },
            { titulo: "Taxa Contratada", largura: 16 },
            { titulo: "Benchmark (% CDI)", tipo: "decimal", largura: 14 },
            { titulo: "Realizado desde a aplicação (% CDI)", tipo: "decimal", largura: 18 },
            { titulo: "Portfolio", largura: 14 },
            { titulo: "Calendário", largura: 10 },
            { titulo: "Data Aplicação", tipo: "data", largura: 14 },
            { titulo: "Data Vencimento", tipo: "data", largura: 14 },
            { titulo: "Valor Principal", tipo: "moeda" },
            { titulo: "Juros Provisionados", tipo: "moeda" },
            { titulo: "IR s/ Rendimento", tipo: "moeda" },
            { titulo: "IOF", tipo: "moeda" },
            { titulo: "Valor Líquido", tipo: "moeda" },
            { titulo: "Valor Justo (R$)", tipo: "moeda" },
            { titulo: "Classificação CPC 48", largura: 20 },
          ],
          linhas: linhas.map((x) => [
            x.op.empresa,
            x.op.transacao,
            x.op.contraparte,
            x.op.produto,
            x.op.indexador,
            taxaContratada(x.op),
            bmk(x) * 100,
            x.pctCDI * 100,
            x.op.portfolio,
            x.op.calendario,
            x.op.dataAplicacao,
            x.op.dataVencimento ?? "",
            x.op.principal,
            x.rendimento,
            x.ir,
            x.iof,
            x.valorLiquido,
            x.valorJusto,
            x.op.cpc48,
          ]),
          total: ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", soma((x) => x.op.principal), soma((x) => x.rendimento), soma((x) => x.ir), soma((x) => x.iof), soma((x) => x.valorLiquido), soma((x) => x.valorJusto), ""],
          notas: [
            "(i) Para Pessoa Jurídica, LCI/LCA/CRI/CRA sofrem IRRF regressivo (antecipação compensável com IRPJ).",
            "(ii) Valor Líquido = Valor Principal + Juros Provisionados − IR − IOF.",
            "(iii) Valor justo: valor na curva ajustado a mercado.",
            "(iv) Classificação conforme CPC 48: Custo Amortizado, VJ por ORA ou VJ por Resultado.",
            "(v) Benchmark conforme o cadastro de benchmark em % do CDI (regra mais específica: produto > portfolio > empresa > carteira).",
          ],
        },
      ],
      p.dataBase,
    );

  const porProduto = distribuicao(linhas, (x) => x.op.produto);
  const porCpc = distribuicao(linhas, (x) => x.op.cpc48);
  const total = totalCarteira(linhas);

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Valor principal" value={fmtCompact(soma((x) => x.op.principal))} />
          <HeaderKpi label="Juros provisionados" value={fmtCompact(soma((x) => x.rendimento))} state="positive" />
          <HeaderKpi label="Valor líquido" value={fmtCompact(soma((x) => x.valorLiquido))} />
          <HeaderKpi label="Valor justo" value={fmtCompact(soma((x) => x.valorJusto))} sub={`Ajuste ${fmtCompact(soma((x) => x.ajusteVJ))}`} />
        </>
      }
    >
      {/* Filter bar */}
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <FilterField label="Empresa">
            <Select value={escopo} onChange={(v) => { setEscopo(v); setSelecionada(null); }} options={ESCOPOS} />
          </FilterField>
          <FilterField label="Tipo de produto">
            <Select value={produto} onChange={setProduto} options={opcoes((x) => x.op.produto)} />
          </FilterField>
          <FilterField label="Indexador">
            <Select value={indexador} onChange={setIndexador} options={opcoes((x) => x.op.indexador)} />
          </FilterField>
          <FilterField label="Classificação CPC 48">
            <Select value={cpc} onChange={setCpc} options={opcoes((x) => x.op.cpc48)} />
          </FilterField>
          <FilterField label="Pesquisa">
            <SearchField value={busca} onChange={setBusca} placeholder="Transação, parceiro, portfolio" />
          </FilterField>
        </div>
        {filtrosAtivos > 0 && (
          <div className="flex items-center justify-between mt-2 text-[13px]">
            <span className="text-label">
              {filtrosAtivos} filtro(s) ativo(s) · {linhas.length} de {posicoes.length} operações
            </span>
            <button
              type="button"
              className="text-link font-semibold hover:underline"
              onClick={() => {
                setBusca("");
                setProduto(TODOS);
                setIndexador(TODOS);
                setCpc(TODOS);
              }}
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      <div className={clsx("grid gap-5", sel ? "lg:grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-1")}>
        <Card
          title={`Operações (${linhas.length})`}
          subtitle="Clique em uma linha para ver o detalhe da operação"
          bodyClassName="px-0 pb-0"
          className="min-w-0 overflow-hidden"
        >
          <DataTable
            columns={colunas}
            rows={linhas}
            rowKey={(x) => x.op.transacao}
            onRowClick={(x) => setSelecionada(x.op.transacao === selecionada ? null : x.op.transacao)}
            selectedKey={selecionada}
            showTotals
            defaultSort={{ key: "principal", dir: "desc" }}
          />
        </Card>
        {sel && <DetalheOperacao pos={sel} benchmark={benchmarkDaOperacao(sel.op, cadastro, p.dataBase)} onClose={() => setSelecionada(null)} />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Composição por tipo de produto" subtitle={`Saldo bruto · ${fmtCompact(total)}`}>
          <ul className="space-y-2.5">
            {porProduto.map((f, i) => (
              <li key={f.chave} className="grid grid-cols-[9rem_1fr_6.5rem] items-center gap-3 text-[13px]">
                <span className="text-text font-semibold truncate">{f.chave}</span>
                <MicroBar value={f.share} max={porProduto[0]?.share || 1} color={CHART_COLORS[i % CHART_COLORS.length]} className="h-2" />
                <span className="tabular text-right text-text">
                  {fmtPct(f.share, 1)} <span className="text-label">· {f.qtd}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Classificação contábil (CPC 48)" subtitle="Base de mensuração dos ativos financeiros">
          <div className="flex h-3 rounded-full overflow-hidden mb-4">
            {porCpc.map((f) => (
              <div
                key={f.chave}
                style={{ width: `${f.share * 100}%`, backgroundColor: f.chave === "Custo Amortizado" ? "#0070f2" : f.chave === "VJ por ORA" ? "#788fa6" : "#e76500" }}
                title={f.chave}
              />
            ))}
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {porCpc.map((f) => (
              <li key={f.chave} className="rounded-lg bg-[#f5f6f7] px-3 py-2">
                <div className="text-xs text-label">{f.chave}</div>
                <div className="text-lg font-bold text-text tabular">{fmtPct(f.share, 1)}</div>
                <div className="text-xs text-label tabular">
                  {fmtCompact(f.valor)} · {f.qtd} op.
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-label mt-3">
            Custo amortizado: mensurado na curva. VJORA: marcação a mercado no PL (ORA). VJR: marcação a mercado no resultado.
          </p>
        </Card>
      </div>

      <MessageStrip>
        Para Pessoa Jurídica, a isenção de IR de LCI/LCA/CRI/CRA não se aplica – o IRRF é antecipação compensável com
        IRPJ. Valor líquido = principal + juros provisionados − IR − IOF.
      </MessageStrip>
    </ReportPage>
  );
}

function DetalheOperacao({ pos, benchmark, onClose }: { pos: Posicao; benchmark: Benchmark | null; onClose: () => void }) {
  const { op } = pos;
  const prox = proximaFaixaIR(pos.diasCorridos, op.regimeIR);
  const mapa = MAPEAMENTO_R01.filter((m) => m.visao);
  const valorCampo: Record<string, string> = {
    ID01: `${op.empresa} – ${EMPRESAS[op.empresa].nome}`,
    ID02: op.transacao,
    ID03: op.contraparte,
    ID04: op.produto,
    ID05: op.indexador,
    ID06: taxaContratada(op),
    ID08: op.portfolio,
    ID09: op.calendario,
    ID10: fmtDate(op.dataAplicacao),
    ID11: fmtDate(op.dataVencimento),
    ID12: fmtBRL(op.principal, true),
  };
  return (
    <aside className="bg-white rounded-[var(--radius-card)] shadow-fiori-lg lg:shadow-fiori overflow-hidden self-start flex flex-col fixed inset-x-4 bottom-4 top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 lg:sticky lg:inset-auto lg:top-[4.25rem] lg:z-auto lg:max-h-[calc(100vh-5.5rem)]">
      <header className="px-4 pt-3.5 pb-3 border-b border-line-soft">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-label">Transação {op.transacao}</div>
            <h3 className="text-lg font-bold text-text leading-snug">
              {op.produto} · {op.contraparte}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-link hover:bg-hover" aria-label="Fechar detalhe">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <ObjectStatus inverted icon={false} state={CPC48_STATE[op.cpc48]}>
            {op.cpc48}
          </ObjectStatus>
          <Tag>{pos.circulante ? "Circulante" : "Não circulante"}</Tag>
          <Tag>Rating {op.rating}</Tag>
          {pos.iof > 0 && (
            <ObjectStatus inverted state="critical">
              IOF {fmtPct(pos.aliqIOF, 0)}
            </ObjectStatus>
          )}
        </div>
      </header>

      <div className="overflow-y-auto fiori-scroll px-4 py-4 space-y-5">
        <section>
          <h4 className="text-sm font-bold text-text mb-2">Valores na data-base</h4>
          <dl className="space-y-1.5 text-[13px]">
            <Linha label="Valor principal" valor={fmtBRL(op.principal, true)} />
            <Linha label={`Juros provisionados (fator ${fmtDec(pos.fator, 6)})`} valor={fmtBRL(pos.rendimento, true)} cor="text-positive" />
            <Linha label={`IOF (${fmtPct(pos.aliqIOF, 0)})`} valor={`− ${fmtBRL(pos.iof, true)}`} />
            <Linha label={`IR (${op.regimeIR === "15% fixo" ? "15% fixo" : fmtPct(pos.aliqIR, 1)})`} valor={`− ${fmtBRL(pos.ir, true)}`} />
            <div className="border-t border-line-soft pt-1.5">
              <Linha label="Valor líquido" valor={fmtBRL(pos.valorLiquido, true)} forte />
            </div>
            <Linha label="Valor justo" valor={fmtBRL(pos.valorJusto, true)} />
            <Linha label="Ajuste a valor justo" valor={fmtBRL(pos.ajusteVJ, true)} cor={pos.ajusteVJ >= 0 ? "text-positive" : "text-negative"} />
          </dl>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Prazo e tributação</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dias corridos">{pos.diasCorridos}</Field>
            <Field label="Prazo remanescente">{pos.prazoRemanescente === null ? "Liquidez diária" : `${pos.prazoRemanescente} dias`}</Field>
            <Field label="Taxa efetiva (a.a.)">{fmtPct(pos.taxaEfetivaAA)}</Field>
            <Field label="Rentab. desde a aplicação">{`${fmtDec(pos.pctCDI * 100, 1)}% CDI`}</Field>
            <Field label="Benchmark">{`${fmtDec((benchmark?.pctCDI ?? 1) * 100, 1)}% CDI`}</Field>
            <Field label="Versus benchmark">
              <ObjectStatus state={SITUACAO_STATE[situacaoBenchmark(pos.pctCDI, benchmark?.pctCDI ?? 1)]}>
                {`${pos.pctCDI - (benchmark?.pctCDI ?? 1) >= 0 ? "+" : ""}${fmtDec((pos.pctCDI - (benchmark?.pctCDI ?? 1)) * 100, 1)} p.p.`}
              </ObjectStatus>
            </Field>
            <Field label="Regime de IR">{op.regimeIR}</Field>
            <Field label="Próxima faixa IR">{prox ? `${fmtPct(prox.aliquota, 1)} em ${prox.aPartirDe - pos.diasCorridos} dias` : "—"}</Field>
            <Field label="Liquidez">{op.liquidez}</Field>
            <Field label="Faixa de prazo">{pos.faixaPrazo}</Field>
          </div>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2 flex items-center gap-1.5">
            <Database className="w-4 h-4 text-[#5d36ff]" /> Origem no SAP (CDS Views)
          </h4>
          <ul className="divide-y divide-line-soft rounded-lg border border-line-soft">
            {mapa.map((m) => (
              <li key={m.id} className="px-3 py-1.5 flex items-center justify-between gap-3 text-[13px]">
                <div className="min-w-0">
                  <div className="text-label text-xs">{m.coluna}</div>
                  <div className="font-mono text-[11px] text-[#5d36ff] truncate">
                    {m.visao}.{m.campo}
                  </div>
                </div>
                <span className="text-text font-semibold text-right truncate max-w-[45%]">{valorCampo[m.id]}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

function Linha({ label, valor, forte, cor }: { label: string; valor: string; forte?: boolean; cor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-label">{label}</dt>
      <dd className={clsx("tabular whitespace-nowrap", forte ? "font-bold text-text text-sm" : "text-text", cor)}>{valor}</dd>
    </div>
  );
}
