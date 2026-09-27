import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, SegmentedButton, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, CHART_COLORS, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import {
  addDays,
  diffDays,
  fmtDate,
  fmtMonthLong,
  fmtMonthShort,
  fmtQuarter,
  lastMonthEnds,
  monthOf,
  previousYearEnd,
  yearOf,
} from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";
import { ESCOPOS, useDivida, type Escopo } from "../context/useDivida";
import { relatorioCaptacao } from "../data/catalogo";
import { EMPRESAS_DIVIDA, taxaContratadaDivida, type ContratoDivida, type IndexadorDivida } from "../data/contratos";
import {
  custoMedioPonderado,
  encargosDivida,
  movimentacaoContrato,
  saldoContabil,
  totalDivida,
  type EncargosContrato,
  type PosicaoDivida,
} from "../lib/divida";

const rel = relatorioCaptacao("c03");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };
const legendStyle = { fontSize: 12, fontFamily: "72, Arial" };

/** Cores dos componentes dos encargos (a atualização monetária usa a cor do IPCA das Premissas) */
const COR = {
  juros: CHART_COLORS[0],
  atualizacao: CHART_COLORS[1],
  custos: CHART_COLORS[8],
  despesa: "#1d2d3e",
  capitalizado: CHART_COLORS[5],
  cdi: "#1d2d3e",
  custoMedio: CHART_COLORS[4],
};

/** Mesma ordem e cores dos indexadores da tela de Premissas */
const INDEXADORES: IndexadorDivida[] = ["CDI", "IPCA", "TJLP", "TLP", "Pré"];
const COR_INDEXADOR: Record<IndexadorDivida, string> = {
  CDI: CHART_COLORS[0],
  IPCA: CHART_COLORS[1],
  TJLP: CHART_COLORS[2],
  TLP: CHART_COLORS[3],
  "Pré": CHART_COLORS[5],
};

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

type Periodo = "mes" | "tri" | "ano" | "12m";

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "mes", label: "Mês" },
  { value: "tri", label: "Trimestre" },
  { value: "ano", label: "Exercício" },
  { value: "12m", label: "12 meses" },
];

/** Data de abertura do período (saldo inicial); os encargos correm do dia seguinte até a data-base */
function inicioPeriodo(periodo: Periodo, dataBase: string): string {
  switch (periodo) {
    case "mes":
      return lastMonthEnds(dataBase, 2)[0];
    case "tri":
      return lastMonthEnds(dataBase, ((monthOf(dataBase) - 1) % 3) + 2)[0];
    case "ano":
      return previousYearEnd(dataBase);
    case "12m":
      return lastMonthEnds(dataBase, 13)[0];
  }
}

function rotuloPeriodo(periodo: Periodo, inicio: string, dataBase: string): string {
  const mes = monthOf(dataBase);
  const primeiroMes = fmtMonthShort(addDays(inicio, 1));
  switch (periodo) {
    case "mes": {
      const longo = fmtMonthLong(dataBase);
      return longo.charAt(0).toUpperCase() + longo.slice(1);
    }
    case "tri":
      return `${Math.ceil(mes / 3)}º trimestre de ${yearOf(dataBase)}${mes % 3 === 0 ? "" : ` (até ${fmtMonthShort(dataBase)})`}`;
    case "ano":
      return mes === 1 ? `Exercício de ${yearOf(dataBase)} (jan)` : `Exercício de ${yearOf(dataBase)} (${primeiroMes.slice(0, 3)} a ${fmtMonthShort(dataBase).slice(0, 3)})`;
    case "12m":
      return `12 meses (${primeiroMes} a ${fmtMonthShort(dataBase)})`;
  }
}

function rotuloCurto(periodo: Periodo, dataBase: string): string {
  switch (periodo) {
    case "mes":
      return fmtMonthShort(dataBase);
    case "tri":
      return fmtQuarter(dataBase);
    case "ano":
      return `Exercício ${yearOf(dataBase)}`;
    case "12m":
      return "12 meses";
  }
}

// ---------------------------------------------------------------------------
// Cálculos locais
// ---------------------------------------------------------------------------

interface LinhaEncargos extends EncargosContrato {
  captadoNoPeriodo: boolean;
  liquidadoNoPeriodo: boolean;
}

interface TotaisEncargos {
  saldoMedio: number;
  juros: number;
  atualizacaoMonetaria: number;
  apropriacaoCustos: number;
  total: number;
  capitalizados: number;
  despesaFinanceira: number;
  taxaPeriodo: number;
  taxaAnualizada: number;
}

/** Remove resíduos de ponto flutuante (ex.: despesa financeira −0,0000001 de contrato 100% capitalizado) */
function limpar(v: number): number {
  return Math.abs(v) < 0.005 ? 0 : v;
}

function anualizar(taxaPeriodo: number, dias: number): number {
  return Math.pow(1 + taxaPeriodo, 365 / Math.max(1, dias)) - 1;
}

/**
 * Saldo médio diário pelo custo amortizado: média dos saldos contábeis no início de cada dia do período (dias antes
 * da captação ou após a liquidação contam como zero). Mantém a taxa anualizada coerente para contratos captados ou
 * liquidados dentro do período.
 */
function saldoMedioDiario(c: ContratoDivida, inicio: string, fim: string, p: PremissasMercado): number {
  const dias = Math.max(1, diffDays(inicio, fim));
  let soma = 0;
  for (let i = 0; i < dias; i++) soma += saldoContabil(c, addDays(inicio, i), p);
  return soma / dias;
}

