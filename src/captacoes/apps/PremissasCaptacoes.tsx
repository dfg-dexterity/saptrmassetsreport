import { Lock } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { AXIS_STYLE, CHART_COLORS, HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { CDI_MENSAL, FONTES_SAP, IMPORTACAO_SAP, PRIMEIRO_MES_CDI, ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import { addMonths, fmtDate, fmtMonthLong, fmtMonthShort } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtInt, fmtPct } from "../../shared/lib/format";
import { useDivida } from "../context/useDivida";
import { relatorioCaptacao } from "../data/catalogo";
import type { ContratoDivida, IndexadorDivida } from "../data/contratos";
import { custoMedioPonderado, prazoMedioCarteira, totalDivida, type PosicaoDivida } from "../lib/divida";

const rel = relatorioCaptacao("premissas");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };
const COR_CDI = CHART_COLORS[0];
const MESES_PROJECAO = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "2026-03-31T19:05:00" → "31/03/2026 às 19:05" (sem conversão de fuso) */
function fmtDataHora(iso: string): string {
  return `${fmtDate(iso.slice(0, 10))} às ${iso.slice(11, 16)}`;
}

/** Último dado de mercado disponível na data-base (a importação pode ter dados posteriores a ela) */

/** Spread total a.a. do contrato (TJLP indireto: spread BNDES composto com o spread do agente financeiro) */
function spreadTotal(c: ContratoDivida): number {
  return (1 + c.spread) * (1 + (c.spreadAgente ?? 0)) - 1;
}

function ponderar(pos: PosicaoDivida[], fn: (x: PosicaoDivida) => number): number {
  const saldo = totalDivida(pos);
  return saldo > 0 ? pos.reduce((s, x) => s + fn(x) * x.saldoContabil, 0) / saldo : 0;
}

// ---------------------------------------------------------------------------
// Premissas gerais
// ---------------------------------------------------------------------------

interface LinhaPremissa {
  id: string;
  rotulo: string;
  uso: string;
  valor: string;
  valorSub?: string;
  /** valor exportado para o Excel (taxas em % a.a.) */
  excel: string | number;
  unidade: string;
  fonte: string;
  atualizacao: string;
}

function linhasPremissas(p: PremissasMercado, abertura: string, ultimoDado: string): LinhaPremissa[] {
  const atualizado = fmtDate(ultimoDado);
  return [
    {
      id: "dataBase",
      rotulo: "Data-base",
      uso: "Data de corte da carteira, dos saldos e das projeções (C00 a C06)",
      valor: fmtDate(p.dataBase),
      valorSub: fmtMonthLong(p.dataBase),
      excel: fmtDate(p.dataBase),
      unidade: "data",
      fonte: "Data de corte do fechamento (selecionável na barra superior)",
      atualizacao: "—",
    },
    {
      id: "abertura",
      rotulo: "Data de abertura do período",
      uso: "Saldo inicial da movimentação (C01) e início dos encargos do exercício (C03)",
      valor: fmtDate(abertura),
      valorSub: "31/12 do exercício anterior",
      excel: fmtDate(abertura),
      unidade: "data",
      fonte: "Derivada da data-base (encerramento do exercício anterior)",
      atualizacao: "—",
    },
    {
      id: "cdi",
      rotulo: "CDI a.a.",
      uso: "Juros dos contratos CDI + spread (debêntures, CRA DI e CCB)",
      valor: fmtPct(p.cdi),
      excel: p.cdi * 100,
      unidade: "% a.a.",
      fonte: FONTES_SAP.cdi,
      atualizacao: atualizado,
    },
    {
      id: "selic",
      rotulo: "Selic a.a.",
      uso: "Referência de mercado – nenhum contrato da carteira é indexado à Selic",
      valor: fmtPct(p.selic),
      excel: p.selic * 100,
      unidade: "% a.a.",
      fonte: FONTES_SAP.selic,
      atualizacao: atualizado,
    },
    {
      id: "ipca12m",
      rotulo: "IPCA 12 meses",
      uso: "Correção monetária do principal (IPCA + spread e TLP)",
      valor: fmtPct(p.ipca12m),
      excel: p.ipca12m * 100,
      unidade: "% (12 meses)",
      fonte: FONTES_SAP.ipca12m,
      atualizacao: atualizado,
    },
    {
      id: "tjlp",
      rotulo: "TJLP a.a.",
      uso: "BNDES FINEM – direto e indireto",
      valor: fmtPct(p.tjlp),
      excel: p.tjlp * 100,
      unidade: "% a.a.",
      fonte: FONTES_SAP.tjlp,
      atualizacao: atualizado,
    },
    {
      id: "tlpReal",
      rotulo: "TLP – taxa real a.a.",
      uso: "BNDES FINAME (TLP = taxa real + IPCA)",
      valor: fmtPct(p.tlpReal),
      excel: p.tlpReal * 100,
      unidade: "% a.a. (real)",
      fonte: FONTES_SAP.tlpReal,
      atualizacao: atualizado,
    },
    {
      id: "baseDiasCorridos",
      rotulo: "Base de dias dos encargos da dívida",
      uso: "Juros exponenciais, correção monetária e apropriação dos custos de transação (pro rata die)",
      valor: `${fmtInt(p.baseDiasCorridos)} dias corridos`,
      excel: p.baseDiasCorridos,
      unidade: "dias corridos",
      fonte: FONTES_SAP.baseDiasCorridos,
      atualizacao: "Parâmetro fixo",
    },
    {
      id: "baseDiasUteis",
      rotulo: "Base de dias úteis",
      uso: "Referência de mercado para taxas DI (os encargos da dívida usam dias corridos)",
      valor: `${fmtInt(p.baseDiasUteis)} dias úteis`,
      excel: p.baseDiasUteis,
      unidade: "dias úteis",
      fonte: FONTES_SAP.baseDiasUteis,
      atualizacao: "Parâmetro fixo",
    },
  ];
}

