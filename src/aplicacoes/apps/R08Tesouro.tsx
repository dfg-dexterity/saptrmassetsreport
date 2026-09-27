import clsx from "clsx";
import { CheckCircle2, Lock, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Field } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { FONTES_SAP, IMPORTACAO_SAP, ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import { EMPRESAS } from "../../shared/data/empresas";
import { addMonths, fmtDate, fmtMonthLong, fmtMonthShort, lastMonthEnds, previousMonthEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtInt, fmtNum, fmtPct } from "../../shared/lib/format";
import { relatorioPorId } from "../data/catalogo";
import type { ClassificacaoCPC48 } from "../data/carteira";
import { PARAMETROS_TESOURO, TIPOS_TITULO, TITULOS, type TituloPublico } from "../data/tesouro";
import { ALIQUOTA_IRPJ_CSLL } from "../data/tributacao";
import { ESCOPOS, useMestre, type Escopo } from "../context/useDados";
import { somaMestre, taxaTituloTexto } from "../lib/carteiraMestre";
import { aliquotaIR } from "../lib/finance";
import { eventosTitulo, posicaoTitulo, taxaMercado, vnaLFT, vnaNTNB, type EventoTitulo, type PosicaoTitulo } from "../lib/tesouro";

const rel = relatorioPorId("r08");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

const COR_CURVA = "#168eff";
const COR_MERCADO = "#049f9a";
const COR_CUPOM = "#049f9a";
const COR_VENCIMENTO = "#c87b00";

const CPC48_STATE: Record<ClassificacaoCPC48, ValueState> = {
  "Custo Amortizado": "information",
  "VJ por ORA": "neutral",
  "VJ por Resultado": "critical",
};

// ---------------------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------------------

function infoTipo(t: TituloPublico) {
  return TIPOS_TITULO.find((x) => x.tipo === t.tipo)!;
}

/** Taxa indicativa de mercado (ANBIMA) no mesmo formato da taxa de compra */
function taxaMercadoTexto(t: TituloPublico, taxa: number): string {
  if (t.indexador === "Selic") return `Selic ${taxa >= 0 ? "+" : "−"} ${fmtDec(Math.abs(taxa) * 100, 4)}%`;
  if (t.indexador === "IPCA") return `IPCA + ${fmtDec(taxa * 100, 2)}%`;
  return `${fmtDec(taxa * 100, 2)}% a.a.`;
}

function rotuloIndexador(t: TituloPublico): string {
  return t.indexador === "Selic" ? "Pós-fixado (Selic)" : t.indexador === "IPCA" ? "Híbrido (IPCA + taxa real)" : "Prefixado";
}

/** Variação em pontos-base com sinal */
function bps(de: number, para: number): string {
  const v = Math.round((para - de) * 10_000 * 10) / 10;
  if (v === 0) return "0 bps";
  return `${v > 0 ? "+" : "−"}${fmtDec(Math.abs(v), Number.isInteger(v) ? 0 : 1)} bps`;
}

/** Valor com sinal explícito (+/−) */
function comSinal(v: number, fmt: (v: number) => string): string {
  return Math.round(v) > 0 ? `+${fmt(v)}` : fmt(v);
}

const corSinal = (v: number) => (Math.round(v) > 0 ? "text-positive" : Math.round(v) < 0 ? "text-negative" : "text-label");

function fmtEixo(v: number): string {
  if (Math.abs(v) >= 1e6) return `${fmtDec(v / 1e6, 1)} mi`;
  if (Math.abs(v) >= 1e3) return `${fmtDec(v / 1e3, 0)} mil`;
  return fmtDec(v, 0);
}

function mesesDesde(inicio: string, fim: string): number {
  return (Number(fim.slice(0, 4)) - Number(inicio.slice(0, 4))) * 12 + (Number(fim.slice(5, 7)) - Number(inicio.slice(5, 7))) + 1;
}

interface EventoCarteira {
  t: TituloPublico;
  e: EventoTitulo;
  realizado: boolean;
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function R08Tesouro() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, contratos } = useMestre(escopo);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const d = useMemo(() => {
    const titulos = TITULOS.filter((t) => escopo === "todas" || t.empresa === escopo);
    const posicoes = titulos.map((t) => posicaoTitulo(t, p.dataBase, p)).filter((x) => x.ativo);
    const eventos: EventoCarteira[] = titulos
      .flatMap((t) => eventosTitulo(t, p).map((e) => ({ t, e, realizado: e.data <= p.dataBase })))
      .sort((a, b) => a.e.data.localeCompare(b.e.data) || a.t.id.localeCompare(b.t.id));
    const soma = (fn: (x: PosicaoTitulo) => number) => posicoes.reduce((s, x) => s + fn(x), 0);
    const curva = soma((x) => x.saldoCurva);
    const mercado = soma((x) => x.saldoMercado);
    const duration = mercado > 0 ? soma((x) => x.duration * x.saldoMercado) / mercado : 0;
    const ano = p.dataBase.slice(0, 4);
    const cuponsAno = eventos.filter((x) => x.e.tipo === "Cupom" && x.realizado && x.e.data >= `${ano}-01-01`);
    // Conferência com a Carteira-Mestre (base consolidada)
    const mestre = contratos.filter((c) => c.tipo === "Tesouro Direto");
    return {
      titulos,
      posicoes,
      eventos,
      soma,
      curva,
      mercado,
      mtm: mercado - curva,
      contabil: soma((x) => x.valorContabil),
      duration,
      ano,
      cuponsAno: { bruto: cuponsAno.reduce((s, x) => s + x.e.bruto, 0), ir: cuponsAno.reduce((s, x) => s + x.e.ir, 0), qtd: cuponsAno.length },
      mestre: { curva: somaMestre(mestre, "saldoCurva"), contabil: somaMestre(mestre, "valorContabil"), qtd: mestre.length },
    };
  }, [escopo, p, contratos]);

  const sel = d.posicoes.find((x) => x.t.id === selecionado) ?? null;
  const concilia = Math.abs(d.mestre.curva - d.curva) < 1 && Math.abs(d.mestre.contabil - d.contabil) < 1 && d.mestre.qtd === d.posicoes.length;
  const mesTaxas = fmtMonthLong(p.dataBase);

  const colunas: Column<PosicaoTitulo>[] = [
    {
      key: "codigo",
      header: "Código",
      sticky: true,
      value: (x) => x.t.id,
      render: (x) => (
        <div>
          <div className="font-semibold text-link tabular">{x.t.id}</div>
          <div className="text-xs text-label">Empresa {x.t.empresa}</div>
        </div>
      ),
      total: (r) => <span>Total ({r.length})</span>,
    },
    {
      key: "titulo",
      header: "Título",
      minWidth: 220,
      value: (x) => x.t.nome,
      render: (x) => (
        <div>
          <div className="font-semibold text-text">{x.t.nome}</div>
          <div className="text-xs text-label">
            {x.t.tipo} · SELIC {infoTipo(x.t).codigoSelic}
          </div>
        </div>
      ),
    },
    {
      key: "taxa",
      header: "Taxa de compra",
      value: (x) => x.t.taxaCompra,
      render: (x) => (
        <div className="whitespace-nowrap">
          <div className="text-text">{taxaTituloTexto(x.t)}</div>
          <div className="text-xs text-label">{rotuloIndexador(x.t)}</div>
        </div>
      ),
    },
    { key: "compra", header: "Compra", align: "right", value: (x) => x.t.dataCompra, render: (x) => fmtDate(x.t.dataCompra) },
    {
      key: "vencimento",
      header: "Vencimento",
      align: "right",
      value: (x) => x.t.vencimento,
      render: (x) => (
        <div>
          <div>{fmtDate(x.t.vencimento)}</div>
          <div className="text-xs text-label">{fmtInt(x.prazoRemanescente)} dias</div>
        </div>
      ),
    },
    { key: "qtd", header: "Quantidade", align: "right", value: (x) => x.t.quantidade, render: (x) => fmtInt(x.t.quantidade) },
    { key: "puCompra", header: "PU de compra", align: "right", value: (x) => x.puCompra, render: (x) => fmtDec(x.puCompra, 2) },
    {
      key: "taxaMercado",
      header: "Taxa ANBIMA",
      headerTitle: `Taxa indicativa de mercado ANBIMA de ${mesTaxas}, importada do SAP (após a data-base, último dado disponível)`,
      align: "right",
      value: (x) => x.taxaMercado - x.t.taxaCompra,
      render: (x) => (
        <div>
          <div>{taxaMercadoTexto(x.t, x.taxaMercado)}</div>
          <div className="text-xs text-label">{bps(x.t.taxaCompra, x.taxaMercado)} vs compra</div>
        </div>
      ),
    },
    { key: "puCurva", header: "PU curva", align: "right", value: (x) => x.puCurva, render: (x) => fmtDec(x.puCurva, 2) },
    { key: "puMercado", header: "PU mercado", align: "right", value: (x) => x.puMercado, render: (x) => fmtDec(x.puMercado, 2) },
    { key: "curva", header: "Saldo curva", align: "right", value: (x) => x.saldoCurva, render: (x) => fmtNum(x.saldoCurva), total: (r) => fmtNum(r.reduce((s, x) => s + x.saldoCurva, 0)) },
    { key: "mercado", header: "Saldo mercado", align: "right", value: (x) => x.saldoMercado, render: (x) => fmtNum(x.saldoMercado), total: (r) => fmtNum(r.reduce((s, x) => s + x.saldoMercado, 0)) },
    {
      key: "mtm",
      header: "MTM",
      headerTitle: "Marcação a mercado: saldo a mercado − saldo na curva",
      align: "right",
      value: (x) => x.mtm,
      render: (x) => (
        <div>
          <div className={clsx("font-semibold", corSinal(x.mtm))}>{comSinal(x.mtm, fmtNum)}</div>
          <div className="text-xs text-label">{comSinal(x.saldoCurva ? x.mtm / x.saldoCurva : 0, (v) => fmtPct(v, 2))}</div>
        </div>
      ),
      total: (r) => {
        const v = r.reduce((s, x) => s + x.mtm, 0);
        return <span className={corSinal(v)}>{comSinal(v, fmtNum)}</span>;
      },
    },
    {
      key: "cupons",
      header: "Cupons recebidos",
      headerTitle: "Cupons brutos recebidos desde a compra",
      align: "right",
      value: (x) => x.cuponsRecebidos,
      render: (x) => (x.cuponsRecebidos > 0 ? fmtNum(x.cuponsRecebidos) : <span className="text-label">–</span>),
      total: (r) => fmtNum(r.reduce((s, x) => s + x.cuponsRecebidos, 0)),
    },
    {
      key: "ir",
      header: "IR",
      headerTitle: "IRRF retido nos cupons + provisão sobre o rendimento na curva (tabela regressiva)",
      align: "right",
      value: (x) => x.ir,
      render: (x) => (
        <div>
          <div>{fmtNum(x.ir)}</div>
          <div className="text-xs text-label">
            {x.irCupons > 0 ? `retido ${fmtNum(x.irCupons)}` : `alíq. ${fmtPct(aliquotaIR(x.diasCorridos, "Regressivo"), 1)}`}
          </div>
        </div>
      ),
      total: (r) => fmtNum(r.reduce((s, x) => s + x.ir, 0)),
    },
    {
      key: "taxas",
      header: "Custódia + agente",
      headerTitle: `Custódia B3 (${fmtPct(PARAMETROS_TESOURO.custodiaB3)} a.a.) + taxa do agente (${fmtPct(PARAMETROS_TESOURO.taxaAgente)} a.a.) acumuladas desde a compra`,
      align: "right",
      value: (x) => x.taxas,
      render: (x) => fmtNum(x.taxas),
      total: (r) => fmtNum(r.reduce((s, x) => s + x.taxas, 0)),
    },
    {
      key: "liquido",
      header: "Rendimento líquido",
      headerTitle: "Saldo na curva + cupons recebidos − valor de compra − IOF − IR − custódia/agente",
      align: "right",
      value: (x) => x.rendimentoLiquido,
      render: (x) => <span className="font-semibold">{fmtNum(x.rendimentoLiquido)}</span>,
      total: (r) => fmtNum(r.reduce((s, x) => s + x.rendimentoLiquido, 0)),
    },
    {
      key: "cpc",
      header: "CPC 48",
      value: (x) => x.t.cpc48,
      render: (x) => (
        <ObjectStatus inverted icon={false} state={CPC48_STATE[x.t.cpc48]}>
          {x.t.cpc48}
        </ObjectStatus>
      ),
    },
    {
      key: "contabil",
      header: "Valor contábil",
      headerTitle: "Curva (custo amortizado) ou mercado (VJ por ORA / VJ por resultado)",
      align: "right",
      value: (x) => x.valorContabil,
      render: (x) => <span className="font-semibold">{fmtNum(x.valorContabil)}</span>,
      total: (r) => fmtNum(r.reduce((s, x) => s + x.valorContabil, 0)),
    },
    {
      key: "duration",
      header: "Duration",
      headerTitle: "Duration de Macaulay em anos (dias úteis ÷ 252) à taxa de mercado; total ponderado pelo saldo a mercado",
      align: "right",
      value: (x) => x.duration,
      render: (x) => `${fmtDec(x.duration, 2)} anos`,
      total: (r) => {
        const m = r.reduce((s, x) => s + x.saldoMercado, 0);
        return `${fmtDec(m ? r.reduce((s, x) => s + x.duration * x.saldoMercado, 0) / m : 0, 2)} anos`;
      },
    },
    {
      key: "proximo",
      header: "Próximo evento",
      align: "right",
      value: (x) => x.proximoCupom?.data ?? "9999",
      render: (x) =>
        x.proximoCupom ? (
          <div>
            <div>{fmtDate(x.proximoCupom.data)}</div>
            <div className="text-xs text-label">
              {x.proximoCupom.tipo} · {fmtCompact(x.proximoCupom.bruto)}
            </div>
          </div>
        ) : (
          <span className="text-label">–</span>
        ),
    },
  ];

  const exportar = () =>
    exportarExcel(
      `R08_Tesouro_Direto_${p.dataBase}.xlsx`,
      [
        {
          nome: "R08 - Posições",
          titulo: "RELATÓRIO 08 – Tesouro Direto (títulos públicos federais)",
          subtitulo: `${ESCOPOS.find((e) => e.value === escopo)!.label} · Valores em R$ · taxas indicativas ANBIMA de ${mesTaxas}`,
          colunas: [
            { titulo: "Código", largura: 8 },
            { titulo: "Transação SAP", largura: 12 },
            { titulo: "Empresa", largura: 9 },
            { titulo: "Título", largura: 36 },
            { titulo: "Tipo", largura: 14 },
            { titulo: "Código SELIC", largura: 11 },
            { titulo: "Indexador", largura: 10 },
            { titulo: "Taxa de compra", largura: 16 },
            { titulo: "Data de compra", tipo: "data", largura: 13 },
            { titulo: "Vencimento", tipo: "data", largura: 13 },
            { titulo: "Quantidade", tipo: "inteiro", largura: 11 },
            { titulo: "PU de compra", tipo: "decimal", largura: 14 },
            { titulo: "Valor de compra", tipo: "moeda" },
            { titulo: "Taxa ANBIMA (% a.a.)", tipo: "decimal", largura: 14 },
            { titulo: "PU curva", tipo: "decimal", largura: 14 },
            { titulo: "PU mercado", tipo: "decimal", largura: 14 },
            { titulo: "Saldo curva", tipo: "moeda" },
            { titulo: "Saldo mercado", tipo: "moeda" },
            { titulo: "MTM (mercado − curva)", tipo: "moeda" },
            { titulo: "Cupons recebidos (bruto)", tipo: "moeda" },
            { titulo: "IR retido nos cupons", tipo: "moeda" },
            { titulo: "IR total (retido + provisão)", tipo: "moeda" },
            { titulo: "IOF", tipo: "moeda" },
            { titulo: "Custódia B3 + agente", tipo: "moeda" },
            { titulo: "Rendimento bruto", tipo: "moeda" },
            { titulo: "Rendimento líquido", tipo: "moeda" },
            { titulo: "Classificação CPC 48", largura: 18 },
            { titulo: "Valor contábil", tipo: "moeda" },
            { titulo: "Duration (anos)", tipo: "decimal", largura: 11 },
            { titulo: "VNA na data-base", tipo: "decimal", largura: 14 },
            { titulo: "Custodiante", largura: 26 },
            { titulo: "Portfolio", largura: 14 },
            { titulo: "Próximo evento", tipo: "data", largura: 13 },
            { titulo: "Tipo do próximo evento", largura: 12 },
            { titulo: "Valor bruto do próximo evento", tipo: "moeda" },
          ],
          linhas: d.posicoes.map((x) => [
            x.t.id,
            x.t.transacao,
            x.t.empresa,
            x.t.nome,
            x.t.tipo,
            infoTipo(x.t).codigoSelic,
            x.t.indexador,
            taxaTituloTexto(x.t),
            x.t.dataCompra,
            x.t.vencimento,
            x.t.quantidade,
            x.puCompra,
            x.valorCompra,
            x.taxaMercado * 100,
            x.puCurva,
            x.puMercado,
            x.saldoCurva,
            x.saldoMercado,
            x.mtm,
            x.cuponsRecebidos,
            x.irCupons,
            x.ir,
            x.iof,
            x.taxas,
            x.rendimentoBruto,
            x.rendimentoLiquido,
            x.t.cpc48,
            x.valorContabil,
            x.duration,
            x.vna ?? "",
            x.t.custodiante,
            x.t.portfolio,
            x.proximoCupom?.data ?? "",
            x.proximoCupom?.tipo ?? "",
            x.proximoCupom?.bruto ?? "",
          ]),
          total: [
            "TOTAL",
            "", "", "", "", "", "", "", "", "", "", "",
            d.soma((x) => x.valorCompra),
            "", "", "",
            d.curva,
            d.mercado,
            d.mtm,
            d.soma((x) => x.cuponsRecebidos),
            d.soma((x) => x.irCupons),
            d.soma((x) => x.ir),
            d.soma((x) => x.iof),
            d.soma((x) => x.taxas),
            d.soma((x) => x.rendimentoBruto),
            d.soma((x) => x.rendimentoLiquido),
            "",
            d.contabil,
            d.duration,
            "", "", "", "", "", "",
          ],
          notas: [
            "(i) Curva: PU à taxa de compra; mercado: PU à taxa indicativa ANBIMA do mês, importada do SAP (após a data-base, último dado disponível).",
            "(ii) MTM = saldo a mercado − saldo na curva. Valor contábil (CPC 48): curva no custo amortizado; mercado no VJ por ORA e no VJ por resultado.",
            "(iii) IR: IRRF retido na fonte sobre os cupons + provisão sobre o rendimento na curva (tabela regressiva; para PJ, antecipação compensável com o IRPJ).",
            `(iv) Custódia B3 (${fmtPct(PARAMETROS_TESOURO.custodiaB3)} a.a.) e taxa do agente (${fmtPct(PARAMETROS_TESOURO.taxaAgente)} a.a.) acumuladas desde a compra.`,
            "(v) Rendimento líquido = saldo na curva + cupons recebidos − valor de compra − IOF − IR − custódia/agente.",
            "(vi) Duration de Macaulay em anos (dias úteis ÷ 252) à taxa de mercado; total ponderado pelo saldo a mercado.",
            "(vii) Taxa ANBIMA da LFT: ágio/deságio sobre a Selic; NTN-B e NTN-B Principal: taxa real sobre o IPCA; LTN e NTN-F: taxa prefixada.",
            `(viii) Conferência: saldo na curva ${fmtBRL(d.mestre.curva, true)} e valor contábil ${fmtBRL(d.mestre.contabil, true)} na Carteira-Mestre.`,
          ],
        },
        {
          nome: "R08 - Fluxos",
          titulo: "R08 – Fluxo de cupons e vencimentos dos títulos públicos",
          subtitulo: `${ESCOPOS.find((e) => e.value === escopo)!.label} · Valores em R$ · realizados até ${fmtDate(p.dataBase)} e projetados após a data-base`,
          colunas: [
            { titulo: "Código", largura: 8 },
            { titulo: "Título", largura: 36 },
            { titulo: "Empresa", largura: 9 },
            { titulo: "Data", tipo: "data", largura: 13 },
            { titulo: "Evento", largura: 12 },
            { titulo: "Valor bruto", tipo: "moeda" },
            { titulo: "IRRF", tipo: "moeda" },
            { titulo: "Valor líquido", tipo: "moeda" },
            { titulo: "Situação", largura: 12 },
          ],
          linhas: d.eventos.map((x) => [x.t.id, x.t.nome, x.t.empresa, x.e.data, x.e.tipo, x.e.bruto, x.e.ir, x.e.liquido, x.realizado ? "Realizado" : "Projetado"]),
          total: ["TOTAL", "", "", "", "", d.eventos.reduce((s, x) => s + x.e.bruto, 0), d.eventos.reduce((s, x) => s + x.e.ir, 0), d.eventos.reduce((s, x) => s + x.e.liquido, 0), ""],
          notas: [
            `Eventos após a data-base projetados com o último dado disponível: VNA da LFT corrigido pela Selic (${fmtPct(p.selic)} a.a.) e VNA da NTN-B pelo IPCA 12 meses (${fmtPct(p.ipca12m)}) das Premissas.`,
            "IRRF regressivo pelo prazo desde a compra: sobre o cupom integral e, no vencimento, sobre o ganho em relação ao valor de compra.",
            "Datas de pagamento ajustadas para o dia útil seguinte (calendário ANBIMA).",
          ],
        },
      ],
      p.dataBase,
    );

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Saldo na curva" value={fmtCompact(d.curva)} sub={`${d.posicoes.length} título(s)`} />
          <HeaderKpi label="Saldo a mercado" value={fmtCompact(d.mercado)} sub="taxas ANBIMA" />
          <HeaderKpi
            label="Ajuste MTM"
            value={comSinal(d.mtm, fmtCompact)}
            state={Math.round(d.mtm) > 0 ? "positive" : Math.round(d.mtm) < 0 ? "negative" : "neutral"}
            sub={`${comSinal(d.curva ? d.mtm / d.curva : 0, (v) => fmtPct(v, 2))} s/ curva`}
          />
          <HeaderKpi label="Valor contábil" value={fmtCompact(d.contabil)} sub="CPC 48" />
          <HeaderKpi label="Duration média" value={fmtDec(d.duration, 2)} unit="anos" sub="pond. pelo mercado" />
          <HeaderKpi label="Cupons recebidos no ano" value={fmtCompact(d.cuponsAno.bruto)} sub={`bruto · ${d.cuponsAno.qtd} pagamento(s) em ${d.ano}`} />
        </>
      }
      headerExtra={
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-6 no-print">
          <FilterField label="Empresa" className="w-full sm:w-80 shrink-0">
            <Select
              value={escopo}
              onChange={(v) => {
                setEscopo(v);
                setSelecionado(null);
              }}
              options={ESCOPOS}
            />
          </FilterField>
          <p className="text-[13px] text-label sm:ml-auto sm:text-right leading-snug">
            Títulos públicos federais · custódia B3 · PU e taxas indicativas ANBIMA de {mesTaxas} · valores em R$
          </p>
        </div>
      }
    >
      <div className={clsx("grid gap-5", sel ? "lg:grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-1")}>
        <Card
          title={`Títulos públicos (${d.posicoes.length})`}
          subtitle="Clique em uma linha para ver o detalhe do título, a evolução do PU e o fluxo de caixa"
          bodyClassName="px-0 pb-0"
          className="min-w-0 overflow-hidden"
        >
          <DataTable
            columns={colunas}
            rows={d.posicoes}
            rowKey={(x) => x.t.id}
            onRowClick={(x) => setSelecionado(x.t.id === selecionado ? null : x.t.id)}
            selectedKey={selecionado}
            showTotals
            defaultSort={{ key: "codigo", dir: "asc" }}
            emptyText="Nenhum título público ativo nesta empresa na data-base"
          />
        </Card>
        {sel && <DetalheTitulo pos={sel} p={p} onClose={() => setSelecionado(null)} />}
      </div>

      <MessageStrip design={concilia ? "positive" : "negative"}>
        <span className="inline-flex flex-wrap gap-x-5 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saldo na curva igual ao da Carteira-Mestre: <strong>{fmtBRL(d.mestre.curva)}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Valor contábil igual ao da Carteira-Mestre: <strong>{fmtBRL(d.mestre.contabil)}</strong>
          </span>
        </span>
      </MessageStrip>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <CurvaMercado posicoes={d.posicoes} />
        <Cronograma eventos={d.eventos} p={p} />
      </div>

      <TratamentoContabil posicoes={d.posicoes} />

      <Parametros posicoes={d.posicoes} p={p} />

      <MessageStrip>
        Projeção com o último dado disponível: após a data-base, o VNA da LFT é corrigido pela Selic ({fmtPct(p.selic)} a.a.) e o
        VNA da NTN-B pelo IPCA 12 meses ({fmtPct(p.ipca12m)}) das Premissas, e a taxa indicativa ANBIMA repete a de {mesTaxas}.
        IRRF regressivo sobre cupons e vencimentos – para Pessoa Jurídica, antecipação compensável com o IRPJ.
      </MessageStrip>
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Painel de detalhe
// ---------------------------------------------------------------------------

