import clsx from "clsx";
import { ArrowUpRight, CheckCircle2, ChevronRight, X, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../../shared/components/fiori/Button";
import { Card, Field } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, SearchField, Select } from "../../shared/components/fiori/Inputs";
import { HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { ObjectStatus, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { EMPRESAS } from "../../shared/data/empresas";
import { fmtDate, previousYearEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtInt, fmtNum, fmtPct, plural } from "../../shared/lib/format";
import { relatorioPorId } from "../data/catalogo";
import type { ClassificacaoCPC48 } from "../data/carteira";
import { PARAMETROS_TIME_DEPOSIT } from "../data/timeDeposits";
import { ESCOPOS, useMestre, type Escopo } from "../context/useDados";
import { COR_MOEDA, MOEDAS, movimentacaoMestre, TIPOS_CONTRATO, type ContratoMestre, type Moeda, type TipoContrato } from "../lib/carteiraMestre";

const rel = relatorioPorId("mestre");

const TODOS = "__todos";

const CPC48_STATE: Record<ClassificacaoCPC48, ValueState> = {
  "Custo Amortizado": "information",
  "VJ por ORA": "neutral",
  "VJ por Resultado": "critical",
};

/** Base do saldo bruto de cada tipo de contrato */
const BASE_SALDO: Record<TipoContrato, string> = {
  "Renda fixa bancária": "curva",
  "Tesouro Direto": "curva",
  "Fundo de investimento": "valor da cota",
  "Time deposit": "moeda × PTAX",
};

const TD = PARAMETROS_TIME_DEPOSIT;

const NOTA_RODAPE =
  "Saldo bruto: curva na renda fixa bancária e nos títulos públicos, valor da cota nos fundos e saldo em moeda × PTAX da data-base nos time deposits. Valor contábil = curva no custo amortizado e mercado no valor justo (CPC 48); renda fixa bancária a mercado pelo ágio/deságio informado.";

const NOTA_TRIBUTOS = `IR: IRRF regressivo (renda fixa, títulos e fundos, inclusive come-cotas) e, nos time deposits, IRPJ/CSLL de 34% sobre o resultado – sem IOF provisório. IOF realizado: nos time deposits, IOF câmbio na remessa (${fmtPct(TD.iofCambio)} a partir de ${fmtDate(TD.inicioIofInvestimento)} – Decreto 6.306/2007, art. 15-B; ${fmtPct(TD.iofCambioGeral)} antes); nos demais contratos é zero, pois o IOF regressivo só incide no resgate antes de 30 dias. PIS/COFINS sobre receitas financeiras (4,65%) não modelado.`;

const infoTipo = (t: TipoContrato) => TIPOS_CONTRATO.find((x) => x.tipo === t)!;
const ordemTipo = (t: TipoContrato) => TIPOS_CONTRATO.findIndex((x) => x.tipo === t);

const somar = (cs: ContratoMestre[], fn: (c: ContratoMestre) => number) => cs.reduce((s, c) => s + fn(c), 0);

/** Soma em moeda original só quando todas as linhas estão na mesma moeda */
function somaME(cs: ContratoMestre[], fn: (c: ContratoMestre) => number): { valor: number; moeda: Moeda } | null {
  const moedas = new Set(cs.map((c) => c.moeda));
  if (moedas.size !== 1) return null;
  return { valor: somar(cs, fn), moeda: cs[0].moeda };
}

/** Rentabilidade líquida a.a. média ponderada pelo saldo bruto */
function rentabMediaAA(cs: ContratoMestre[]): number {
  const base = somar(cs, (c) => c.saldoCurva);
  return base > 0 ? somar(cs, (c) => c.rentabLiqAA * c.saldoCurva) / base : 0;
}

function rentabPeriodo(cs: ContratoMestre[]): number {
  const base = somar(cs, (c) => c.principalBRL);
  return base > 0 ? somar(cs, (c) => c.rendimentoLiquido) / base : 0;
}

function agioMedio(cs: ContratoMestre[]): number {
  const base = somar(cs, (c) => c.saldoCurva);
  return base > 0 ? somar(cs, (c) => c.mtm) / base : 0;
}

/** Alíquota do IOF câmbio da remessa (time deposits): IOF realizado ÷ principal em R$ */
const aliqIofRemessa = (c: ContratoMestre) => (c.principalBRL > 0 ? c.iof / c.principalBRL : 0);

const corValor = (v: number) => (Math.round(v) < 0 ? "text-negative" : undefined);
/** Cor do percentual exibido com 2 casas (não pinta de vermelho um "0,00%") */
const corPct = (frac: number) => (Math.round(frac * 1e4) < 0 ? "text-negative" : undefined);

/** Ordem padrão da lista: tipo de contrato e código */
const ordenarPadrao = (cs: ContratoMestre[]) => [...cs].sort((a, b) => ordemTipo(a.tipo) - ordemTipo(b.tipo) || a.codigo.localeCompare(b.codigo));

export function CarteiraMestreApp() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, contratos } = useMestre(escopo);
  const [tipo, setTipo] = useState<string>(TODOS);
  const [moeda, setMoeda] = useState<string>(TODOS);
  const [cpc, setCpc] = useState<string>(TODOS);
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return contratos.filter(
      (c) =>
        (tipo === TODOS || c.tipo === tipo) &&
        (moeda === TODOS || c.moeda === moeda) &&
        (cpc === TODOS || c.cpc48 === cpc) &&
        (!t || [c.codigo, c.id, c.produto, c.contraparte, c.grupo, c.portfolio, c.indexador].some((s) => s.toLowerCase().includes(t))),
    );
  }, [contratos, tipo, moeda, cpc, busca]);

  // Cartões por tipo de contrato e conferências: sobre a carteira da empresa selecionada (sem os demais filtros)
  const resumo = useMemo(() => {
    const total = somar(contratos, (c) => c.saldoCurva);
    const tipos = TIPOS_CONTRATO.map((t) => {
      const cs = contratos.filter((c) => c.tipo === t.tipo);
      const bruto = somar(cs, (c) => c.saldoCurva);
      return {
        ...t,
        qtd: cs.length,
        bruto,
        contabil: somar(cs, (c) => c.valorContabil),
        liquido: somar(cs, (c) => c.rendimentoLiquido),
        share: total > 0 ? bruto / total : 0,
      };
    });
    const mov = movimentacaoMestre(previousYearEnd(p.dataBase), p.dataBase, p, escopo).total;
    const contabil = somar(contratos, (c) => c.valorContabil);
    const mtmVJ = somar(contratos.filter((c) => c.cpc48 !== "Custo Amortizado"), (c) => c.mtm);
    return { total, tipos, mov, contabil, mtmVJ, brutoMaisMtm: total + mtmVJ };
  }, [contratos, p, escopo]);

  const sel = linhas.find((c) => c.id === selecionado) ?? null;
  const filtrosAtivos = [tipo, moeda, cpc].filter((f) => f !== TODOS).length + (busca ? 1 : 0);
  const lista = useMemo(() => ordenarPadrao(linhas), [linhas]);

  const opcoesCpc = [{ value: TODOS, label: "Todas" }, ...[...new Set(contratos.map((c) => c.cpc48))].sort().map((v) => ({ value: v, label: v }))];
  const opcoesTipo = [{ value: TODOS, label: "Todos" }, ...TIPOS_CONTRATO.map((t) => ({ value: t.tipo, label: t.tipo }))];
  const opcoesMoeda = [{ value: TODOS, label: "Todas" }, ...MOEDAS.filter((m) => contratos.some((c) => c.moeda === m)).map((m) => ({ value: m, label: m }))];

  const colR = (key: string, header: string, fn: (c: ContratoMestre) => number, opts: { forte?: boolean; cor?: boolean; headerTitle?: string } = {}): Column<ContratoMestre> => ({
    key,
    header,
    align: "right",
    headerTitle: opts.headerTitle,
    value: fn,
    render: (c) => <span className={clsx(opts.forte && "font-semibold", opts.cor && corValor(fn(c)))}>{fmtNum(fn(c))}</span>,
    total: (r) => fmtNum(somar(r, fn)),
  });

  // Ordem na tela: identificação → saldo bruto, valor contábil e resultado → detalhes (o Excel mantém a ordem da planilha)
  const colunas: Column<ContratoMestre>[] = [
    {
      key: "id",
      header: "ID",
      sticky: true,
      value: (c) => c.codigo,
      render: (c) => (
        <div>
          <div className="font-semibold text-link tabular whitespace-nowrap">{c.codigo}</div>
          <div className="text-xs text-label whitespace-nowrap">Empresa {c.empresa}</div>
        </div>
      ),
      total: (r) => <span>Total R$ ({r.length})</span>,
    },
    {
      key: "tipo",
      header: "Tipo de contrato",
      headerTitle: "Tipo de contrato e relatório de origem",
      value: (c) => `${ordemTipo(c.tipo)}|${c.codigo}`,
      render: (c) => (
        <div>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: infoTipo(c.tipo).cor }} />
            {c.tipo}
          </span>
          <div className="text-xs">
            <Link
              to={c.rota}
              onClick={(e) => e.stopPropagation()}
              className="text-link font-semibold hover:underline inline-flex items-center gap-0.5"
              title={`Abrir no relatório de origem (${c.origem})`}
            >
              {c.origem}
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      ),
    },
    {
      key: "produto",
      header: "Produto",
      minWidth: 150,
      value: (c) => c.produto,
      render: (c) => (
        <div>
          <div className="text-text">{c.produto}</div>
          <div className="text-xs text-label whitespace-nowrap">{c.taxaContratada}</div>
        </div>
      ),
    },
    {
      key: "contraparte",
      header: "Contraparte/Emissor",
      minWidth: 170,
      value: (c) => c.contraparte,
      render: (c) => (
        <div>
          <div className="font-semibold text-text">{c.contraparte}</div>
          <div className="text-xs text-label">{c.portfolio}</div>
        </div>
      ),
    },
    colR("bruto", "Saldo bruto (R$)", (c) => c.saldoCurva, { forte: true, headerTitle: "Curva na renda fixa e nos títulos, valor da cota nos fundos, saldo em moeda × PTAX nos time deposits" }),
    colR("contabil", "Valor contábil (R$)", (c) => c.valorContabil, { forte: true, headerTitle: "Curva no custo amortizado; mercado no valor justo (CPC 48)" }),
    colR("rendLiq", "Rendimento líquido (R$)", (c) => c.rendimentoLiquido, { forte: true, cor: true, headerTitle: "Rendimento bruto − IOF realizado − IR − taxas e tarifas, desde a aplicação" }),
    {
      key: "rentAA",
      header: "Rentab. líq. a.a.",
      headerTitle: "Rentabilidade líquida do período anualizada (365 dias); total ponderado pelo saldo bruto",
      align: "right",
      value: (c) => c.rentabLiqAA,
      render: (c) => <span className={clsx("font-semibold", corPct(c.rentabLiqAA))}>{fmtPct(c.rentabLiqAA)}</span>,
      total: (r) => fmtPct(rentabMediaAA(r)),
    },
    {
      key: "cpc",
      header: "Classificação CPC 48",
      value: (c) => c.cpc48,
      render: (c) => (
        <ObjectStatus inverted icon={false} state={CPC48_STATE[c.cpc48]}>
          {c.cpc48}
        </ObjectStatus>
      ),
    },
    {
      key: "prazo",
      header: "Prazo (curto/longo)",
      align: "center",
      value: (c) => (c.circulante ? "Curto" : "Longo"),
      render: (c) => <Tag>{c.circulante ? "Curto" : "Longo"}</Tag>,
    },
    { key: "moeda", header: "Moeda", align: "center", value: (c) => c.moeda, render: (c) => <Tag color={COR_MOEDA[c.moeda]}>{c.moeda}</Tag> },
    { key: "indexador", header: "Indexador", value: (c) => c.indexador, render: (c) => <span className="whitespace-nowrap">{c.indexador}</span> },
    { key: "aplicacao", header: "Data aplicação", align: "right", value: (c) => c.dataAplicacao, render: (c) => fmtDate(c.dataAplicacao) },
    {
      key: "vencimento",
      header: "Vencimento",
      align: "right",
      value: (c) => c.vencimento ?? "9999",
      render: (c) =>
        c.vencimento ? (
          <div>
            <div>{fmtDate(c.vencimento)}</div>
            {c.prazoRemanescente !== null && (
              <div className={clsx("text-xs", c.prazoRemanescente <= 30 ? "text-critical font-semibold" : "text-label")}>{plural(c.prazoRemanescente, "dia", "dias")}</div>
            )}
          </div>
        ) : (
          <span className="text-label">Sem vencimento</span>
        ),
    },
    {
      key: "principalME",
      header: "Principal (ME)",
      align: "right",
      value: (c) => c.principalME,
      render: (c) => (
        <span>
          {fmtNum(c.principalME)} <span className="text-xs text-label">{c.moeda}</span>
        </span>
      ),
      total: (r) => {
        const s = somaME(r, (c) => c.principalME);
        return s ? `${fmtNum(s.valor)} ${s.moeda}` : "";
      },
    },
    colR("principalBRL", "Principal (R$)", (c) => c.principalBRL),
    colR("mercado", "Saldo a mercado (R$)", (c) => c.saldoMercado),
    colR("mtm", "Ajuste MTM (R$)", (c) => c.mtm, { cor: true, headerTitle: "Saldo a mercado − saldo bruto" }),
    {
      key: "agio",
      header: "Ágio/deságio mercado (%)",
      headerTitle: "(Saldo a mercado − saldo bruto) ÷ saldo bruto",
      align: "right",
      value: (c) => c.agioDesagio,
      render: (c) => <span className={corPct(c.agioDesagio)}>{fmtPct(c.agioDesagio)}</span>,
      total: (r) => fmtPct(agioMedio(r)),
    },
    colR("rendBruto", "Rendimento bruto (R$)", (c) => c.rendimentoBruto, { cor: true, headerTitle: "Desde a aplicação: inclui cupons recebidos, come-cotas recolhido e variação cambial" }),
    colR("iof", "IOF realizado (R$)", (c) => c.iof, {
      headerTitle: `Só IOF realizado: nos time deposits, IOF câmbio na remessa (${fmtPct(TD.iofCambio)} a partir de ${fmtDate(TD.inicioIofInvestimento)}; ${fmtPct(TD.iofCambioGeral)} antes); nos demais, zero – o IOF regressivo só incide no resgate antes de 30 dias`,
    }),
    colR("ir", "IR – IRRF / IRPJ-CSLL (R$)", (c) => c.ir, {
      headerTitle: "IRRF regressivo provisionado (renda fixa, títulos e fundos, inclusive come-cotas); time deposits: IRPJ/CSLL de 34% sobre o resultado",
    }),
    colR("taxas", "Taxas e tarifas (R$)", (c) => c.taxas, { headerTitle: "Custódia e taxa do agente (títulos públicos); tarifa bancária (time deposits)" }),
    {
      key: "rentPer",
      header: "Rentab. líq. período",
      headerTitle: "Rendimento líquido ÷ principal em R$, da aplicação até a data-base",
      align: "right",
      value: (c) => c.rentabLiqPeriodo,
      render: (c) => <span className={corPct(c.rentabLiqPeriodo)}>{fmtPct(c.rentabLiqPeriodo)}</span>,
      total: (r) => fmtPct(rentabPeriodo(r)),
    },
    {
      key: "saldoME",
      header: "Saldo (ME)",
      align: "right",
      value: (c) => c.saldoME,
      render: (c) => (
        <span>
          {fmtNum(c.saldoME)} <span className="text-xs text-label">{c.moeda}</span>
        </span>
      ),
      total: (r) => {
        const s = somaME(r, (c) => c.saldoME);
        return s ? `${fmtNum(s.valor)} ${s.moeda}` : "";
      },
    },
    { key: "grupo", header: "Grupo econômico", minWidth: 140, value: (c) => c.grupo, render: (c) => <span className="whitespace-nowrap">{c.grupo}</span> },
  ];

  const exportar = () => {
    const ordenadas = ordenarPadrao(linhas);
    const soma = (fn: (c: ContratoMestre) => number) => somar(ordenadas, fn);
    const principalME = somaME(ordenadas, (c) => c.principalME);
    const saldoME = somaME(ordenadas, (c) => c.saldoME);
    exportarExcel(
      `Carteira_Mestre_${p.dataBase}.xlsx`,
      [
        {
          nome: "Carteira-Mestre",
          titulo: "CARTEIRA-MESTRE – Base consolidada de contratos de aplicação",
          subtitulo: `${ESCOPOS.find((e) => e.value === escopo)!.label} · Valores em R$ (moeda original nas colunas ME)`,
          // Layout da aba "Carteira-Mestre" do Reporting Pack (ordem e títulos da planilha)
          colunas: [
            { titulo: "ID", largura: 12 },
            { titulo: "Origem", largura: 8 },
            { titulo: "Tipo de contrato", largura: 20 },
            { titulo: "Produto", largura: 26 },
            { titulo: "Contraparte/Emissor", largura: 26 },
            { titulo: "Moeda", largura: 7 },
            { titulo: "Indexador", largura: 12 },
            { titulo: "Data aplicação", tipo: "data", largura: 13 },
            { titulo: "Vencimento", tipo: "data", largura: 13 },
            { titulo: "Principal (ME)", tipo: "moeda" },
            { titulo: "Principal (R$)", tipo: "moeda" },
            { titulo: "Saldo na curva (R$)", tipo: "moeda" },
            { titulo: "Saldo a mercado (R$)", tipo: "moeda" },
            { titulo: "Ajuste MTM (R$)", tipo: "moeda" },
            { titulo: "Rendimento bruto (R$)", tipo: "moeda" },
            { titulo: "IOF (R$)", tipo: "moeda" },
            { titulo: "IR/IRRF (R$)", tipo: "moeda" },
            { titulo: "Taxas e tarifas (R$)", tipo: "moeda" },
            { titulo: "Rendimento líquido (R$)", tipo: "moeda" },
            { titulo: "Valor contábil (R$)", tipo: "moeda" },
            { titulo: "Classificação CPC 48", largura: 18 },
            { titulo: "Prazo (curto/longo)", largura: 10 },
            { titulo: "Rentab. líq. período", tipo: "pct", largura: 12 },
            { titulo: "Saldo (ME)", tipo: "moeda" },
            { titulo: "Ágio/deságio mercado (%)", tipo: "pct", largura: 12 },
            { titulo: "Rentab. líq. a.a.", tipo: "pct", largura: 12 },
            { titulo: "Grupo econômico", largura: 18 },
          ],
          linhas: ordenadas.map((c) => [
            c.codigo,
            c.origem,
            c.tipo,
            c.produto,
            c.contraparte,
            c.moeda,
            c.indexador,
            c.dataAplicacao,
            c.vencimento ?? "",
            c.principalME,
            c.principalBRL,
            c.saldoCurva,
            c.saldoMercado,
            c.mtm,
            c.rendimentoBruto,
            c.iof,
            c.ir,
            c.taxas,
            c.rendimentoLiquido,
            c.valorContabil,
            c.cpc48,
            c.circulante ? "Curto" : "Longo",
            c.rentabLiqPeriodo,
            c.saldoME,
            c.agioDesagio,
            c.rentabLiqAA,
            c.grupo,
          ]),
          total: [
            "TOTAL (R$)",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            principalME?.valor ?? "",
            soma((c) => c.principalBRL),
            soma((c) => c.saldoCurva),
            soma((c) => c.saldoMercado),
            soma((c) => c.mtm),
            soma((c) => c.rendimentoBruto),
            soma((c) => c.iof),
            soma((c) => c.ir),
            soma((c) => c.taxas),
            soma((c) => c.rendimentoLiquido),
            soma((c) => c.valorContabil),
            "",
            "",
            rentabPeriodo(ordenadas),
            saldoME?.valor ?? "",
            agioMedio(ordenadas),
            rentabMediaAA(ordenadas),
            "",
          ],
          notas: [
            `"Saldo na curva" = saldo bruto. ${NOTA_RODAPE}`,
            `Rendimento bruto desde a aplicação (inclui cupons recebidos, come-cotas recolhido e variação cambial). ${NOTA_TRIBUTOS}`,
            "Colunas em moeda original (ME) somadas apenas quando todos os contratos exportados estão na mesma moeda. Rentab. líq. a.a. do total ponderada pelo saldo bruto.",
          ],
        },
      ],
      p.dataBase,
    );
  };

  const kpiMtm = somar(linhas, (c) => c.mtm);
  const kpiLiq = somar(linhas, (c) => c.rendimentoLiquido);
  const kpiRent = rentabMediaAA(linhas);
  const difMov = resumo.total - resumo.mov.saldoFinal;
  const difContabil = resumo.contabil - resumo.brutoMaisMtm;
  const abrir = (c: ContratoMestre) => setSelecionado(c.id === selecionado ? null : c.id);

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Contratos ativos" value={fmtInt(linhas.length)} sub={filtrosAtivos ? `de ${contratos.length} na carteira` : `${TIPOS_CONTRATO.length} tipos de contrato`} />
          <HeaderKpi label="Saldo bruto" value={fmtCompact(somar(linhas, (c) => c.saldoCurva))} sub="curva · cota · moeda × PTAX" />
          <HeaderKpi label="Valor contábil" value={fmtCompact(somar(linhas, (c) => c.valorContabil))} sub="curva no CA · mercado no VJ" />
          <HeaderKpi label="Ajuste MTM" value={fmtCompact(kpiMtm)} state={Math.round(kpiMtm) < 0 ? "negative" : "positive"} sub="mercado − curva" />
          <HeaderKpi label="Rendimento líquido" value={fmtCompact(kpiLiq)} state={kpiLiq < 0 ? "negative" : "positive"} sub="desde a aplicação" />
          <HeaderKpi label="Rentab. líquida média" value={fmtPct(kpiRent)} unit="a.a." sub="ponderada pelo saldo bruto" />
        </>
      }
    >
      {/* Barra de filtros */}
      <div className="bg-surface rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <FilterField label="Empresa">
            <Select
              value={escopo}
              onChange={(v) => {
                setEscopo(v);
                setSelecionado(null);
              }}
              options={ESCOPOS}
            />
          </FilterField>
          <FilterField label="Tipo de contrato">
            <Select value={tipo} onChange={setTipo} options={opcoesTipo} />
          </FilterField>
          <FilterField label="Moeda">
            <Select value={moeda} onChange={setMoeda} options={opcoesMoeda} />
          </FilterField>
          <FilterField label="Classificação CPC 48">
            <Select value={cpc} onChange={setCpc} options={opcoesCpc} />
          </FilterField>
          <FilterField label="Pesquisa">
            <SearchField value={busca} onChange={setBusca} placeholder="ID, produto, contraparte, grupo" />
          </FilterField>
        </div>
        {filtrosAtivos > 0 && (
          <div className="flex items-center justify-between gap-3 mt-2 text-[13px]">
            <span className="text-label">
              {plural(filtrosAtivos, "filtro ativo", "filtros ativos")} · {linhas.length} de {plural(contratos.length, "contrato", "contratos")}
            </span>
            <button
              type="button"
              className="text-link font-semibold hover:underline whitespace-nowrap"
              onClick={() => {
                setTipo(TODOS);
                setMoeda(TODOS);
                setCpc(TODOS);
                setBusca("");
              }}
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Cartões por tipo de contrato + conferência da consolidação */}
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {resumo.tipos.map((t) => {
            const ativo = tipo === t.tipo;
            return (
              <button
                key={t.tipo}
                type="button"
                onClick={() => setTipo(ativo ? TODOS : t.tipo)}
                aria-pressed={ativo}
                title={ativo ? "Remover o filtro de tipo" : `Filtrar ${t.tipo}`}
                className={clsx(
                  "flex flex-col text-left bg-surface rounded-[var(--radius-card)] shadow-fiori px-4 pt-3 pb-3.5 min-w-0 transition-shadow hover:shadow-fiori-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  ativo && "ring-2 ring-brand bg-selected",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: t.cor }} />
                    <span className="text-sm font-bold text-text truncate">{t.tipo}</span>
                  </span>
                  <Tag color={t.cor}>{t.origem}</Tag>
                </div>
                <div className="text-xs text-label mt-0.5">
                  {plural(t.qtd, "contrato", "contratos")} · {fmtPct(t.share, 1)} da carteira
                </div>
                <div className="text-[1.5rem] leading-tight font-light text-text tabular mt-2 whitespace-nowrap">{fmtCompact(t.bruto)}</div>
                <div className="text-[11px] text-label">Saldo bruto ({BASE_SALDO[t.tipo]})</div>
                <MicroBar value={t.share} max={1} color={t.cor} className="mt-2" />
                <dl className="grid grid-cols-2 gap-2 mt-2.5 text-[12px]">
                  <div className="min-w-0">
                    <dt className="text-label">Valor contábil</dt>
                    <dd className="font-semibold text-text tabular whitespace-nowrap">{fmtCompact(t.contabil)}</dd>
                  </div>
                  <div className="min-w-0 text-right">
                    <dt className="text-label">Rend. líquido</dt>
                    <dd className={clsx("font-semibold tabular whitespace-nowrap", t.liquido < 0 ? "text-negative" : "text-positive")}>{fmtCompact(t.liquido)}</dd>
                  </div>
                </dl>
              </button>
            );
          })}
        </div>

        <Card
          title="Consolidação"
          subtitle={`${ESCOPOS.find((e) => e.value === escopo)!.label} · conferências sobre a carteira da empresa, sem os filtros de tipo, moeda, CPC 48 e pesquisa`}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Conferencia
              titulo="Saldo bruto × movimentação"
              resultado={["Saldo bruto igual ao saldo final da movimentação", "Saldo bruto diverge do saldo final da movimentação"]}
              linhas={[
                ["Σ saldo bruto (Carteira-Mestre)", resumo.total],
                [`Saldo final da movimentação (${fmtDate(previousYearEnd(p.dataBase))} → ${fmtDate(p.dataBase)})`, resumo.mov.saldoFinal],
              ]}
              diferenca={difMov}
            />
            <Conferencia
              titulo="Valor contábil × saldo bruto + MTM (VJ)"
              resultado={["Valor contábil igual ao saldo bruto + MTM dos contratos a VJ", "Valor contábil diverge do saldo bruto + MTM dos contratos a VJ"]}
              linhas={[
                ["Σ valor contábil", resumo.contabil],
                [`Σ saldo bruto + MTM dos contratos a VJ (${fmtBRL(resumo.mtmVJ)})`, resumo.brutoMaisMtm],
              ]}
              diferenca={difContabil}
            />
          </div>
        </Card>
      </div>

      <div className={clsx("grid gap-5", sel ? "lg:grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-1")}>
        <Card
          title={`Contratos (${linhas.length})`}
          subtitle={
            <>
              Base consolidada em R$ na data-base · <span className="hidden lg:inline">clique em uma linha</span>
              <span className="lg:hidden">toque em um contrato</span> para ver todos os campos
            </>
          }
          bodyClassName="px-0 pb-0"
          className="min-w-0 overflow-hidden"
        >
          <div className="hidden lg:block">
            <DataTable
              columns={colunas}
              rows={linhas}
              rowKey={(c) => c.id}
              onRowClick={abrir}
              selectedKey={selecionado}
              showTotals
              maxHeight={660}
              defaultSort={{ key: "tipo", dir: "asc" }}
            />
          </div>

          {/* Celular e tablet: lista em cartões */}
          <ul className="lg:hidden border-t border-line divide-y divide-line-soft">
            {lista.length === 0 && <li className="px-4 py-8 text-center text-sm text-label">Nenhum contrato no filtro selecionado</li>}
            {lista.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => abrir(c)}
                  aria-pressed={c.id === selecionado}
                  className={clsx("w-full text-left px-4 py-3 flex items-start gap-2 hover:bg-hover focus:outline-none focus-visible:bg-hover", c.id === selecionado && "bg-selected")}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-link tabular">{c.codigo}</span>
                      <Tag color={infoTipo(c.tipo).cor}>{c.tipo}</Tag>
                      {c.moeda !== "BRL" && <Tag color={COR_MOEDA[c.moeda]}>{c.moeda}</Tag>}
                    </div>
                    <div className="text-[13px] text-text leading-snug mt-0.5">
                      {c.produto} · <span className="font-semibold">{c.contraparte}</span>
                    </div>
                    <div className="text-xs text-label leading-snug">
                      {c.taxaContratada} · {c.vencimento ? `vence em ${fmtDate(c.vencimento)}` : "sem vencimento"} · {c.cpc48}
                    </div>
                    <ValoresCartao bruto={c.saldoCurva} contabil={c.valorContabil} liquido={c.rendimentoLiquido} />
                  </div>
                  <ChevronRight className="w-4 h-4 text-label shrink-0 mt-0.5" aria-hidden />
                </button>
              </li>
            ))}
            {lista.length > 0 && (
              <li className="px-4 py-3 bg-surface-3">
                <div className="text-sm font-bold text-text">Total R$ · {plural(lista.length, "contrato", "contratos")}</div>
                <ValoresCartao bruto={somar(lista, (c) => c.saldoCurva)} contabil={somar(lista, (c) => c.valorContabil)} liquido={somar(lista, (c) => c.rendimentoLiquido)} forte />
              </li>
            )}
          </ul>

          <p className="px-4 py-3 text-xs text-label leading-relaxed border-t border-line-soft">
            {NOTA_RODAPE} Rendimentos, tributos e taxas desde a aplicação. {NOTA_TRIBUTOS} Colunas em moeda original (ME) totalizadas só quando todos os contratos filtrados estão na mesma moeda.
          </p>
        </Card>
        {sel && <DetalheContrato c={sel} onClose={() => setSelecionado(null)} />}
      </div>
    </ReportPage>
  );
}