// ---------------------------------------------------------------------------
// Indexadores da dívida
// ---------------------------------------------------------------------------

interface DefIndexador {
  id: Exclude<IndexadorDivida, "Pré">;
  nome: string;
  formula: string;
  /** composição usada na taxa efetiva, quando difere da fórmula de juros */
  efetiva?: string;
  taxa: (p: PremissasMercado) => number;
  taxaSub: (p: PremissasMercado) => string;
}

const INDEXADORES: DefIndexador[] = [
  {
    id: "CDI",
    nome: "CDI",
    formula: "(1 + CDI) × (1 + spread) − 1",
    taxa: (p) => p.cdi,
    taxaSub: () => "a.a.",
  },
  {
    id: "IPCA",
    nome: "IPCA",
    formula: "spread + correção do principal pelo IPCA",
    efetiva: "Taxa efetiva: (1 + IPCA) × (1 + spread) − 1",
    taxa: (p) => p.ipca12m,
    taxaSub: () => "12 meses",
  },
  {
    id: "TJLP",
    nome: "TJLP",
    formula: "(1 + TJLP) × (1 + spread) × (1 + spread do agente) − 1",
    taxa: (p) => p.tjlp,
    taxaSub: () => "a.a.",
  },
  {
    id: "TLP",
    nome: "TLP",
    formula: "(1 + TLP real) × (1 + spread) − 1 + correção IPCA",
    efetiva: "Taxa efetiva: (1 + TLP real) × (1 + spread) × (1 + IPCA) − 1",
    taxa: (p) => p.tlpReal,
    taxaSub: (p) => `real + IPCA ${fmtPct(p.ipca12m)}`,
  },
];