function DetalheTitulo({ pos, p, onClose }: { pos: PosicaoTitulo; p: PremissasMercado; onClose: () => void }) {
  const { t } = pos;
  const tipo = infoTipo(t);

  const serie = useMemo(() => {
    const fins = lastMonthEnds(p.dataBase, mesesDesde(t.dataCompra, p.dataBase)).filter((f) => f > t.dataCompra);
    return [
      { rotulo: "Compra", curva: pos.puCompra, mercado: pos.puCompra },
      ...fins.map((f) => {
        const x = posicaoTitulo(t, f, p);
        return { rotulo: fmtMonthShort(f), curva: x.puCurva, mercado: x.puMercado };
      }),
    ];
  }, [t, p, pos.puCompra]);

  const fluxo = useMemo(() => eventosTitulo(t, p).map((e) => ({ e, realizado: e.data <= p.dataBase })), [t, p]);
  const realizado = fluxo.filter((x) => x.realizado).reduce((s, x) => s + x.e.liquido, 0);
  const projetado = fluxo.filter((x) => !x.realizado).reduce((s, x) => s + x.e.liquido, 0);

  const vnaCompra = t.tipo === "LFT" ? vnaLFT(t.dataCompra, p) : t.tipo === "NTN-B" || t.tipo === "NTN-B Principal" ? vnaNTNB(t.dataCompra, p) : null;

  return (
    <aside className="bg-white rounded-[var(--radius-card)] shadow-fiori-lg lg:shadow-fiori overflow-hidden self-auto lg:self-start flex flex-col fixed inset-x-4 bottom-4 top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 lg:sticky lg:inset-auto lg:top-[4.25rem] lg:z-auto lg:max-h-[calc(100vh-5.5rem)]">
      <header className="px-4 pt-3.5 pb-3 border-b border-line-soft">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-label">
              {t.id} · Transação {t.transacao}
            </div>
            <h3 className="text-lg font-bold text-text leading-snug">{t.nome}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-link hover:bg-hover" aria-label="Fechar detalhe">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <ObjectStatus inverted icon={false} state={CPC48_STATE[t.cpc48]}>
            {t.cpc48}
          </ObjectStatus>
          <Tag color={COR_MERCADO}>{t.tipo}</Tag>
          <Tag>Soberano</Tag>
          <Tag>{pos.prazoRemanescente <= 365 ? "Circulante" : "Não circulante"}</Tag>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto fiori-scroll px-4 py-4 space-y-5">
        <section>
          <h4 className="text-sm font-bold text-text mb-2">Valores na data-base</h4>
          <dl className="space-y-1.5 text-[13px]">
            <Linha label={`Valor de compra (${fmtInt(t.quantidade)} × ${fmtDec(pos.puCompra, 6)})`} valor={fmtBRL(pos.valorCompra, true)} />
            <Linha label={`Saldo na curva (PU ${fmtDec(pos.puCurva, 6)})`} valor={fmtBRL(pos.saldoCurva, true)} />
            <Linha label={`Saldo a mercado (PU ${fmtDec(pos.puMercado, 6)})`} valor={fmtBRL(pos.saldoMercado, true)} />
            <Linha label="Ajuste MTM (mercado − curva)" valor={comSinal(pos.mtm, (v) => fmtBRL(v, true))} cor={corSinal(pos.mtm)} />
            <div className="border-t border-line-soft pt-1.5">
              <Linha label="Cupons recebidos (bruto)" valor={fmtBRL(pos.cuponsRecebidos, true)} />
            </div>
            <Linha label="Rendimento bruto (curva + cupons − compra)" valor={fmtBRL(pos.rendimentoBruto, true)} cor="text-positive" />
            <Linha label="IOF" valor={`− ${fmtBRL(pos.iof, true)}`} />
            <Linha
              label={
                pos.irCupons > 0
                  ? `IR (retido ${fmtBRL(pos.irCupons, true)} + provisão)`
                  : `IR – provisão (${fmtPct(aliquotaIR(pos.diasCorridos, "Regressivo"), 1)})`
              }
              valor={`− ${fmtBRL(pos.ir, true)}`}
            />
            <Linha label="Custódia B3 + agente" valor={`− ${fmtBRL(pos.taxas, true)}`} />
            <div className="border-t border-line-soft pt-1.5">
              <Linha label="Rendimento líquido" valor={fmtBRL(pos.rendimentoLiquido, true)} forte />
            </div>
            <Linha label={`Valor contábil (${t.cpc48 === "Custo Amortizado" ? "curva" : "mercado"})`} valor={fmtBRL(pos.valorContabil, true)} forte />
          </dl>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Dados cadastrais</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Empresa">{`${t.empresa} – ${EMPRESAS[t.empresa]?.nome ?? ""}`}</Field>
            <Field label="Transação SAP">{t.transacao}</Field>
            <Field label="Tipo / código SELIC">{`${t.tipo} · ${tipo.codigoSelic}`}</Field>
            <Field label="Portfolio">{t.portfolio}</Field>
            <Field label="Custodiante" className="col-span-2">
              {t.custodiante}
            </Field>
            <Field label="Taxa de compra">{taxaTituloTexto(t)}</Field>
            <Field label="Taxa ANBIMA (data-base)">{taxaMercadoTexto(t, pos.taxaMercado)}</Field>
            <Field label="Data de compra">{fmtDate(t.dataCompra)}</Field>
            <Field label="Vencimento">{fmtDate(t.vencimento)}</Field>
            <Field label="Dias úteis até o vencimento">{fmtInt(pos.duUteis)}</Field>
            <Field label="Duration (Macaulay)">{`${fmtDec(pos.duration, 2)} anos`}</Field>
          </div>
          <p className="text-xs text-label leading-relaxed mt-3">{tipo.descricao}.</p>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Valor nominal atualizado (VNA)</h4>
          {pos.vna !== null && vnaCompra !== null ? (
            <div className="rounded-lg bg-[#f5f6f7] px-3 py-2.5">
              <div className="grid grid-cols-2 gap-3">
                <Field label={`VNA em ${fmtDate(p.dataBase)}`}>{fmtBRL(pos.vna, true)}</Field>
                <Field label={`VNA na compra (${fmtDate(t.dataCompra)})`}>{fmtBRL(vnaCompra, true)}</Field>
              </div>
              <p className="text-xs text-label leading-relaxed mt-2">
                {t.tipo === "LFT"
                  ? "VNA corrigido diariamente pela Selic (base 252). "
                  : "VNA corrigido pelo IPCA (pro rata por dia corrido). "}
                Âncora importada do SAP: {fmtBRL(t.tipo === "LFT" ? PARAMETROS_TESOURO.vnaLFT : PARAMETROS_TESOURO.vnaNTNB, true)} em{" "}
                {fmtDate(PARAMETROS_TESOURO.dataVNA)} (Tesouro Nacional / ANBIMA). Variação desde a compra:{" "}
                {fmtPct(pos.vna / vnaCompra - 1, 2)}.
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-label">
              Título prefixado – sem VNA: paga {fmtBRL(PARAMETROS_TESOURO.valorFace, true)} por título no vencimento
              {t.tipo === "NTN-F" ? ` e cupom semestral de ${fmtPct(PARAMETROS_TESOURO.cupomNTNF, 0)} ao ano` : ""}.
            </p>
          )}
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-1">PU na curva × PU a mercado</h4>
          <p className="text-xs text-label mb-2">Fim de cada mês desde a compra (R$ por título)</p>
          <div className="h-48 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="rotulo" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis
                  tick={AXIS_STYLE}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => fmtDec(v, 0)}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtDec(v, 6), n]} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <Line dataKey="curva" name="PU curva" stroke={COR_CURVA} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="mercado" name="PU mercado" stroke={COR_MERCADO} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Fluxo de caixa (cupons e vencimento)</h4>
          <div className="overflow-x-auto fiori-scroll -mx-4">
            <table className="w-full text-[13px] border-separate border-spacing-0">
              <thead>
                <tr className="text-text">
                  <th className="text-left font-semibold pl-4 pr-2 py-2 border-b border-[#a8b2bd]">Data</th>
                  <th className="text-right font-semibold px-2 py-2 border-b border-[#a8b2bd]">Bruto</th>
                  <th className="text-right font-semibold px-2 py-2 border-b border-[#a8b2bd]">IR</th>
                  <th className="text-right font-semibold pl-2 pr-4 py-2 border-b border-[#a8b2bd]">Líquido</th>
                </tr>
              </thead>
              <tbody>
                {fluxo.map(({ e, realizado: r }) => (
                  <tr key={`${e.data}-${e.tipo}`} className={r ? "" : "text-label"}>
                    <td className="pl-4 pr-2 py-1.5 border-b border-line-soft whitespace-nowrap">
                      <div className={clsx("tabular", r && "text-text")}>{fmtDate(e.data)}</div>
                      <div className="flex items-center gap-1 text-xs">
                        <span>{e.tipo}</span>
                        {r ? (
                          <span className="text-positive font-semibold">· realizado</span>
                        ) : (
                          <span className="italic">· projetado</span>
                        )}
                      </div>
                    </td>
                    <td className={clsx("px-2 py-1.5 border-b border-line-soft text-right tabular whitespace-nowrap", r && "text-text")}>{fmtNum(e.bruto)}</td>
                    <td className="px-2 py-1.5 border-b border-line-soft text-right tabular whitespace-nowrap">{fmtNum(e.ir)}</td>
                    <td className={clsx("pl-2 pr-4 py-1.5 border-b border-line-soft text-right tabular whitespace-nowrap font-semibold", r && "text-text")}>
                      {fmtNum(e.liquido)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="space-y-1 text-[13px] mt-2.5">
            <Linha label="Recebido até a data-base (líquido)" valor={fmtBRL(realizado)} />
            <Linha label="A receber – projetado (líquido)" valor={fmtBRL(projetado)} />
          </dl>
          <p className="text-xs text-label leading-relaxed mt-2">
            Eventos após {fmtDate(p.dataBase)} projetados com o último dado disponível
            {t.tipo === "LFT" ? ` (VNA pela Selic de ${fmtPct(p.selic)} a.a.)` : t.indexador === "IPCA" ? ` (VNA pelo IPCA 12 meses de ${fmtPct(p.ipca12m)})` : " (valores prefixados)"}.
            Datas no dia útil seguinte; IRRF regressivo pelo prazo desde a compra.
          </p>
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

// ---------------------------------------------------------------------------
// Curva × mercado por título
// ---------------------------------------------------------------------------

function CurvaMercado({ posicoes }: { posicoes: PosicaoTitulo[] }) {
  const dados = posicoes.map((x) => ({ codigo: x.t.id, tipo: x.t.tipo, curva: x.saldoCurva, mercado: x.saldoMercado, mtm: x.mtm }));
  const tipoDe = new Map(dados.map((x) => [x.codigo, x.tipo === "NTN-B Principal" ? "NTN-B P" : x.tipo]));
  return (
    <Card title="Curva × mercado por título" subtitle="Saldo na curva (taxa de compra) × saldo a mercado (taxa ANBIMA) e o ajuste MTM">
      {dados.length ? (
        <>
          <div className="h-60 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dados}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                barGap={2}
                barCategoryGap={dados.length === 1 ? "36%" : dados.length === 2 ? "24%" : "12%"}
              >
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis
                  dataKey="codigo"
                  tickLine={false}
                  axisLine={{ stroke: "#a8b2bd" }}
                  height={40}
                  interval={0}
                  tick={(props: { x: number; y: number; payload: { value: string } }) => (
                    <text x={props.x} y={props.y + 12} textAnchor="middle" style={AXIS_STYLE} fill={AXIS_STYLE.fill}>
                      <tspan x={props.x} fontWeight={600}>
                        {props.payload.value}
                      </tspan>
                      <tspan x={props.x} dy={14} fontSize={11}>
                        {tipoDe.get(props.payload.value)}
                      </tspan>
                    </text>
                  )}
                />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={52} tickFormatter={fmtEixo} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, n: string) => [fmtBRL(v), n]}
                  labelFormatter={(l: string) => {
                    const x = dados.find((y) => y.codigo === l);
                    return x ? `${l} · ${x.tipo} · MTM ${comSinal(x.mtm, fmtBRL)}` : l;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <Bar dataKey="curva" name="Saldo na curva" fill={COR_CURVA} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="mercado" name="Saldo a mercado" fill={COR_MERCADO} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 border-t border-line-soft pt-2">
            {posicoes.map((x) => (
              <li key={x.t.id} className="flex items-center justify-between gap-3 py-1.5 text-[13px] border-b border-line-soft sm:[&:nth-last-child(-n+2)]:border-b-0 last:border-b-0">
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-text">{x.t.id}</span> <span className="text-label">{x.t.tipo}</span>
                </span>
                <span className="tabular whitespace-nowrap">
                  <span className={clsx("font-semibold", corSinal(x.mtm))}>MTM {comSinal(x.mtm, fmtNum)}</span>
                  <span className="text-label"> · {comSinal(x.saldoCurva ? x.mtm / x.saldoCurva : 0, (v) => fmtPct(v, 2))}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-label py-6 text-center">Nenhum título ativo na data-base.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cronograma de cupons e vencimentos (24 meses)
// ---------------------------------------------------------------------------

function Cronograma({ eventos, p }: { eventos: EventoCarteira[]; p: PremissasMercado }) {
  const d = useMemo(() => {
    const inicioMes = `${p.dataBase.slice(0, 7)}-01`;
    const meses = Array.from({ length: 24 }, (_, i) => {
      const m = addMonths(inicioMes, i + 1);
      return { mes: m.slice(0, 7), rotulo: fmtMonthShort(m), cupom: 0, vencimento: 0, ir: 0, itens: [] as string[] };
    });
    const idx = new Map(meses.map((m, i) => [m.mes, i]));
    const futuros = eventos.filter((x) => !x.realizado && idx.has(x.e.data.slice(0, 7)));
    for (const x of futuros) {
      const m = meses[idx.get(x.e.data.slice(0, 7))!];
      if (x.e.tipo === "Cupom") m.cupom += x.e.bruto;
      else m.vencimento += x.e.bruto;
      m.ir += x.e.ir;
      m.itens.push(`${x.t.id} ${x.e.tipo.toLowerCase()} ${fmtDate(x.e.data)}`);
    }
    const cupons = futuros.filter((x) => x.e.tipo === "Cupom");
    const vencs = futuros.filter((x) => x.e.tipo === "Vencimento");
    return {
      meses,
      cupons: { valor: cupons.reduce((s, x) => s + x.e.bruto, 0), qtd: cupons.length },
      vencs: { valor: vencs.reduce((s, x) => s + x.e.bruto, 0), lista: vencs },
      ir: futuros.reduce((s, x) => s + x.e.ir, 0),
      bruto: futuros.reduce((s, x) => s + x.e.bruto, 0),
      qtd: futuros.length,
    };
  }, [eventos, p.dataBase]);

  return (
    <Card
      title="Cronograma de cupons e vencimentos – próximos 24 meses"
      subtitle={`Valores brutos por mês de pagamento · ${d.meses[0].rotulo} a ${d.meses[23].rotulo} · projeção com o último dado disponível`}
    >
      {d.qtd === 0 ? (
        <div className="h-60 flex items-center justify-center rounded-lg bg-[#f5f6f7] text-sm text-label text-center px-4">
          Sem cupons ou vencimentos dos títulos desta empresa nos próximos 24 meses.
        </div>
      ) : (
        <div className="h-60 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.meses} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e5e5e5" />
              <XAxis dataKey="rotulo" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval="preserveStartEnd" minTickGap={12} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={52} tickFormatter={fmtEixo} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "#f2f4f6" }}
                formatter={(v: number, n: string) => [fmtBRL(v), n]}
                labelFormatter={(l: string) => {
                  const m = d.meses.find((x) => x.rotulo === l);
                  return m && m.itens.length ? `${l} · ${m.itens.join(" · ")}` : l;
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
              <Bar dataKey="cupom" name="Cupons" stackId="e" fill={COR_CUPOM} isAnimationActive={false} />
              <Bar dataKey="vencimento" name="Vencimentos" stackId="e" fill={COR_VENCIMENTO} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Resumo rotulo="Cupons" valor={fmtCompact(d.cupons.valor)} sub={`${d.cupons.qtd} pagamento(s)`} cor={COR_CUPOM} />
        <Resumo
          rotulo="Vencimentos"
          valor={fmtCompact(d.vencs.valor)}
          sub={d.vencs.lista.length ? d.vencs.lista.map((x) => `${x.t.id} ${fmtMonthShort(x.e.data)}`).join(", ") : "nenhum no período"}
          cor={COR_VENCIMENTO}
        />
        <Resumo rotulo="IRRF estimado" valor={fmtCompact(d.ir)} sub="retido na fonte" />
        <Resumo rotulo="Líquido a receber" valor={fmtCompact(d.bruto - d.ir)} sub="24 meses" />
      </div>
    </Card>
  );
}

function Resumo({ rotulo, valor, sub, cor }: { rotulo: string; valor: string; sub: string; cor?: string }) {
  return (
    <div className="rounded-lg bg-[#f5f6f7] px-3 py-2 min-w-0">
      <div className="text-xs text-label flex items-center gap-1.5">
        {cor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cor }} />}
        {rotulo}
      </div>
      <div className="text-base font-bold text-text tabular">{valor}</div>
      <div className="text-xs text-label truncate" title={sub}>
        {sub}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tratamento contábil do MTM (CPC 48)
// ---------------------------------------------------------------------------

interface Lancamento {
  evento: string;
  transacao: string;
  debito?: string;
  credito?: string;
  texto?: string;
  valor?: number;
}

const TRATAMENTO: { cpc: ClassificacaoCPC48; titulo: string; item: string; mensuracao: string; mtm: string }[] = [
  {
    cpc: "Custo Amortizado",
    titulo: "Custo amortizado",
    item: "CPC 48, item 4.1.2",
    mensuracao: "Curva à taxa de compra (taxa efetiva); juros apropriados no resultado.",
    mtm: "MTM não contabilizado – o valor justo é apenas divulgado em nota explicativa (CPC 40).",
  },
  {
    cpc: "VJ por ORA",
    titulo: "Valor justo por ORA",
    item: "CPC 48, itens 4.1.2A e 5.7.10",
    mensuracao: "Mercado (taxa ANBIMA); juros pela curva no resultado.",
    mtm: "MTM em outros resultados abrangentes (PL), líquido de IR/CS diferido; reciclado para o resultado na venda.",
  },
  {
    cpc: "VJ por Resultado",
    titulo: "Valor justo por resultado",
    item: "CPC 48, item 4.1.4",
    mensuracao: "Mercado (taxa ANBIMA); juros e MTM no resultado.",
    mtm: "MTM no resultado financeiro do período (ganho ou perda não realizado).",
  },
];

function lancamentos(cpc: ClassificacaoCPC48, mtm: number): Lancamento[] {
  const ganho = mtm >= 0;
  const juros: Lancamento = {
    evento: "Apropriação de juros pela curva",
    transacao: "TPM44",
    debito: "Títulos públicos federais (ativo)",
    credito: "Receita financeira – juros de títulos públicos",
  };
  if (cpc === "Custo Amortizado")
    return [juros, { evento: "Avaliação a mercado", transacao: "TPM1", texto: "Sem lançamento contábil – valor justo divulgado em nota", valor: mtm }];
  if (cpc === "VJ por ORA")
    return [
      juros,
      ganho
        ? { evento: "Ajuste a valor justo", transacao: "TPM1", debito: "Títulos públicos – ajuste a valor justo", credito: "Ajuste de avaliação patrimonial (ORA)", valor: mtm }
        : { evento: "Ajuste a valor justo", transacao: "TPM1", debito: "Ajuste de avaliação patrimonial (ORA)", credito: "Títulos públicos – ajuste a valor justo", valor: -mtm },
      ganho
        ? { evento: "IR/CS diferido (34%)", transacao: "FI-GL", debito: "Ajuste de avaliação patrimonial (ORA)", credito: "IR/CS diferido (passivo)", valor: mtm * ALIQUOTA_IRPJ_CSLL }
        : { evento: "IR/CS diferido (34%)", transacao: "FI-GL", debito: "IR/CS diferido (ativo)", credito: "Ajuste de avaliação patrimonial (ORA)", valor: -mtm * ALIQUOTA_IRPJ_CSLL },
      { evento: "Venda – reciclagem do ORA", transacao: "TS01 / TPM10", debito: "Ajuste de avaliação patrimonial (ORA)", credito: "Receita financeira – resultado na alienação" },
    ];
  return [
    juros,
    ganho
      ? { evento: "Ajuste a valor justo", transacao: "TPM1", debito: "Títulos públicos – ajuste a valor justo", credito: "Receita financeira – ganho de marcação a mercado", valor: mtm }
      : { evento: "Ajuste a valor justo", transacao: "TPM1", debito: "Despesa financeira – perda de marcação a mercado", credito: "Títulos públicos – ajuste a valor justo", valor: -mtm },
  ];
}

function TratamentoContabil({ posicoes }: { posicoes: PosicaoTitulo[] }) {
  return (
    <Card
      title="Tratamento contábil do MTM (CPC 48)"
      subtitle="Classificação de cada título, destino do ajuste a mercado e lançamento contábil típico no fechamento"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {TRATAMENTO.map((g) => {
          const xs = posicoes.filter((x) => x.t.cpc48 === g.cpc);
          const mtm = xs.reduce((s, x) => s + x.mtm, 0);
          const contabil = xs.reduce((s, x) => s + x.valorContabil, 0);
          return (
            <section key={g.cpc} className="rounded-lg border border-line-soft p-3.5 flex flex-col gap-3 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <ObjectStatus inverted icon={false} state={CPC48_STATE[g.cpc]}>
                    {g.titulo}
                  </ObjectStatus>
                  <div className="text-xs text-label mt-1">{g.item}</div>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {xs.length ? xs.map((x) => <Tag key={x.t.id}>{`${x.t.id} ${x.t.tipo}`}</Tag>) : <span className="text-xs text-label">sem títulos</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Valor contábil">{xs.length ? fmtBRL(contabil) : "–"}</Field>
                <Field label={g.cpc === "Custo Amortizado" ? "MTM (só em nota)" : "MTM contabilizado"}>
                  <span className={xs.length ? corSinal(mtm) : "text-label"}>{xs.length ? comSinal(mtm, fmtBRL) : "–"}</span>
                </Field>
              </div>
              <div className="text-[13px] text-text leading-relaxed">
                <p>{g.mensuracao}</p>
                <p className="text-label mt-1">{g.mtm}</p>
                {g.cpc === "VJ por ORA" && xs.length > 0 && (
                  <p className="text-label mt-1">
                    Efeito no PL líquido de IR/CS diferido ({fmtPct(ALIQUOTA_IRPJ_CSLL, 0)}):{" "}
                    <strong className={corSinal(mtm)}>{comSinal(mtm * (1 - ALIQUOTA_IRPJ_CSLL), fmtBRL)}</strong>
                  </p>
                )}
              </div>
              <ul className="space-y-2">
                {lancamentos(g.cpc, mtm).map((l) => (
                  <li key={l.evento} className="rounded-md bg-[#f5f6f7] px-3 py-2 text-[12px] leading-snug">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-text">
                        {l.evento} <span className="font-normal text-label">· {l.transacao}</span>
                      </span>
                      {l.valor !== undefined && xs.length > 0 && <span className="tabular font-semibold text-text whitespace-nowrap">{fmtBRL(Math.abs(l.valor))}</span>}
                    </div>
                    {l.texto && <div className="text-label mt-0.5">{l.texto}</div>}
                    {l.debito && (
                      <div className="mt-0.5 text-text">
                        <span className="inline-block w-4 font-bold text-label">D</span>
                        {l.debito}
                      </div>
                    )}
                    {l.credito && (
                      <div className="text-text">
                        <span className="inline-block w-4 font-bold text-label">C</span>
                        {l.credito}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="text-xs text-label leading-relaxed mt-4">
        No SAP TRM, a apropriação de juros pela curva (taxa efetiva) roda no fechamento pela TPM44 (apropriação/diferimento) e a
        avaliação a mercado pela TPM1 (avaliação), com a taxa indicativa ANBIMA importada como dado de mercado; a classe de
        avaliação da posição (CPC 48) define se o ajuste vai para o resultado, para ORA ou apenas para a divulgação em nota. O IR/CS
        diferido sobre o ORA é lançado no FI-GL (CPC 32).
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Parâmetros (Premissas)
// ---------------------------------------------------------------------------

function Parametros({ posicoes, p }: { posicoes: PosicaoTitulo[]; p: PremissasMercado }) {
  const P = PARAMETROS_TESOURO;
  const mesAnterior = previousMonthEnd(p.dataBase);
  const ultimo = ultimoDadoNaDataBase(p.dataBase);
  const cupomNTNF = P.valorFace * (Math.pow(1 + P.cupomNTNF, 0.5) - 1);
  const cupomNTNB = Math.pow(1 + P.cupomNTNB, 0.5) - 1;

  // Sensibilidade a +100 bps: duration modificada = Macaulay ÷ (1 + taxa de mercado)
  const sens = useMemo(() => {
    const linhas = posicoes.map((x) => {
      const durMod = x.duration / (1 + x.taxaMercado);
      return {
        id: x.t.id,
        cpc: x.t.cpc48,
        destino: x.t.cpc48 === "Custo Amortizado" ? "nota" : x.t.cpc48 === "VJ por ORA" ? "ORA" : "resultado",
        durMod,
        impacto: -durMod * x.saldoMercado * 0.01,
      };
    });
    const por = (c: ClassificacaoCPC48) => linhas.filter((l) => l.cpc === c).reduce((s, l) => s + l.impacto, 0);
    return {
      linhas,
      total: linhas.reduce((s, l) => s + l.impacto, 0),
      porDestino: { nota: por("Custo Amortizado"), ora: por("VJ por ORA"), resultado: por("VJ por Resultado") },
    };
  }, [posicoes]);

  const itens: { rotulo: string; valor: string; fonte: ReactNode }[] = [
    { rotulo: "Custódia B3", valor: `${fmtPct(P.custodiaB3)} a.a.`, fonte: "Sobre o saldo, cobrada semestralmente (tabela de tarifas B3)" },
    { rotulo: "Taxa do agente de custódia", valor: `${fmtPct(P.taxaAgente)} a.a.`, fonte: "Tarifa do banco agente sobre o saldo custodiado" },
    {
      rotulo: "VNA da LFT",
      valor: fmtBRL(vnaLFT(p.dataBase, p), true),
      fonte: `Na data-base; âncora ${fmtBRL(P.vnaLFT, true)} em ${fmtDate(P.dataVNA)} (Tesouro Nacional / ANBIMA), corrigida pela Selic diária`,
    },
    {
      rotulo: "VNA da NTN-B",
      valor: fmtBRL(vnaNTNB(p.dataBase, p), true),
      fonte: `Na data-base; âncora ${fmtBRL(P.vnaNTNB, true)} em ${fmtDate(P.dataVNA)} (ANBIMA), corrigida pelo IPCA`,
    },
    { rotulo: "Cupom da NTN-F", valor: `${fmtPct(P.cupomNTNF, 0)} a.a.`, fonte: `Semestral (jan/jul): ${fmtBRL(cupomNTNF, true)} por título` },
    { rotulo: "Cupom da NTN-B", valor: `${fmtPct(P.cupomNTNB, 0)} a.a.`, fonte: `Semestral: ${fmtPct(cupomNTNB, 4)} do VNA por título` },
    { rotulo: "Valor de face (LTN e NTN-F)", valor: fmtBRL(P.valorFace, true), fonte: "Pago no vencimento, por título" },
    { rotulo: "Selic a.a. (projeção do VNA da LFT)", valor: fmtPct(p.selic), fonte: FONTES_SAP.selic },
    { rotulo: "IPCA 12 meses (projeção do VNA da NTN-B)", valor: fmtPct(p.ipca12m), fonte: FONTES_SAP.ipca12m },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
      <Card
        className="xl:col-span-3"
        title="Parâmetros (Premissas)"
        subtitle={`Somente leitura · último dado disponível em ${fmtDate(ultimo)}`}
        status={
          <Tag color="#556b82">
            <Lock className="w-2.5 h-2.5 mr-1" />
            Importado do SAP
          </Tag>
        }
      >
        <ul className="divide-y divide-line-soft -mt-1">
          {itens.map((x) => (
            <li key={x.rotulo} className="py-2 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text">{x.rotulo}</div>
                <div className="text-xs text-label mt-0.5 leading-snug">{x.fonte}</div>
              </div>
              <div className="text-sm text-right tabular font-bold text-text whitespace-nowrap">{x.valor}</div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-label leading-relaxed mt-2">
          Premissas importadas do SAP ({IMPORTACAO_SAP.sistema}); não editáveis nesta aplicação. Meses posteriores à data-base usam o
          último dado disponível (VNA projetado pela Selic / IPCA 12 meses e taxa ANBIMA do último mês importado).
        </p>
      </Card>

      <Card
        className="xl:col-span-2"
        title="Taxas indicativas ANBIMA"
        subtitle={`Importadas do SAP (dados de mercado de títulos) · fim de ${fmtMonthShort(mesAnterior)} e ${fmtMonthShort(p.dataBase)}`}
        bodyClassName="px-0"
      >
        <div className="overflow-x-auto fiori-scroll">
          <table className="w-full text-[13px] border-separate border-spacing-0">
            <thead>
              <tr className="text-text">
                <th className="text-left font-semibold pl-4 pr-2 py-2 border-b border-[#a8b2bd]">Título</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-[#a8b2bd]">Compra</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-[#a8b2bd] whitespace-nowrap">{fmtMonthShort(mesAnterior)}</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-[#a8b2bd] whitespace-nowrap">{fmtMonthShort(p.dataBase)}</th>
                <th className="text-right font-semibold pl-2 pr-4 py-2 border-b border-[#a8b2bd] whitespace-nowrap">Var. mês</th>
              </tr>
            </thead>
            <tbody>
              {posicoes.map((x) => {
                const ant = x.t.dataCompra > mesAnterior ? x.t.taxaCompra : taxaMercado(x.t, mesAnterior, p);
                const pctTxt = (v: number) => (x.t.indexador === "Selic" ? fmtDec(v * 100, 4) : fmtDec(v * 100, 2));
                return (
                  <tr key={x.t.id}>
                    <td className="pl-4 pr-2 py-2 border-b border-line-soft whitespace-nowrap">
                      <span className="font-semibold text-text">{x.t.id}</span> <span className="text-label hidden sm:inline">{x.t.tipo}</span>
                    </td>
                    <td className="px-2 py-2 border-b border-line-soft text-right tabular text-label">{pctTxt(x.t.taxaCompra)}</td>
                    <td className="px-2 py-2 border-b border-line-soft text-right tabular">{pctTxt(ant)}</td>
                    <td className="px-2 py-2 border-b border-line-soft text-right tabular font-semibold text-text">{pctTxt(x.taxaMercado)}</td>
                    <td className="pl-2 pr-4 py-2 border-b border-line-soft text-right tabular whitespace-nowrap text-label">{bps(ant, x.taxaMercado)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 pt-3 text-xs text-label leading-relaxed">
          % a.a. LFT: ágio (−) / deságio (+) sobre a Selic; NTN-B e NTN-B Principal: taxa real sobre o IPCA; LTN e NTN-F: taxa
          prefixada. Queda da taxa valoriza o título (MTM positivo); alta desvaloriza.
        </p>

        <div className="px-4 pt-4">
          <h4 className="text-sm font-bold text-text">Sensibilidade: alta de 100 bps na taxa ANBIMA</h4>
          <p className="text-xs text-label mt-0.5">Impacto estimado no saldo a mercado = − duration modificada × saldo a mercado × 1%</p>
          <ul className="mt-2 divide-y divide-line-soft">
            <li className="pb-1 flex items-center justify-between gap-3 text-xs text-label">
              <span>Título · destino do MTM</span>
              <span>Dur. mod. (anos) · impacto (R$)</span>
            </li>
            {sens.linhas.map((x) => (
              <li key={x.id} className="py-1.5 flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-text">{x.id}</span> <span className="text-label">{x.destino}</span>
                </span>
                <span className="tabular whitespace-nowrap">
                  <span className="text-label">{fmtDec(x.durMod, 2)} · </span>
                  <span className="font-semibold text-negative">{fmtNum(x.impacto)}</span>
                </span>
              </li>
            ))}
            <li className="py-1.5 flex items-center justify-between gap-3 text-[13px] font-bold">
              <span className="text-text">Total</span>
              <span className="tabular text-negative">{fmtNum(sens.total)}</span>
            </li>
          </ul>
          <p className="text-xs text-label leading-relaxed mt-2">
            Efeito contábil do choque:{" "}
            {[
              sens.porDestino.resultado ? `${fmtBRL(sens.porDestino.resultado)} no resultado (VJR)` : "",
              sens.porDestino.ora ? `${fmtBRL(sens.porDestino.ora)} em ORA` : "",
              sens.porDestino.nota ? `${fmtBRL(sens.porDestino.nota)} apenas na nota (custo amortizado)` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            .
          </p>
        </div>
      </Card>
    </div>
  );
}