/** Encargos por contrato no período (motor `encargosDivida`), com saldo médio diário e taxas recalculadas */
function encargosDoPeriodo(contratos: ContratoDivida[], inicio: string, fim: string, p: PremissasMercado): LinhaEncargos[] {
  const dias = Math.max(1, diffDays(inicio, fim));
  return encargosDivida(contratos, inicio, fim, p)
    .filter((e) => Math.abs(e.total) >= 0.5)
    .map((e) => {
      const saldoMedio = saldoMedioDiario(e.c, inicio, fim, p);
      const taxaPeriodo = saldoMedio > 0 ? e.total / saldoMedio : 0;
      return {
        ...e,
        capitalizados: limpar(e.capitalizados),
        despesaFinanceira: limpar(e.despesaFinanceira),
        saldoMedio,
        taxaPeriodo,
        taxaAnualizada: anualizar(taxaPeriodo, dias),
        captadoNoPeriodo: e.c.dataCaptacao > inicio,
        liquidadoNoPeriodo: e.c.vencimento <= fim,
      };
    });
}

function totalizar(linhas: EncargosContrato[], dias: number): TotaisEncargos {
  const soma = (fn: (x: EncargosContrato) => number) => linhas.reduce((s, x) => s + fn(x), 0);
  const saldoMedio = soma((x) => x.saldoMedio);
  const total = soma((x) => x.total);
  const taxaPeriodo = saldoMedio > 0 ? total / saldoMedio : 0;
  return {
    saldoMedio,
    juros: soma((x) => x.juros),
    atualizacaoMonetaria: soma((x) => x.atualizacaoMonetaria),
    apropriacaoCustos: soma((x) => x.apropriacaoCustos),
    total,
    capitalizados: limpar(soma((x) => x.capitalizados)),
    despesaFinanceira: limpar(soma((x) => x.despesaFinanceira)),
    taxaPeriodo,
    taxaAnualizada: anualizar(taxaPeriodo, dias),
  };
}

interface MesEncargos extends TotaisEncargos {
  fim: string;
  rotulo: string;
  noPeriodo: boolean;
}

interface CustoContrato {
  pos: PosicaoDivida;
  id: string;
  taxa: number; // % a.a. (escala do gráfico)
  cor: string;
}

interface LinhaIndexador {
  indexador: IndexadorDivida;
  contratos: string[];
  saldo: number;
  participacao: number;
  custoMedio: number;
  encargos: number;
  taxaAnualizada: number;
}

interface ContratoCPC20 {
  c: ContratoDivida;
  ate: string;
  ativo: string;
  noPeriodo: number;
  acumulado: number;
  aCapitalizar: number;
  emAndamento: boolean;
  diasRestantes: number;
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function C03Encargos() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const [periodo, setPeriodo] = useState<Periodo>("ano");
  const { premissas: p, contratos, posicoes } = useDivida(escopo);
  const { posicoes: posicoesConsolidadas } = useDivida("todas");
  const db = p.dataBase;
  const inicio = inicioPeriodo(periodo, db);
  const dias = diffDays(inicio, db);
  const rotulo = rotuloPeriodo(periodo, inicio, db);
  const curto = rotuloCurto(periodo, db);
  const escopoLabel = ESCOPOS.find((e) => e.value === escopo)?.label ?? "";
  const ultimoDado = ultimoDadoNaDataBase(db);

  const d = useMemo(() => {
    const linhas = encargosDoPeriodo(contratos, inicio, db, p);
    const tot = totalizar(linhas, dias);

    // Série mensal: últimos 12 meses até a data-base
    const fins = lastMonthEnds(db, 13);
    const mensal: MesEncargos[] = fins.slice(1).map((fim, i) => {
      const ini = fins[i];
      return {
        ...totalizar(encargosDoPeriodo(contratos, ini, fim, p), diffDays(ini, fim)),
        fim,
        rotulo: fmtMonthShort(fim),
        noPeriodo: fim > inicio,
      };
    });

    // Custo por contrato (posições na data-base)
    const custoMedio = custoMedioPonderado(posicoes);
    const custo: CustoContrato[] = [...posicoes]
      .sort((a, b) => b.taxaEfetivaAA - a.taxaEfetivaAA)
      .map((x) => ({ pos: x, id: x.c.id, taxa: x.taxaEfetivaAA * 100, cor: COR_INDEXADOR[x.c.indexador] }));

    // Custo médio por indexador
    const saldoTotal = totalDivida(posicoes);
    const indexadores: LinhaIndexador[] = INDEXADORES.map((ix) => {
      const pos = posicoes.filter((x) => x.c.indexador === ix);
      const enc = linhas.filter((x) => x.c.indexador === ix);
      const t = totalizar(enc, dias);
      const saldo = totalDivida(pos);
      return {
        indexador: ix,
        contratos: [...new Set([...pos.map((x) => x.c.id), ...enc.map((x) => x.c.id)])],
        saldo,
        participacao: saldoTotal > 0 ? saldo / saldoTotal : 0,
        custoMedio: custoMedioPonderado(pos),
        encargos: t.total,
        taxaAnualizada: t.taxaAnualizada,
      };
    }).filter((x) => x.contratos.length > 0);

    // CPC 20 – contratos que financiam ativo qualificável
    const cpc20: ContratoCPC20[] = contratos
      .filter((c) => c.capitalizacaoCPC20 && c.dataCaptacao <= db)
      .map((c) => {
        const cap = c.capitalizacaoCPC20!;
        const emAndamento = cap.ate > db;
        return {
          c,
          ate: cap.ate,
          ativo: cap.ativo,
          noPeriodo: linhas.find((l) => l.c.id === c.id)?.capitalizados ?? 0,
          acumulado: limpar(movimentacaoContrato(c, c.dataCaptacao, db, p).capitalizados),
          aCapitalizar: emAndamento ? limpar(movimentacaoContrato(c, db, cap.ate, p).capitalizados) : 0,
          emAndamento,
          diasRestantes: diffDays(db, cap.ate),
        };
      });

    return { linhas, tot, mensal, custo, custoMedio, saldoTotal, indexadores, cpc20 };
  }, [contratos, posicoes, inicio, db, dias, p]);