interface LinhaIndexador {
  def: DefIndexador;
  posicoes: PosicaoDivida[];
  saldo: number;
  participacao: number;
  spread: number;
  taxaEfetiva: number;
  cor: string;
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function PremissasCaptacoes() {
  const { premissas: p, posicoes, abertura } = useDivida();
  const ultimoDado = ultimoDadoNaDataBase(p.dataBase);
  const importacao = fmtDataHora(IMPORTACAO_SAP.ultimaImportacao);

  const d = useMemo(() => {
    const saldoTotal = totalDivida(posicoes);
    const indexadores: LinhaIndexador[] = INDEXADORES.map((def, i) => {
      const pos = posicoes.filter((x) => x.c.indexador === def.id);
      const saldo = totalDivida(pos);
      return {
        def,
        posicoes: pos,
        saldo,
        participacao: saldoTotal > 0 ? saldo / saldoTotal : 0,
        spread: ponderar(pos, (x) => spreadTotal(x.c)),
        taxaEfetiva: ponderar(pos, (x) => x.taxaEfetivaAA),
        cor: CHART_COLORS[i],
      };
    });

    // CDI mensal: realizado (importado do SAP) até o mês da data-base + projeção com o último dado disponível
    const mesBase = p.dataBase.slice(0, 7);
    const cdi: { mes: string; realizado: number | null; projecao: number | null }[] = [];
    for (let mes = PRIMEIRO_MES_CDI; mes <= mesBase; mes = addMonths(`${mes}-01`, 1).slice(0, 7)) {
      const v = CDI_MENSAL[mes] ?? p.cdi;
      cdi.push({ mes, realizado: v * 100, projecao: mes === mesBase ? p.cdi * 100 : null });
    }
    for (let i = 1; i <= MESES_PROJECAO; i++) {
      cdi.push({ mes: addMonths(`${mesBase}-01`, i).slice(0, 7), realizado: null, projecao: p.cdi * 100 });
    }

    const realizados = cdi.filter((x) => x.realizado !== null).map((x) => (x.realizado as number) / 100);
    const ultimos12 = realizados.slice(-12);
    const media12m = ultimos12.reduce((s, v) => s + v, 0) / Math.max(1, ultimos12.length);
    const mes12Antes = addMonths(`${mesBase}-01`, -12).slice(0, 7);
    const variacao12m = p.cdi - (CDI_MENSAL[mes12Antes] ?? realizados[0] ?? p.cdi);

    return {
      saldoTotal,
      media12m,
      variacao12m,
      indexadores,
      custoMedio: custoMedioPonderado(posicoes),
      cetMedio: ponderar(posicoes, (x) => x.cet),
      prazoMedio: prazoMedioCarteira(posicoes),
      cdi,
      mesBase,
    };
  }, [posicoes, p]);

  const premissas = linhasPremissas(p, abertura, ultimoDado);
  const primeiroMes = d.cdi[0].mes;
  const ultimoMes = d.cdi[d.cdi.length - 1].mes;
  const mesLongo = (m: string) => fmtMonthLong(`${m}-01`);
  const mesCurto = (m: string) => fmtMonthShort(`${m}-01`);
  const primeiroProjetado = addMonths(`${d.mesBase}-01`, 1).slice(0, 7);
  const ticksAno = d.cdi.filter((x) => x.mes.endsWith("-01")).map((x) => x.mes);

  const exportar = () =>
    exportarExcel(
      `Premissas_Captacoes_${p.dataBase}.xlsx`,
      [
        {
          nome: "Premissas",
          titulo: "Premissas – Captações",
          subtitulo: `Premissas gerais importadas do SAP (${IMPORTACAO_SAP.sistema}) em ${importacao}`,
          colunas: [
            { titulo: "Premissa", largura: 36 },
            { titulo: "Valor", tipo: "decimal", largura: 14 },
            { titulo: "Unidade", largura: 16 },
            { titulo: "Fonte no SAP", largura: 62 },
            { titulo: "Última atualização", largura: 18 },
            { titulo: "Uso nos relatórios de captações", largura: 70 },
          ],
          linhas: [
            ...premissas.map((x) => [x.rotulo, x.excel, x.unidade, x.fonte, x.atualizacao, x.uso]),
            [
              "Custo médio ponderado da dívida",
              d.custoMedio * 100,
              "% a.a.",
              "Calculado a partir da carteira (C00) e dos encargos (C03)",
              fmtDate(p.dataBase),
              "Taxa efetiva (juros + correção monetária) ponderada pelo saldo contábil",
            ],
            ["Prazo médio da carteira", d.prazoMedio, "anos", "Calculado a partir do cronograma de amortização (C02)", fmtDate(p.dataBase), "Prazo médio do principal ponderado pelo saldo atualizado"],
          ],
          notas: [
            "Premissas somente leitura: para alterá-las, atualize os dados de mercado no SAP e reimporte.",
            `Valores futuros projetados com o último dado disponível (${fmtDate(ultimoDado)}), mantido constante após a data-base.`,
          ],
        },
        {
          nome: "Indexadores",
          titulo: "Indexadores da dívida",
          subtitulo: "Taxas vigentes, contratos e médias ponderadas pelo saldo contábil",
          colunas: [
            { titulo: "Indexador", largura: 12 },
            { titulo: "Fórmula da taxa", largura: 52 },
            { titulo: "Taxa vigente do indexador", tipo: "pct", largura: 16 },
            { titulo: "Contratos", largura: 44 },
            { titulo: "Qtde.", tipo: "inteiro", largura: 8 },
            { titulo: "Saldo contábil (R$)", tipo: "moeda", largura: 20 },
            { titulo: "Participação", tipo: "pct", largura: 14 },
            { titulo: "Spread médio ponderado", tipo: "pct", largura: 16 },
            { titulo: "Taxa efetiva média ponderada", tipo: "pct", largura: 18 },
          ],
          linhas: d.indexadores.map((x) => [
            x.def.nome,
            x.def.formula,
            x.def.taxa(p),
            x.posicoes.map((y) => y.c.id).join(", "),
            x.posicoes.length,
            x.saldo,
            x.participacao,
            x.posicoes.length ? x.spread : null,
            x.posicoes.length ? x.taxaEfetiva : null,
          ]),
          total: ["Total", "", "", "", posicoes.length, d.saldoTotal, 1, "", d.custoMedio],
          notas: [
            "Spread médio ponderado da TJLP inclui o spread do agente financeiro (composto).",
            "Taxa efetiva a.a. = juros + correção monetária, com as taxas vigentes na data-base; total = custo médio ponderado da dívida.",
            "Taxas pós-fixadas projetadas com o último dado disponível importado do SAP.",
          ],
        },
        {
          nome: "CDI mensal",
          titulo: "CDI – histórico importado do SAP × projeção",
          subtitulo: `Realizado de ${mesLongo(primeiroMes)} a ${mesLongo(d.mesBase)}; projeção de ${mesLongo(primeiroProjetado)} a ${mesLongo(ultimoMes)}`,
          colunas: [
            { titulo: "Mês", largura: 12 },
            { titulo: "CDI a.a.", tipo: "pct", largura: 12 },
            { titulo: "Origem", largura: 40 },
          ],
          linhas: d.cdi.map((x) => [
            mesCurto(x.mes),
            ((x.realizado ?? x.projecao) as number) / 100,
            x.realizado !== null ? "Realizado – importado do SAP" : "Projeção – último dado disponível",
          ]),
        },
      ],
      p.dataBase,
    );

  const colPremissas: Column<LinhaPremissa>[] = [
    {
      key: "premissa",
      header: "Premissa",
      minWidth: 280,
      render: (x) => (
        <div className="min-w-0 py-0.5">
          <div className="font-semibold text-text">{x.rotulo}</div>
          <div className="text-xs text-label leading-snug mt-0.5">{x.uso}</div>
        </div>
      ),
    },
    {
      key: "valor",
      header: "Valor",
      align: "right",
      minWidth: 150,
      render: (x) => (
        <div>
          <div className="inline-flex items-center gap-1.5 font-bold text-text">
            <Lock className="w-3 h-3 text-label shrink-0" aria-label="Somente leitura" />
            {x.valor}
          </div>
          {x.valorSub && <div className="text-xs text-label font-normal">{x.valorSub}</div>}
        </div>
      ),
    },
    {
      key: "fonte",
      header: "Fonte no SAP",
      minWidth: 300,
      render: (x) => <span className="text-label">{x.fonte}</span>,
    },
    {
      key: "atualizacao",
      header: "Última atualização",
      align: "right",
      minWidth: 140,
      render: (x) => <span className={x.atualizacao.includes("/") ? "text-text" : "text-label"}>{x.atualizacao}</span>,
    },
  ];

  const colIndexadores: Column<LinhaIndexador>[] = [
    {
      key: "indexador",
      header: "Indexador",
      minWidth: 110,
      render: (x) => (
        <span className="inline-flex items-center gap-2 font-semibold">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: x.cor }} />
          {x.def.nome}
        </span>
      ),
      total: () => "Total da carteira",
    },
    {
      key: "formula",
      header: "Fórmula da taxa",
      minWidth: 300,
      render: (x) => (
        <div className="py-0.5">
          <div className="text-text">{x.def.formula}</div>
          {x.def.efetiva && <div className="text-xs text-label mt-0.5">{x.def.efetiva}</div>}
        </div>
      ),
    },
    {
      key: "taxa",
      header: "Taxa vigente",
      align: "right",
      minWidth: 120,
      render: (x) => (
        <div>
          <div className="font-semibold">{fmtPct(x.def.taxa(p))}</div>
          <div className="text-xs text-label">{x.def.taxaSub(p)}</div>
        </div>
      ),
    },
    {
      key: "contratos",
      header: "Contratos",
      minWidth: 200,
      render: (x) =>
        x.posicoes.length ? (
          <div className="flex flex-wrap gap-1 max-w-[320px]">
            {x.posicoes.map((y) => (
              <Tag key={y.c.id}>{y.c.id}</Tag>
            ))}
          </div>
        ) : (
          <span className="text-label">Nenhum contrato ativo</span>
        ),
      total: () => (
        <span className="font-semibold">
          {posicoes.length} contrato{posicoes.length === 1 ? "" : "s"}
        </span>
      ),
    },
    {
      key: "saldo",
      header: "Saldo contábil",
      align: "right",
      minWidth: 150,
      render: (x) => (
        <div>
          <div className="font-semibold">{fmtBRL(x.saldo)}</div>
          <div className="text-xs text-label">{fmtPct(x.participacao, 1)} da carteira</div>
        </div>
      ),
      total: () => fmtBRL(d.saldoTotal),
    },
    {
      key: "spread",
      header: "Spread médio",
      headerTitle: "Spread médio ponderado pelo saldo contábil",
      align: "right",
      minWidth: 120,
      render: (x) => (x.posicoes.length ? fmtPct(x.spread) : "—"),
    },
    {
      key: "efetiva",
      header: "Taxa efetiva média",
      headerTitle: "Taxa efetiva a.a. (juros + correção monetária) média ponderada pelo saldo contábil",
      align: "right",
      minWidth: 140,
      render: (x) => <span className="font-bold">{x.posicoes.length ? fmtPct(x.taxaEfetiva) : "—"}</span>,
      total: () => fmtPct(d.custoMedio),
    },
  ];

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="CDI a.a." value={fmtPct(p.cdi)} sub={`Selic ${fmtPct(p.selic)}`} />
          <HeaderKpi label="IPCA 12 meses" value={fmtPct(p.ipca12m)} sub={`TJLP ${fmtPct(p.tjlp)} · TLP ${fmtPct(p.tlpReal)} real`} />
          <HeaderKpi label="Custo médio da dívida" value={fmtPct(d.custoMedio)} state="information" sub="a.a. · ponderado pelo saldo" />
          <HeaderKpi label="Prazo médio" value={fmtDec(d.prazoMedio, 1)} unit="anos" sub={`${posicoes.length} contratos ativos`} />
        </>
      }
    >
      <MessageStrip design="information">
        As premissas gerais são <strong>importadas do SAP</strong> ({IMPORTACAO_SAP.sistema}) e são somente leitura. Última
        importação em {importacao}; último dado disponível na data-base: <strong>{fmtDate(ultimoDado)}</strong>. Os valores
        futuros (juros, correção monetária e cronograma) são projetados usando o último dado disponível, mantido constante
        após a data-base. Para alterar uma premissa, atualize os dados de mercado no SAP.
      </MessageStrip>

      <Card
        title="Premissas gerais"
        subtitle={`Vigentes na data-base ${fmtDate(p.dataBase)} · importação de ${importacao}`}
        status={
          <Tag color="#556b82">
            <Lock className="w-2.5 h-2.5 mr-1" />
            Importado do SAP
          </Tag>
        }
        bodyClassName="px-0 pb-0"
      >
        <div className="hidden lg:block">
          <DataTable columns={colPremissas} rows={premissas} rowKey={(x) => x.id} />
        </div>
        {/* Pop-in (sap.m.Table responsiva): em telas estreitas as colunas descem para baixo da premissa */}
        <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
          {premissas.map((x) => (
            <li key={x.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text">{x.rotulo}</div>
                  <div className="text-xs text-label leading-snug mt-0.5">{x.uso}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="inline-flex items-center gap-1.5 text-sm font-bold text-text tabular whitespace-nowrap">
                    <Lock className="w-3 h-3 text-label shrink-0" aria-label="Somente leitura" />
                    {x.valor}
                  </div>
                  {x.valorSub && <div className="text-xs text-label">{x.valorSub}</div>}
                </div>
              </div>
              <div className="text-xs text-label leading-snug mt-1.5">
                <span className="text-text">Fonte no SAP:</span> {x.fonte}
                {x.atualizacao !== "—" && (
                  <>
                    {" · "}
                    <span className="text-text">Última atualização:</span> {x.atualizacao}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Indexadores da dívida"
        subtitle="Taxas vigentes na data-base e médias ponderadas pelo saldo contábil (custo amortizado)"
        bodyClassName="px-0 pb-0"
      >
        <div className="hidden xl:block">
          <DataTable columns={colIndexadores} rows={d.indexadores} rowKey={(x) => x.def.id} showTotals totalLabel="Total da carteira" />
        </div>
        <ul className="xl:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
          {d.indexadores.map((x) => (
            <li key={x.def.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-text">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: x.cor }} />
                  {x.def.nome}
                </span>
                <div className="text-right">
                  <div className="text-sm font-bold text-text tabular">{x.posicoes.length ? fmtPct(x.taxaEfetiva) : "—"}</div>
                  <div className="text-xs text-label">taxa efetiva média</div>
                </div>
              </div>
              <div className="text-[13px] text-text mt-1">{x.def.formula}</div>
              {x.def.efetiva && <div className="text-xs text-label mt-0.5">{x.def.efetiva}</div>}
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-2.5 text-[13px]">
                <PopIn rotulo="Taxa vigente" valor={`${fmtPct(x.def.taxa(p))} ${x.def.taxaSub(p)}`} />
                <PopIn rotulo="Spread médio" valor={x.posicoes.length ? fmtPct(x.spread) : "—"} />
                <PopIn rotulo="Saldo contábil" valor={fmtBRL(x.saldo)} />
                <PopIn rotulo="Participação" valor={`${fmtPct(x.participacao, 1)} da carteira`} />
              </dl>
              <div className="flex flex-wrap gap-1 mt-2.5">
                {x.posicoes.length ? (
                  x.posicoes.map((y) => <Tag key={y.c.id}>{y.c.id}</Tag>)
                ) : (
                  <span className="text-xs text-label">Nenhum contrato ativo</span>
                )}
              </div>
            </li>
          ))}
          <li className="px-4 py-3 bg-[#f5f6f7] flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-text">Total da carteira</div>
              <div className="text-xs text-label mt-0.5 tabular">
                {posicoes.length} contratos · {fmtBRL(d.saldoTotal)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-text tabular">{fmtPct(d.custoMedio)}</div>
              <div className="text-xs text-label whitespace-nowrap">custo médio</div>
            </div>
          </li>
        </ul>
        <p className="text-xs text-label px-4 py-3 leading-relaxed border-t border-line-soft xl:border-t-0">
          Spread médio da TJLP inclui o spread do agente financeiro (BNDES indireto), composto ao spread do BNDES. Taxa efetiva
          = juros + correção monetária do principal, com as taxas vigentes na data-base; as parcelas futuras são projetadas
          com o último dado disponível importado do SAP.
        </p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card
          className="xl:col-span-2"
          title="Custo médio ponderado da dívida"
          subtitle="Taxa efetiva a.a. ponderada pelo saldo contábil na data-base"
        >
          <div className="flex items-baseline gap-1.5">
            <span className="text-[2.25rem] leading-none font-light tabular text-[#0070f2]">{fmtPct(d.custoMedio)}</span>
            <span className="text-sm text-label">a.a.</span>
          </div>
          <div className="text-[13px] text-label mt-1.5">
            Equivale a {fmtDec(p.cdi > 0 ? (d.custoMedio / p.cdi) * 100 : 0, 1)}% do CDI vigente ({fmtPct(p.cdi)} a.a.)
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <Mini rotulo="Prazo médio" valor={`${fmtDec(d.prazoMedio, 1)} anos`} />
            <Mini rotulo="Saldo contábil" valor={fmtCompact(d.saldoTotal)} />
            <Mini rotulo="Contratos ativos" valor={fmtInt(posicoes.length)} />
            <Mini rotulo="CET médio (c/ custos)" valor={fmtPct(d.cetMedio)} />
          </div>

          <div className="mt-5">
            <div className="text-[13px] font-semibold text-text mb-2">Composição por indexador</div>
            <ul className="space-y-2.5">
              {d.indexadores.map((x) => (
                <li key={x.def.id}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="inline-flex items-center gap-2 text-text font-semibold">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: x.cor }} />
                      {x.def.nome}
                    </span>
                    <span className="tabular text-label whitespace-nowrap">
                      {fmtPct(x.participacao, 1)} do saldo · <span className="text-text font-semibold">{fmtPct(x.taxaEfetiva)}</span> a.a.
                    </span>
                  </div>
                  <MicroBar className="mt-1.5" value={x.participacao} color={x.cor} />
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-label mt-4 leading-relaxed">
            Calculado a partir da carteira (
            <Link to="/c00-carteira" className="text-link hover:underline">
              C00
            </Link>
            ) e dos encargos (
            <Link to="/c03-encargos" className="text-link hover:underline">
              C03
            </Link>
            ): taxa efetiva de cada contrato (juros + correção monetária) ponderada pelo saldo contábil. Prazo médio do principal
            pelo cronograma de amortização; taxas pós-fixadas projetadas com o último dado disponível.
          </p>
        </Card>

        <Card
          className="xl:col-span-3 flex flex-col"
          bodyClassName="flex-1 flex flex-col"
          title="CDI: histórico importado do SAP × projeção"
          subtitle={`% a.a. · realizado de ${mesCurto(primeiroMes)} a ${mesCurto(d.mesBase)}; projeção de ${mesCurto(primeiroProjetado)} a ${mesCurto(ultimoMes)} com o último dado disponível (${fmtPct(p.cdi)})`}
        >
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Mini rotulo="Último dado" valor={fmtPct(p.cdi)} />
            <Mini
              rotulo="Variação em 12 meses"
              valor={`${d.variacao12m >= 0 ? "+" : "−"}${fmtDec(Math.abs(d.variacao12m) * 100, 2)} p.p.`}
            />
            <Mini rotulo="Média 12 meses" valor={fmtPct(d.media12m)} />
          </div>
          <div className="h-72 sm:h-80 xl:h-auto xl:flex-1 xl:min-h-[320px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.cdi} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <ReferenceArea x1={d.mesBase} x2={ultimoMes} fill="#0070f2" fillOpacity={0.05} ifOverflow="visible" />
                <XAxis
                  dataKey="mes"
                  ticks={ticksAno}
                  interval={0}
                  tickFormatter={mesCurto}
                  tick={AXIS_STYLE}
                  tickLine={false}
                  axisLine={{ stroke: "#a8b2bd" }}
                />
                <YAxis
                  domain={[8, 16]}
                  ticks={[8, 10, 12, 14, 16]}
                  tickFormatter={(v: number) => `${fmtDec(v, 0)}%`}
                  tick={AXIS_STYLE}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(m: string) => mesLongo(m)}
                  formatter={(v: number, n: string) => [`${fmtDec(v, 2)}% a.a.`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="plainline" iconSize={16} />
                <ReferenceLine
                  x={d.mesBase}
                  stroke="#1d2d3e"
                  strokeWidth={1.25}
                  label={{ value: `Data-base ${fmtDate(p.dataBase)}`, fill: "#1d2d3e", fontSize: 11, position: "insideTopRight", offset: 6 }}
                />
                <Line
                  dataKey="realizado"
                  name="Realizado (importado do SAP)"
                  type="stepAfter"
                  stroke={COR_CDI}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="projecao"
                  name="Projeção (último dado disponível)"
                  type="stepAfter"
                  stroke={COR_CDI}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </ReportPage>
  );
}

function Mini({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="rounded-lg bg-[#f5f6f7] px-3 py-2 min-w-0 flex flex-col justify-between">
      <div className="text-xs text-label leading-tight">{rotulo}</div>
      <div className="text-base sm:text-lg font-bold tabular text-text whitespace-nowrap mt-0.5">{valor}</div>
    </div>
  );
}

/** Coluna "pop-in" da tabela responsiva (rótulo + valor) */
function PopIn({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-label">{rotulo}</dt>
      <dd className="text-text font-semibold tabular">{valor}</dd>
    </div>
  );
}