function ValoresCartao({ bruto, contabil, liquido, forte }: { bruto: number; contabil: number; liquido: number; forte?: boolean }) {
  const itens: [string, number, string | undefined][] = [
    ["Saldo bruto", bruto, undefined],
    ["Valor contábil", contabil, undefined],
    ["Rend. líquido", liquido, corValor(liquido)],
  ];
  return (
    <dl className="grid grid-cols-3 gap-x-3 mt-2 text-[13px]">
      {itens.map(([rotulo, v, cor], i) => (
        <div key={rotulo} className={clsx("min-w-0", i === 2 && "text-right")}>
          <dt className="text-xs text-label truncate">{rotulo}</dt>
          <dd className={clsx("tabular truncate", forte ? "font-bold" : "font-semibold", cor ?? "text-text")}>{fmtCompact(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Conferencia({ titulo, resultado, linhas, diferenca }: { titulo: string; resultado: [string, string]; linhas: [string, number][]; diferenca: number }) {
  const ok = Math.abs(diferenca) < 0.005;
  return (
    <section className="rounded-lg border border-line-soft px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[13px] font-bold text-text">{titulo}</h4>
          <p className={clsx("text-xs font-semibold leading-snug", ok ? "text-positive" : "text-negative")}>{ok ? resultado[0] : resultado[1]}</p>
        </div>
        {ok ? <CheckCircle2 className="w-4 h-4 text-positive shrink-0 mt-0.5" aria-label="Conferido" /> : <XCircle className="w-4 h-4 text-negative shrink-0 mt-0.5" aria-label="Divergente" />}
      </div>
      <dl className="mt-1.5 space-y-1 text-[12px]">
        {linhas.map(([l, v]) => (
          <div key={l} className="flex items-baseline justify-between gap-3">
            <dt className="text-label min-w-0">{l}</dt>
            <dd className="tabular text-text whitespace-nowrap">{fmtBRL(v, true)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-line-soft pt-1">
          <dt className="font-semibold text-text">Diferença</dt>
          <dd className={clsx("tabular font-bold whitespace-nowrap", ok ? "text-positive" : "text-negative")}>{fmtDec(ok ? 0 : diferenca, 2)}</dd>
        </div>
      </dl>
    </section>
  );
}

function DetalheContrato({ c, onClose }: { c: ContratoMestre; onClose: () => void }) {
  const navigate = useNavigate();
  const t = infoTipo(c.tipo);
  const estrangeira = c.moeda !== "BRL";
  const td = c.tipo === "Time deposit";
  const rotuloIR = td ? `IRPJ/CSLL (${fmtPct(c.aliqIR, 0)})` : `IRRF (${fmtPct(c.aliqIR, 1)})`;
  const rotuloIOF = td ? `IOF câmbio na remessa (${fmtPct(aliqIofRemessa(c))})` : "IOF realizado";
  return (
    <aside className="bg-surface rounded-[var(--radius-card)] shadow-fiori-lg lg:shadow-fiori overflow-hidden self-auto lg:self-start flex flex-col fixed inset-x-4 bottom-4 top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 lg:sticky lg:inset-auto lg:top-[4.25rem] lg:z-auto lg:max-h-[calc(100vh-5.5rem)]">
      <header className="px-4 pt-3.5 pb-3 border-b border-line-soft">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-label">
              {c.codigo} · Transação SAP {c.id}
            </div>
            <h3 className="text-lg font-bold text-text leading-snug">
              {c.produto} · {c.contraparte}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-link hover:bg-hover" aria-label="Fechar detalhe">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Tag color={t.cor}>{c.tipo}</Tag>
          <ObjectStatus inverted icon={false} state={CPC48_STATE[c.cpc48]}>
            {c.cpc48}
          </ObjectStatus>
          <Tag>{c.circulante ? "Circulante" : "Não circulante"}</Tag>
          <Tag>Rating {c.rating}</Tag>
          <Tag color={COR_MOEDA[c.moeda]}>{c.moeda}</Tag>
        </div>
        <Button className="mt-3 w-full" icon={<ArrowUpRight className="w-4 h-4" />} onClick={() => navigate(c.rota)}>
          Abrir no relatório de origem ({c.origem})
        </Button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto fiori-scroll px-4 py-4 space-y-5">
        <section>
          <h4 className="text-sm font-bold text-text mb-2">Saldos na data-base</h4>
          <dl className="space-y-1.5 text-[13px]">
            <Linha label="Principal (ME)" valor={`${fmtDec(c.principalME, 2)} ${c.moeda}`} />
            {estrangeira && <Linha label="PTAX da data-base" valor={fmtDec(c.ptax, 4)} />}
            <Linha label="Principal (R$)" valor={fmtBRL(c.principalBRL, true)} />
            <Linha label={`Saldo bruto (${BASE_SALDO[c.tipo]})`} valor={fmtBRL(c.saldoCurva, true)} forte />
            <Linha label="Saldo a mercado" valor={fmtBRL(c.saldoMercado, true)} />
            <Linha
              label={Math.round(c.agioDesagio * 1e4) === 0 ? "Ajuste MTM (sem ágio/deságio)" : `Ajuste MTM (${c.agioDesagio > 0 ? "ágio" : "deságio"} de ${fmtPct(Math.abs(c.agioDesagio))})`}
              valor={fmtBRL(c.mtm, true)}
              cor={Math.round(c.mtm) < 0 ? "text-negative" : Math.round(c.mtm) > 0 ? "text-positive" : undefined}
            />
            <Linha label="Saldo (ME)" valor={`${fmtDec(c.saldoME, 2)} ${c.moeda}`} />
            <div className="border-t border-line-soft pt-1.5">
              <Linha label={`Valor contábil (${c.cpc48 === "Custo Amortizado" ? "curva" : "mercado"})`} valor={fmtBRL(c.valorContabil, true)} forte />
            </div>
          </dl>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Resultado desde a aplicação</h4>
          <dl className="space-y-1.5 text-[13px]">
            <Linha label="Rendimento bruto" valor={fmtBRL(c.rendimentoBruto, true)} cor={c.rendimentoBruto < 0 ? "text-negative" : "text-positive"} />
            <Linha label={`(−) ${rotuloIOF}`} valor={fmtBRL(c.iof, true)} />
            <Linha label={`(−) ${rotuloIR}`} valor={fmtBRL(c.ir, true)} />
            <Linha label="(−) Taxas e tarifas" valor={fmtBRL(c.taxas, true)} />
            <div className="border-t border-line-soft pt-1.5">
              <Linha label="Rendimento líquido" valor={fmtBRL(c.rendimentoLiquido, true)} forte cor={c.rendimentoLiquido < 0 ? "text-negative" : undefined} />
            </div>
            <Linha label="Rentab. líquida no período" valor={fmtPct(c.rentabLiqPeriodo)} />
            <Linha label="Rentab. líquida a.a." valor={fmtPct(c.rentabLiqAA)} />
          </dl>
          <p className="text-xs text-label leading-snug mt-2">
            {td
              ? "IOF câmbio pago na remessa; IRPJ/CSLL sobre o resultado (juros + variação cambial − IOF − tarifas)."
              : `IOF regressivo só no resgate antes de 30 dias (nenhum realizado); IRRF provisionado pela alíquota vigente${c.tipo === "Fundo de investimento" ? ", inclusive o come-cotas recolhido" : ""}.`}{" "}
            PIS/COFINS sobre receitas financeiras (4,65%) não modelado.
          </p>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Condições e classificação</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Origem">
              {c.origem} – {t.curto}
            </Field>
            <Field label="Indexador">{c.indexador}</Field>
            <Field label="Taxa contratada">{c.taxaContratada}</Field>
            <Field label="Taxa a.a. equivalente">{fmtPct(c.taxaAA)}</Field>
            <Field label="Data aplicação">{fmtDate(c.dataAplicacao)}</Field>
            <Field label="Vencimento">{c.vencimento ? fmtDate(c.vencimento) : "Sem vencimento"}</Field>
            <Field label="Prazo remanescente">{c.prazoRemanescente === null ? "—" : plural(c.prazoRemanescente, "dia", "dias")}</Field>
            <Field label="Faixa de prazo">{c.faixaPrazo}</Field>
            <Field label="Prazo (curto/longo)">{c.circulante ? "Curto (circulante)" : "Longo (não circulante)"}</Field>
            <Field label="Liquidez imediata">{c.liquidezImediata ? "Sim" : "Não"}</Field>
            <Field label="Empresa">
              {c.empresa} – {EMPRESAS[c.empresa]?.nome ?? ""}
            </Field>
            <Field label="Portfolio">{c.portfolio}</Field>
            <Field label="Grupo econômico">{c.grupo}</Field>
            <Field label="Rating">{c.rating}</Field>
          </div>
        </section>
      </div>
    </aside>
  );
}

function Linha({ label, valor, forte, cor }: { label: ReactNode; valor: string; forte?: boolean; cor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-label">{label}</dt>
      <dd className={clsx("tabular whitespace-nowrap", forte ? "font-bold text-text text-sm" : "text-text", cor)}>{valor}</dd>
    </div>
  );
}