  const { linhas, tot } = d;
  const custoMedioConsolidado = useMemo(() => custoMedioPonderado(posicoesConsolidadas), [posicoesConsolidadas]);
  const pctCapitalizado = tot.total > 0 ? tot.capitalizados / tot.total : 0;
  const maxTaxa = Math.max(p.cdi * 100, ...d.custo.map((x) => x.taxa), 0);
  const xMax = Math.max(5, Math.ceil((maxTaxa + 1) / 5) * 5);
  const xTicks = Array.from({ length: xMax / 5 + 1 }, (_, i) => i * 5);
  const indexadoresNoGrafico = INDEXADORES.filter((ix) => d.custo.some((x) => x.pos.c.indexador === ix));
  const periodoDatas = `${fmtDate(addDays(inicio, 1))} a ${fmtDate(db)}`;

  // -------------------------------------------------------------------------
  // Tabela por contrato
  // -------------------------------------------------------------------------

  const valorCol = (
    key: string,
    header: string,
    get: (x: TotaisEncargos) => number,
    opts: { bold?: boolean; minWidth?: number; headerTitle?: string } = {},
  ): Column<LinhaEncargos> => ({
    key,
    header,
    align: "right",
    minWidth: opts.minWidth,
    headerTitle: opts.headerTitle,
    value: (x) => get(x),
    render: (x) => <span className={opts.bold ? "font-semibold" : undefined}>{fmtNum(get(x), { dash: true })}</span>,
    total: () => fmtNum(get(tot), { dash: true }),
  });

  const colunas: Column<LinhaEncargos>[] = [
    {
      key: "contrato",
      header: "Contrato",
      sticky: true,
      minWidth: 170,
      value: (x) => x.c.id,
      render: (x) => (
        <div className="py-0.5">
          <div className="whitespace-nowrap">
            <span className="font-semibold text-text">{x.c.id}</span>
            <span className="text-xs text-label" title={`${x.c.modalidade} – ${EMPRESAS_DIVIDA[x.c.empresa] ?? x.c.empresa}`}>
              {" "}
              · {x.c.empresa}
            </span>
          </div>
          <div className="text-xs text-label whitespace-nowrap">{taxaContratadaDivida(x.c)}</div>
          {(x.captadoNoPeriodo || x.liquidadoNoPeriodo) && (
            <div className="mt-1">
              <Tag color={x.liquidadoNoPeriodo ? "#556b82" : "#0070f2"}>
                {x.liquidadoNoPeriodo ? `Liquidado em ${fmtDate(x.c.vencimento)}` : `Captado em ${fmtDate(x.c.dataCaptacao)}`}
              </Tag>
            </div>
          )}
        </div>
      ),
      total: (rows) => `Total (${rows.length})`,
    },
    valorCol("saldoMedio", "Saldo médio", (x) => x.saldoMedio, {
      minWidth: 120,
      headerTitle: "Média dos saldos contábeis diários do período (custo amortizado)",
    }),
    valorCol("juros", "Juros", (x) => x.juros),
    valorCol("am", "Atualização monetária", (x) => x.atualizacaoMonetaria, { headerTitle: "Correção monetária do principal (IPCA / TLP)" }),
    valorCol("custos", "Apropriação de custos", (x) => x.apropriacaoCustos, {
      headerTitle: "Apropriação linear dos custos de transação (CPC 48 – custo amortizado)",
    }),
    valorCol("total", "Total de encargos", (x) => x.total, { bold: true }),
    {
      key: "cap",
      header: "Capitalizados",
      headerTitle: "Encargos capitalizados no ativo qualificável (CPC 20)",
      align: "right",
      value: (x) => x.capitalizados,
      render: (x) =>
        x.capitalizados > 0 ? <span className="text-info font-semibold">{fmtNum(x.capitalizados)}</span> : <span className="text-label">–</span>,
      total: () => fmtNum(tot.capitalizados, { dash: true }),
    },
    valorCol("despesa", "Despesa financeira", (x) => x.despesaFinanceira, { headerTitle: "Encargos − capitalizados (resultado financeiro)" }),
    {
      key: "taxaPeriodo",
      header: "Taxa do período",
      headerTitle: "Total de encargos ÷ saldo médio",
      align: "right",
      value: (x) => x.taxaPeriodo,
      render: (x) => fmtPct(x.taxaPeriodo),
      total: () => fmtPct(tot.taxaPeriodo),
    },
    {
      key: "taxaAnual",
      header: "Taxa anualizada",
      headerTitle: "(1 + taxa do período)^(365 / dias) − 1",
      align: "right",
      value: (x) => x.taxaAnualizada,
      render: (x) => <span className="font-semibold">{fmtPct(x.taxaAnualizada)}</span>,
      total: () => fmtPct(tot.taxaAnualizada),
    },
  ];

  const colIndexadores: Column<LinhaIndexador>[] = [
    {
      key: "indexador",
      header: "Indexador",
      minWidth: 130,
      value: (x) => x.indexador,
      render: (x) => (
        <div>
          <span className="inline-flex items-center gap-2 font-semibold">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COR_INDEXADOR[x.indexador] }} />
            {x.indexador}
          </span>
          <div className="text-xs text-label whitespace-nowrap">
            {x.contratos.length} contrato{x.contratos.length === 1 ? "" : "s"}
          </div>
        </div>
      ),
      total: () => "Carteira",
    },
    {
      key: "saldo",
      header: "Saldo contábil",
      align: "right",
      minWidth: 130,
      value: (x) => x.saldo,
      render: (x) => (
        <div>
          <div>{fmtCompact(x.saldo)}</div>
          <div className="text-xs text-label">{fmtPct(x.participacao, 1)}</div>
        </div>
      ),
      total: () => fmtCompact(d.saldoTotal),
    },
    {
      key: "custo",
      header: "Custo médio a.a.",
      headerTitle: "Taxa efetiva a.a. (juros + correção) ponderada pelo saldo contábil na data-base",
      align: "right",
      minWidth: 120,
      value: (x) => x.custoMedio,
      render: (x) => <span className="font-semibold">{x.saldo > 0 ? fmtPct(x.custoMedio) : "—"}</span>,
      total: () => fmtPct(d.custoMedio),
    },
    {
      key: "encargos",
      header: "Encargos no período",
      align: "right",
      minWidth: 130,
      value: (x) => x.encargos,
      render: (x) => (
        <div>
          <div>{fmtCompact(x.encargos)}</div>
          <div className="text-xs text-label">{fmtPct(x.taxaAnualizada)} a.a.</div>
        </div>
      ),
      total: () => (
        <div>
          <div>{fmtCompact(tot.total)}</div>
          <div className="text-xs text-label font-normal">{fmtPct(tot.taxaAnualizada)} a.a.</div>
        </div>
      ),
    },
  ];

  // -------------------------------------------------------------------------
  // Exportação
  // -------------------------------------------------------------------------

  const exportar = () =>
    exportarExcel(
      `C03_Encargos_Custo_Divida_${db}.xlsx`,
      [
        {
          nome: "C03 - Encargos",
          titulo: "C03 – Encargos e custo da dívida",
          subtitulo: `${escopoLabel} · ${rotulo} (${periodoDatas}, ${dias} dias) · Valores em R$`,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Empresa", largura: 22 },
            { titulo: "Modalidade", largura: 20 },
            { titulo: "Instrumento", largura: 52 },
            { titulo: "Taxa contratada", largura: 30 },
            { titulo: "Saldo médio", tipo: "moeda", largura: 18 },
            { titulo: "Juros", tipo: "moeda" },
            { titulo: "Atualização monetária", tipo: "moeda", largura: 20 },
            { titulo: "Apropriação de custos", tipo: "moeda", largura: 20 },
            { titulo: "Total de encargos", tipo: "moeda", largura: 18 },
            { titulo: "Capitalizados (CPC 20)", tipo: "moeda", largura: 20 },
            { titulo: "Despesa financeira", tipo: "moeda", largura: 18 },
            { titulo: "Taxa do período", tipo: "pct", largura: 14 },
            { titulo: "Taxa anualizada", tipo: "pct", largura: 14 },
          ],
          linhas: linhas.map((x) => [
            x.c.id,
            `${x.c.empresa} – ${EMPRESAS_DIVIDA[x.c.empresa] ?? ""}`,
            x.c.modalidade,
            x.c.instrumento,
            taxaContratadaDivida(x.c),
            x.saldoMedio,
            x.juros,
            x.atualizacaoMonetaria,
            x.apropriacaoCustos,
            x.total,
            x.capitalizados,
            x.despesaFinanceira,
            x.taxaPeriodo,
            x.taxaAnualizada,
          ]),
          total: [
            "TOTAL",
            "",
            "",
            "",
            "",
            tot.saldoMedio,
            tot.juros,
            tot.atualizacaoMonetaria,
            tot.apropriacaoCustos,
            tot.total,
            tot.capitalizados,
            tot.despesaFinanceira,
            tot.taxaPeriodo,
            tot.taxaAnualizada,
          ],
          notas: [
            "Encargos pelo custo amortizado: juros exponenciais e correção monetária (base 365 dias corridos) e apropriação linear dos custos de transação.",
            "Saldo médio = média dos saldos contábeis diários do período (dias sem saldo contam como zero).",
            "Taxa do período = total de encargos ÷ saldo médio; taxa anualizada = (1 + taxa do período)^(365 / dias) − 1.",
            "Despesa financeira = total de encargos − encargos capitalizados em ativo qualificável (CPC 20).",
          ],
        },
        {
          nome: "Mensal 12m",
          titulo: "Encargos mensais – últimos 12 meses",
          subtitulo: `${escopoLabel} · Valores em R$`,
          colunas: [
            { titulo: "Mês", largura: 10 },
            { titulo: "Juros", tipo: "moeda" },
            { titulo: "Atualização monetária", tipo: "moeda", largura: 20 },
            { titulo: "Apropriação de custos", tipo: "moeda", largura: 20 },
            { titulo: "Total de encargos", tipo: "moeda", largura: 18 },
            { titulo: "Capitalizados (CPC 20)", tipo: "moeda", largura: 20 },
            { titulo: "Despesa financeira", tipo: "moeda", largura: 18 },
            { titulo: "Saldo médio", tipo: "moeda", largura: 18 },
            { titulo: "Taxa anualizada", tipo: "pct", largura: 14 },
          ],
          linhas: d.mensal.map((m) => [
            m.rotulo,
            m.juros,
            m.atualizacaoMonetaria,
            m.apropriacaoCustos,
            m.total,
            m.capitalizados,
            m.despesaFinanceira,
            m.saldoMedio,
            m.taxaAnualizada,
          ]),
          total: [
            "12 meses",
            ...(["juros", "atualizacaoMonetaria", "apropriacaoCustos", "total", "capitalizados", "despesaFinanceira"] as const).map((k) =>
              d.mensal.reduce((s, m) => s + m[k], 0),
            ),
            "",
            "",
          ],
        },
        {
          nome: "Custo por contrato",
          titulo: "Custo por contrato na data-base",
          subtitulo: `${escopoLabel} · Taxas vigentes em ${fmtDate(db)} (último dado disponível importado do SAP)`,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Indexador", largura: 10 },
            { titulo: "Taxa contratada", largura: 30 },
            { titulo: "Saldo contábil", tipo: "moeda", largura: 18 },
            { titulo: "Taxa efetiva a.a.", tipo: "pct", largura: 16 },
            { titulo: "CET a.a. (c/ custos)", tipo: "pct", largura: 16 },
            { titulo: "Diferença vs CDI (p.p.)", tipo: "decimal", largura: 18 },
          ],
          linhas: d.custo.map((x) => [
            x.id,
            x.pos.c.indexador,
            taxaContratadaDivida(x.pos.c),
            x.pos.saldoContabil,
            x.pos.taxaEfetivaAA,
            x.pos.cet,
            (x.pos.taxaEfetivaAA - p.cdi) * 100,
          ]),
          total: ["Custo médio ponderado", "", "", d.saldoTotal, d.custoMedio, "", (d.custoMedio - p.cdi) * 100],
          notas: [
            `CDI vigente: ${fmtPct(p.cdi)} a.a. Taxa efetiva = juros + correção monetária, com as taxas vigentes na data-base.`,
            "O custo médio ponderado (taxa efetiva ponderada pelo saldo contábil) é a taxa usada nas Premissas.",
          ],
        },
        {
          nome: "Indexadores",
          titulo: "Custo médio por indexador",
          subtitulo: `${escopoLabel} · Saldos em ${fmtDate(db)} · encargos: ${rotulo}`,
          colunas: [
            { titulo: "Indexador", largura: 12 },
            { titulo: "Contratos", largura: 40 },
            { titulo: "Saldo contábil", tipo: "moeda", largura: 18 },
            { titulo: "Participação", tipo: "pct", largura: 14 },
            { titulo: "Custo médio a.a.", tipo: "pct", largura: 16 },
            { titulo: "Encargos do período", tipo: "moeda", largura: 18 },
            { titulo: "Taxa anualizada do período", tipo: "pct", largura: 18 },
          ],
          linhas: d.indexadores.map((x) => [
            x.indexador,
            x.contratos.join(", "),
            x.saldo,
            x.participacao,
            x.saldo > 0 ? x.custoMedio : null,
            x.encargos,
            x.taxaAnualizada,
          ]),
          total: ["Carteira", "", d.saldoTotal, 1, d.custoMedio, tot.total, tot.taxaAnualizada],
        },
        {
          nome: "CPC 20",
          titulo: "Capitalização de encargos em ativo qualificável (CPC 20)",
          subtitulo: `${escopoLabel} · ${rotulo}`,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Ativo qualificável", largura: 40 },
            { titulo: "Capitalização até", tipo: "data", largura: 16 },
            { titulo: "Capitalizado no período", tipo: "moeda", largura: 20 },
            { titulo: "Acumulado desde a captação", tipo: "moeda", largura: 22 },
            { titulo: "A capitalizar (projeção)", tipo: "moeda", largura: 22 },
          ],
          linhas: d.cpc20.map((x) => [x.c.id, x.ativo, x.ate, x.noPeriodo, x.acumulado, x.aCapitalizar]),
          notas: [
            "Encargos de empréstimos diretamente atribuíveis a ativo qualificável são capitalizados até o ativo ficar pronto para o uso pretendido (CPC 20).",
            `Valor a capitalizar projetado com o último dado disponível importado do SAP (${fmtDate(ultimoDado)}).`,
          ],
        },
      ],
      db,
    );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Encargos do período" value={fmtCompact(tot.total)} sub={`${curto} · ${dias} dias`} />
          <HeaderKpi label="Despesa financeira" value={fmtCompact(tot.despesaFinanceira)} sub="Encargos − capitalizados" />
          <HeaderKpi
            label="Juros capitalizados (CPC 20)"
            value={fmtCompact(tot.capitalizados)}
            state={tot.capitalizados > 0 ? "information" : "neutral"}
            sub={tot.capitalizados > 0 ? `${fmtPct(pctCapitalizado, 1)} dos encargos` : "Sem ativo qualificável"}
          />
          <HeaderKpi label="Custo médio ponderado" value={fmtPct(d.custoMedio)} unit="a.a." sub={`Posições em ${fmtDate(db)}`} />
          <HeaderKpi label="Taxa anualizada média" value={fmtPct(tot.taxaAnualizada)} unit="a.a." sub="Encargos ÷ saldo médio" />
        </>
      }
    >
      {/* Barra de filtros */}
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <FilterField label="Empresa" className="lg:w-80">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[13px] text-label">Período</span>
            <SegmentedButton value={periodo} onChange={setPeriodo} items={PERIODOS} className="self-start" />
          </div>
          <div className="lg:ml-auto text-[13px] text-label lg:text-right">
            <span className="text-text font-semibold">{rotulo}</span>
            <span className="block sm:inline">
              <span className="hidden sm:inline"> · </span>
              {periodoDatas} · {dias} dias · valores em R$
            </span>
          </div>
        </div>
      </div>

      {/* Encargos por contrato */}
      <Card
        title={`Encargos por contrato (${linhas.length})`}
        subtitle={`${rotulo} · custo amortizado, encargos realizados com as taxas históricas importadas do SAP`}
        bodyClassName="px-0 pb-0"
        className="min-w-0 overflow-hidden"
      >
        <div className="hidden lg:block">
          <DataTable
            columns={colunas}
            rows={linhas}
            rowKey={(x) => x.c.id}
            showTotals
            defaultSort={{ key: "total", dir: "desc" }}
            emptyText="Nenhum contrato com encargos no período"
          />
        </div>
        {/* Pop-in (sap.m.Table responsiva): em telas estreitas os valores descem para baixo do contrato */}
        <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
          {[...linhas]
            .sort((a, b) => b.total - a.total)
            .map((x) => (
              <li key={x.c.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm">
                      <span className="font-semibold text-text">{x.c.id}</span>
                      <span className="text-xs text-label"> · {x.c.modalidade} · {x.c.empresa}</span>
                    </div>
                    <div className="text-xs text-label">{taxaContratadaDivida(x.c)}</div>
                    {(x.captadoNoPeriodo || x.liquidadoNoPeriodo) && (
                      <div className="mt-1">
                        <Tag color={x.liquidadoNoPeriodo ? "#556b82" : "#0070f2"}>
                          {x.liquidadoNoPeriodo ? `Liquidado em ${fmtDate(x.c.vencimento)}` : `Captado em ${fmtDate(x.c.dataCaptacao)}`}
                        </Tag>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-text tabular">{fmtNum(x.total)}</div>
                    <div className="text-xs text-text tabular whitespace-nowrap">{fmtPct(x.taxaAnualizada)} a.a.</div>
                    <div className="text-xs text-label tabular whitespace-nowrap">{fmtPct(x.taxaPeriodo)} no período</div>
                  </div>
                </div>
                <PopInValores x={x} />
              </li>
            ))}
          <li className="px-4 py-3 bg-[#f5f6f7]">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-bold text-text">Total ({linhas.length})</div>
              <div className="text-right">
                <div className="text-sm font-bold text-text tabular">{fmtNum(tot.total)}</div>
                <div className="text-xs text-text tabular whitespace-nowrap">{fmtPct(tot.taxaAnualizada)} a.a.</div>
                <div className="text-xs text-label tabular whitespace-nowrap">{fmtPct(tot.taxaPeriodo)} no período</div>
              </div>
            </div>
            <PopInValores x={tot} />
          </li>
        </ul>
        <p className="text-xs text-label px-4 py-3 leading-relaxed border-t border-line-soft">
          Saldo médio = média dos saldos contábeis diários do período (dias sem saldo contam como zero). Taxa do período =
          total de encargos ÷ saldo médio; taxa anualizada = (1 + taxa do período)<sup>365/{dias}</sup> − 1 – inclui a
          apropriação dos custos de transação. Despesa financeira = encargos − capitalizados (CPC 20).
        </p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Gráfico mensal */}
        <Card
          className="xl:col-span-2 min-w-0 flex flex-col"
          bodyClassName="flex-1 flex flex-col"
          title="Encargos mensais – últimos 12 meses"
          subtitle={`R$ mil · juros, atualização monetária e apropriação de custos (barras) e despesa financeira (linha) · ${
            periodo === "12m" ? "todos os meses no período selecionado" : "meses do período selecionado em destaque"
          }`}
        >
          <div className="h-80 xl:h-auto xl:flex-1 xl:min-h-[320px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d.mensal} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="rotulo" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => fmtNum(v / 1000)} />
                <Tooltip cursor={{ fill: "#f2f4f6" }} content={({ active, payload }) => (active && payload?.length ? <TooltipMes m={payload[0].payload as MesEncargos} /> : null)} />
                <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
                <Bar dataKey="juros" name="Juros" stackId="e" fill={COR.juros} isAnimationActive={false}>
                  {d.mensal.map((m) => (
                    <Cell key={m.fim} fillOpacity={m.noPeriodo ? 1 : 0.35} />
                  ))}
                </Bar>
                <Bar dataKey="atualizacaoMonetaria" name="Atualização monetária" stackId="e" fill={COR.atualizacao} isAnimationActive={false}>
                  {d.mensal.map((m) => (
                    <Cell key={m.fim} fillOpacity={m.noPeriodo ? 1 : 0.35} />
                  ))}
                </Bar>
                <Bar
                  dataKey="apropriacaoCustos"
                  name="Apropriação de custos"
                  stackId="e"
                  fill={COR.custos}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                >
                  {d.mensal.map((m) => (
                    <Cell key={m.fim} fillOpacity={m.noPeriodo ? 1 : 0.35} />
                  ))}
                </Bar>
                <Line
                  dataKey="despesaFinanceira"
                  name="Despesa financeira"
                  stroke={COR.despesa}
                  strokeWidth={2}
                  dot={{ r: 3, fill: COR.despesa }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* CPC 20 */}
        <Card title="Juros capitalizados (CPC 20)" subtitle="Encargos atribuíveis a ativo qualificável" className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-label">Encargos – {curto}</span>
            <span className="text-base font-bold tabular text-text whitespace-nowrap">{fmtBRL(tot.total)}</span>
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-[#eff1f2] mt-2" aria-hidden>
            <div style={{ width: `${(1 - pctCapitalizado) * 100}%`, backgroundColor: "#475e75" }} />
            <div style={{ width: `${pctCapitalizado * 100}%`, backgroundColor: COR.capitalizado }} />
          </div>
          <ul className="mt-2.5 space-y-1.5 text-[13px]">
            <LinhaSplit cor="#475e75" rotulo="Despesa financeira" valor={tot.despesaFinanceira} pct={1 - pctCapitalizado} />
            <LinhaSplit cor={COR.capitalizado} rotulo="Capitalizados no ativo" valor={tot.capitalizados} pct={pctCapitalizado} />
          </ul>

          {d.cpc20.length ? (
            d.cpc20.map((x) => (
              <div key={x.c.id} className="mt-4 rounded-lg border border-line-soft px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-text">{x.c.id}</div>
                    <div className="text-xs text-label leading-snug">{x.c.instrumento}</div>
                  </div>
                  <ObjectStatus state={x.emAndamento ? "information" : "neutral"} inverted>
                    {x.emAndamento ? "Em capitalização" : "Encerrada"}
                  </ObjectStatus>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-3 text-[13px]">
                  <Item rotulo="Ativo qualificável" className="col-span-2">
                    {x.ativo}
                  </Item>
                  <Item rotulo="Capitalização até" sub={x.emAndamento ? `faltam ${x.diasRestantes} dias` : "ativo em operação"}>
                    {fmtDate(x.ate)}
                  </Item>
                  <Item rotulo="No período" sub={curto}>
                    {fmtBRL(x.noPeriodo)}
                  </Item>
                  <Item rotulo="Acumulado" sub={`desde ${fmtDate(x.c.dataCaptacao)}`}>
                    {fmtBRL(x.acumulado)}
                  </Item>
                  <Item rotulo="A capitalizar" sub={x.emAndamento ? `até ${fmtDate(x.ate)} · projeção` : undefined}>
                    {x.emAndamento ? fmtBRL(x.aCapitalizar) : "—"}
                  </Item>
                </dl>
              </div>
            ))
          ) : (
            <p className="mt-4 text-[13px] text-label rounded-lg bg-[#f5f6f7] px-3 py-2.5">
              Nenhum contrato da empresa selecionada financia ativo qualificável: todos os encargos vão para a despesa financeira.
            </p>
          )}

          <p className="text-xs text-label mt-3 leading-relaxed">
            Pelo CPC 20 (R1), os encargos de empréstimos diretamente atribuíveis à construção de um ativo qualificável são
            capitalizados como parte do custo do ativo até que ele fique pronto para o uso pretendido; a partir daí, passam à
            despesa financeira.
          </p>
        </Card>
      </div>

      {/* Custo da dívida */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card
          className="min-w-0"
          title="Custo por contrato"
          subtitle={`Taxa efetiva a.a. (juros + correção monetária) com as taxas vigentes em ${fmtDate(db)}`}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text mb-3">
            {indexadoresNoGrafico.map((ix) => (
              <span key={ix} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COR_INDEXADOR[ix] }} />
                {ix}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <svg width="18" height="8" aria-hidden>
                <line x1="0" y1="4" x2="18" y2="4" stroke={COR.cdi} strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              CDI vigente <strong className="tabular">{fmtPct(p.cdi)}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="18" height="8" aria-hidden>
                <line x1="0" y1="4" x2="18" y2="4" stroke={COR.custoMedio} strokeWidth="2" strokeDasharray="7 3" />
              </svg>
              Custo médio ponderado <strong className="tabular">{fmtPct(d.custoMedio)}</strong>
            </span>
          </div>
          <div className="-ml-2" style={{ height: Math.max(160, d.custo.length * 30 + 36) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.custo} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap={6}>
                <CartesianGrid horizontal={false} stroke="#e5e5e5" />
                <XAxis
                  type="number"
                  domain={[0, xMax]}
                  ticks={xTicks}
                  tickFormatter={(v: number) => `${fmtDec(v, 0)}%`}
                  tick={AXIS_STYLE}
                  tickLine={false}
                  axisLine={{ stroke: "#a8b2bd" }}
                />
                <YAxis yAxisId="id" type="category" dataKey="id" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={60} interval={0} />
                {/* Valores em coluna à direita da área do gráfico (não se sobrepõem às linhas de referência) */}
                <YAxis
                  yAxisId="valor"
                  orientation="right"
                  type="category"
                  dataKey="id"
                  tickFormatter={(id: string) => fmtPct((d.custo.find((x) => x.id === id)?.taxa ?? 0) / 100)}
                  tick={{ ...AXIS_STYLE, fill: "#1d2d3e", fontWeight: 600 }}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                  interval={0}
                />
                <Tooltip cursor={{ fill: "#f2f4f6" }} content={({ active, payload }) => (active && payload?.length ? <TooltipCusto x={payload[0].payload as CustoContrato} cdi={p.cdi} /> : null)} />
                <Bar yAxisId="id" dataKey="taxa" name="Taxa efetiva a.a." radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
                  {d.custo.map((x) => (
                    <Cell key={x.id} fill={x.cor} />
                  ))}
                </Bar>
                <ReferenceLine yAxisId="id" x={p.cdi * 100} stroke={COR.cdi} strokeWidth={1.5} strokeDasharray="4 3" />
                <ReferenceLine yAxisId="id" x={d.custoMedio * 100} stroke={COR.custoMedio} strokeWidth={1.5} strokeDasharray="7 3" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          className="min-w-0 overflow-hidden"
          title="Custo médio por indexador"
          subtitle="Taxa efetiva ponderada pelo saldo contábil na data-base e encargos do período"
          bodyClassName="px-0 pb-0"
        >
          <div className="hidden md:block">
            <DataTable columns={colIndexadores} rows={d.indexadores} rowKey={(x) => x.indexador} showTotals totalLabel="Carteira" />
          </div>
          <ul className="md:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
            {d.indexadores.map((x) => (
              <li key={x.indexador} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-text">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COR_INDEXADOR[x.indexador] }} />
                      {x.indexador}
                    </span>
                    <div className="text-xs text-label mt-0.5">{x.contratos.join(", ")}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-text tabular">{x.saldo > 0 ? fmtPct(x.custoMedio) : "—"}</div>
                    <div className="text-xs text-label whitespace-nowrap">custo médio a.a.</div>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2 text-[13px]">
                  <PopIn rotulo="Saldo contábil" valor={`${fmtCompact(x.saldo)} · ${fmtPct(x.participacao, 1)}`} />
                  <PopIn rotulo="Encargos no período" valor={`${fmtCompact(x.encargos)} · ${fmtPct(x.taxaAnualizada)} a.a.`} />
                </dl>
              </li>
            ))}
            <li className="px-4 py-3 bg-[#f5f6f7] flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-text">Carteira</div>
                <div className="text-xs text-label mt-0.5 tabular">
                  {fmtCompact(d.saldoTotal)} · encargos {fmtCompact(tot.total)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-text tabular">{fmtPct(d.custoMedio)}</div>
                <div className="text-xs text-label whitespace-nowrap">custo médio a.a.</div>
              </div>
            </li>
          </ul>
          <p className="text-xs text-label px-4 py-3 leading-relaxed border-t border-line-soft">
            Custo médio a.a.: taxas vigentes na data-base (as pós-fixadas projetadas com o último dado disponível importado do
            SAP, {fmtDate(ultimoDado)}). Encargos e taxa anualizada: realizados no período selecionado ({periodoDatas}).
          </p>
        </Card>
      </div>

      <MessageStrip design="information">
        <strong>O custo médio ponderado é a taxa usada nas </strong>
        <Link to="/premissas" className="text-link font-semibold hover:underline">
          Premissas
        </Link>
        <strong>.</strong> Corresponde à taxa efetiva a.a. de cada contrato (juros + correção monetária, com as taxas vigentes
        na data-base) ponderada pelo saldo contábil
        {escopo === "todas" ? (
          <>
            : <strong className="tabular">{fmtPct(d.custoMedio)} a.a.</strong> em {fmtDate(db)}.
          </>
        ) : (
          <>
            ; nas Premissas vale o consolidado de todas as empresas: <strong className="tabular">{fmtPct(custoMedioConsolidado)} a.a.</strong>{" "}
            em {fmtDate(db)} (empresa selecionada: {fmtPct(d.custoMedio)} a.a.).
          </>
        )}{" "}
        Diferente da taxa anualizada dos encargos, não inclui a apropriação dos custos de transação.
      </MessageStrip>
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Componentes auxiliares
// ---------------------------------------------------------------------------

function LinhaSplit({ cor, rotulo, valor, pct }: { cor: string; rotulo: string; valor: number; pct: number }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-2 text-text min-w-0">
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: cor }} />
        <span className="truncate">{rotulo}</span>
      </span>
      <span className="tabular whitespace-nowrap text-text">
        {fmtBRL(valor)} <span className="text-label">· {fmtPct(pct, 1)}</span>
      </span>
    </li>
  );
}

/** Colunas "pop-in" do quadro de encargos (telas estreitas) */
function PopInValores({ x }: { x: TotaisEncargos }) {
  const v = (n: number) => fmtNum(n, { dash: true });
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-2 text-[13px]">
      <PopIn rotulo="Saldo médio" valor={v(x.saldoMedio)} />
      <PopIn rotulo="Juros" valor={v(x.juros)} />
      <PopIn rotulo="Atualização monetária" valor={v(x.atualizacaoMonetaria)} />
      <PopIn rotulo="Apropriação de custos" valor={v(x.apropriacaoCustos)} />
      <PopIn rotulo="Capitalizados (CPC 20)" valor={<span className={x.capitalizados > 0 ? "text-info" : undefined}>{v(x.capitalizados)}</span>} />
      <PopIn rotulo="Despesa financeira" valor={v(x.despesaFinanceira)} />
    </dl>
  );
}

function PopIn({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-label">{rotulo}</dt>
      <dd className="text-text font-semibold tabular">{valor}</dd>
    </div>
  );
}

function Item({ rotulo, sub, children, className }: { rotulo: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `min-w-0 ${className}` : "min-w-0"}>
      <dt className="text-xs text-label leading-tight">{rotulo}</dt>
      <dd className="text-text font-semibold tabular leading-snug mt-0.5">{children}</dd>
      {sub && <dd className="text-xs text-label leading-tight">{sub}</dd>}
    </div>
  );
}

function TooltipMes({ m }: { m: MesEncargos }) {
  const linhas: { rotulo: string; v: number; cor?: string; forte?: boolean }[] = [
    { rotulo: "Juros", v: m.juros, cor: COR.juros },
    { rotulo: "Atualização monetária", v: m.atualizacaoMonetaria, cor: COR.atualizacao },
    { rotulo: "Apropriação de custos", v: m.apropriacaoCustos, cor: COR.custos },
    { rotulo: "Total de encargos", v: m.total, forte: true },
    { rotulo: "(−) Capitalizados (CPC 20)", v: -m.capitalizados },
    { rotulo: "Despesa financeira", v: m.despesaFinanceira, cor: COR.despesa, forte: true },
  ];
  return (
    <div className="bg-white px-3 py-2 shadow-fiori" style={tooltipStyle}>
      <div className="font-semibold text-text mb-1">{fmtMonthLong(m.fim)}</div>
      <table className="text-xs">
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className={l.forte ? "font-semibold text-text" : "text-label"}>
              <td className="pr-4 py-0.5 whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.cor ?? "transparent" }} />
                  {l.rotulo}
                </span>
              </td>
              <td className="text-right tabular text-text whitespace-nowrap">{fmtNum(l.v, { parens: true, dash: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-label mt-1">Taxa anualizada do mês: {fmtPct(m.taxaAnualizada)}</div>
    </div>
  );
}

function TooltipCusto({ x, cdi }: { x: CustoContrato; cdi: number }) {
  const dif = (x.pos.taxaEfetivaAA - cdi) * 100;
  return (
    <div className="bg-white px-3 py-2 shadow-fiori max-w-[280px]" style={tooltipStyle}>
      <div className="font-semibold text-text">{x.id}</div>
      <div className="text-xs text-label leading-snug">{x.pos.c.instrumento}</div>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs mt-1.5">
        <dt className="text-label">Taxa contratada</dt>
        <dd className="text-right text-text whitespace-nowrap">{taxaContratadaDivida(x.pos.c)}</dd>
        <dt className="text-label">Taxa efetiva a.a.</dt>
        <dd className="text-right text-text font-semibold tabular">{fmtPct(x.pos.taxaEfetivaAA)}</dd>
        <dt className="text-label">vs CDI vigente</dt>
        <dd className="text-right text-text tabular">
          {dif >= 0 ? "+" : "−"}
          {fmtDec(Math.abs(dif), 2)} p.p.
        </dd>
        <dt className="text-label">CET (c/ custos)</dt>
        <dd className="text-right text-text tabular">{fmtPct(x.pos.cet)}</dd>
        <dt className="text-label">Saldo contábil</dt>
        <dd className="text-right text-text tabular">{fmtCompact(x.pos.saldoContabil)}</dd>
      </dl>
    </div>
  );
}
