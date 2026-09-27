import clsx from "clsx";
import { CalendarClock, Database, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, Field } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, SearchField, Select } from "../../shared/components/fiori/Inputs";
import { HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import { diffDays, fmtDate } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtInt, fmtNum, fmtPct, fmtX } from "../../shared/lib/format";
import { ESCOPOS, useCovenants, useDivida, type Escopo } from "../context/useDivida";
import { MAPEAMENTO_C00, relatorioCaptacao } from "../data/catalogo";
import { COVENANTS_DIVIDA, type CovenantDivida } from "../data/covenants";
import {
  COR_INDEXADOR,
  COR_MODALIDADE,
  EMPRESAS_DIVIDA,
  GRUPO_MODALIDADE,
  taxaContratadaDivida,
  type ContratoDivida,
  type IndexadorDivida,
} from "../data/contratos";
import type { ApuracaoCovenant } from "../lib/covenants";
import { calcularPosicaoDivida, custoMedioPonderado, prazoMedioCarteira, totalDivida, type PosicaoDivida } from "../lib/divida";

const rel = relatorioCaptacao("c00");
const TODOS = "__todos";
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };
/** Ordem fixa dos indexadores (cores de COR_INDEXADOR, as mesmas da tela de Premissas) */
const ORDEM_INDEXADOR: IndexadorDivida[] = ["CDI", "IPCA", "TJLP", "TLP", "Pré"];
/** Circulante × não circulante: mesmas cores do C02 */
const COR_CP = "#e26300";
const COR_NC = "#0070f2";
const corModalidade = (c: ContratoDivida) => COR_MODALIDADE[GRUPO_MODALIDADE[c.modalidade]] ?? "#758ca4";
/** sap.m.ColumnListItem com highlight "Error" (barra vermelha à esquerda da linha) */
const HIGHLIGHT_RECLASSIFICADO = "[&>td:first-child]:shadow-[inset_3px_0_0_#f53232]";

// ---------------------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------------------

function soma(pos: PosicaoDivida[], fn: (x: PosicaoDivida) => number): number {
  return pos.reduce((s, x) => s + fn(x), 0);
}

/** Média ponderada pelo saldo contábil */
function ponderar(pos: PosicaoDivida[], fn: (x: PosicaoDivida) => number): number {
  const saldo = totalDivida(pos);
  return saldo > 0 ? pos.reduce((s, x) => s + fn(x) * x.saldoContabil, 0) / saldo : 0;
}

/** "(1.234.567)" para as redutoras (custos a apropriar) */
function fmtRedutora(v: number): string {
  return v > 0.5 ? fmtNum(-v, { parens: true }) : "–";
}

/** Prazo remanescente compacto: dias até 1 ano, depois anos */
function fmtPrazo(dias: number): string {
  if (dias <= 365) return `${fmtInt(dias)} ${dias === 1 ? "dia" : "dias"}`;
  return `${fmtDec(dias / 365, 1)} anos`;
}

function plural(n: number, singular: string, pluralTxt: string): string {
  return `${fmtInt(n)} ${n === 1 ? singular : pluralTxt}`;
}

/** Participação com 1 casa, sem "0,0%" para valores positivos pequenos (nem "100,0%" para quase o todo) */
function fmtParticipacao(v: number, total: number): string {
  if (!(total > 0)) return "—";
  const f = v / total;
  if (f > 0 && f < 0.0005) return "< 0,1%";
  if (f < 1 && f > 0.9995) return "> 99,9%";
  return fmtPct(f, 1);
}

function fmtLimite(cov: CovenantDivida): string {
  const v = cov.formato === "pct" ? fmtPct(cov.limite, 0) : fmtX(cov.limite, 2);
  return `${cov.tipo === "max" ? "≤" : "≥"} ${v}`;
}

function fmtValorCovenant(a: ApuracaoCovenant): string {
  return a.cov.formato === "pct" ? fmtPct(a.valor, 1) : fmtX(a.valor, 2);
}

function estadoCovenant(a: ApuracaoCovenant | undefined): { state: ValueState; texto: string } {
  if (!a || !a.dataApuracao) return { state: "neutral", texto: "Sem apuração" };
  if (a.status === "excedido") return a.reclassifica ? { state: "negative", texto: "Descumprido" } : { state: "critical", texto: "Descumprido – waiver" };
  if (a.status === "atencao") return { state: "critical", texto: "Atenção" };
  return { state: "positive", texto: "Cumprido" };
}

/** Spread composto (BNDES indireto: spread do BNDES × spread do agente) */
function spreadTotal(c: ContratoDivida): number {
  return (1 + c.spread) * (1 + (c.spreadAgente ?? 0)) - 1;
}

/** Saldo não circulante que foi levado ao circulante por covenant descumprido (CPC 26, item 74) */
function valorReclassificado(x: PosicaoDivida, data: string, p: PremissasMercado): number {
  if (!x.reclassificado) return 0;
  return calcularPosicaoDivida(x.c, data, p, false).naoCirculante;
}

/** Aplica a condição somente em telas largas (coluna fixa da tabela) */
function useTelaLarga(minPx: number): boolean {
  const consulta = `(min-width: ${minPx}px)`;
  const [ok, setOk] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(consulta).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(consulta);
    const f = () => setOk(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [consulta]);
  return ok;
}

interface Fatia {
  chave: string;
  valor: number;
  share: number;
  qtd: number;
  cor: string;
}

function fatiar(pos: PosicaoDivida[], chave: (x: PosicaoDivida) => string, cor: (k: string) => string): Fatia[] {
  const total = totalDivida(pos);
  const mapa = new Map<string, { valor: number; qtd: number }>();
  for (const x of pos) {
    const k = chave(x);
    const f = mapa.get(k) ?? { valor: 0, qtd: 0 };
    f.valor += x.saldoContabil;
    f.qtd += 1;
    mapa.set(k, f);
  }
  return [...mapa.entries()]
    .map(([k, f]) => ({ chave: k, valor: f.valor, qtd: f.qtd, share: total > 0 ? f.valor / total : 0, cor: cor(k) }))
    .sort((a, b) => b.valor - a.valor);
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function C00Carteira() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, posicoes } = useDivida(escopo);
  const apuracoes = useCovenants();
  const [busca, setBusca] = useState("");
  const [modalidade, setModalidade] = useState(TODOS);
  const [indexador, setIndexador] = useState(TODOS);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const telaLarga = useTelaLarga(640);
  const ultimoDado = ultimoDadoNaDataBase(p.dataBase);

  const gruposPresentes = new Set<string>(posicoes.map((x) => GRUPO_MODALIDADE[x.c.modalidade]));
  if (modalidade !== TODOS) gruposPresentes.add(modalidade);
  const opcoesModalidade = [
    { value: TODOS, label: "Todas" },
    ...[...gruposPresentes].sort((a, b) => a.localeCompare(b, "pt-BR")).map((v) => ({ value: v, label: v })),
  ];
  const presentesIdx = new Set<string>(posicoes.map((x) => x.c.indexador));
  if (indexador !== TODOS) presentesIdx.add(indexador);
  const opcoesIndexador = [{ value: TODOS, label: "Todos" }, ...ORDEM_INDEXADOR.filter((i) => presentesIdx.has(i)).map((v) => ({ value: v, label: v }))];

  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return posicoes.filter(
      (x) =>
        (modalidade === TODOS || GRUPO_MODALIDADE[x.c.modalidade] === modalidade) &&
        (indexador === TODOS || x.c.indexador === indexador) &&
        (!t ||
          [x.c.id, x.c.transacao, x.c.instrumento, x.c.credor, x.c.agente ?? "", x.c.modalidade].some((s) => s.toLowerCase().includes(t))),
    );
  }, [posicoes, busca, modalidade, indexador]);

  const sel = linhas.find((x) => x.c.id === selecionado) ?? null;
  const filtrosAtivos = [modalidade, indexador].filter((f) => f !== TODOS).length + (busca.trim() ? 1 : 0);
  const limparFiltros = () => {
    setBusca("");
    setModalidade(TODOS);
    setIndexador(TODOS);
  };

  const k = useMemo(() => {
    const saldo = totalDivida(linhas);
    const circulante = soma(linhas, (x) => x.circulante);
    const naoCirculante = soma(linhas, (x) => x.naoCirculante);
    const reclass = linhas.filter((x) => x.reclassificado);
    return {
      saldo,
      circulante,
      naoCirculante,
      custoMedio: custoMedioPonderado(linhas),
      cetMedio: ponderar(linhas, (x) => x.cet),
      prazoMedio: prazoMedioCarteira(linhas),
      grupos: new Set(linhas.map((x) => GRUPO_MODALIDADE[x.c.modalidade])).size,
      reclass,
      valorReclass: reclass.reduce((s, x) => s + valorReclassificado(x, p.dataBase, p), 0),
      porModalidade: fatiar(linhas, (x) => GRUPO_MODALIDADE[x.c.modalidade], (g) => COR_MODALIDADE[g] ?? "#758ca4"),
      porIndexador: fatiar(linhas, (x) => x.c.indexador, (i) => COR_INDEXADOR[i as IndexadorDivida] ?? "#758ca4"),
    };
  }, [linhas, p]);

  // Covenants descumpridos sem waiver que reclassificam contratos do conjunto filtrado
  const covReclass = apuracoes.filter((a) => a.reclassifica && a.cov.contratos.some((id) => k.reclass.some((x) => x.c.id === id)));

  // Colunas de valor logo após a taxa: a 1440 px o saldo, o circulante e o não circulante ficam visíveis sem rolagem
  // (e o saldo continua visível com o painel de detalhe aberto). Captação e valor captado seguem no detalhe e no Excel.
  const colunas: Column<PosicaoDivida>[] = [
    {
      key: "contrato",
      header: "Contrato",
      sticky: telaLarga,
      value: (x) => x.c.id,
      render: (x) => (
        <div className="min-w-[9.5rem] max-w-[12.5rem]">
          <div className="font-bold text-text">{x.c.id}</div>
          <div className="text-xs text-label leading-snug line-clamp-2" title={x.c.instrumento}>
            {x.c.instrumento}
          </div>
          {x.reclassificado && (
            <ObjectStatus inverted state="negative" className="mt-1">
              Reclassificado (CPC 26)
            </ObjectStatus>
          )}
        </div>
      ),
      total: (r) => <span>Total ({r.length})</span>,
    },
    {
      key: "modalidade",
      header: "Modalidade / Credor",
      value: (x) => `${GRUPO_MODALIDADE[x.c.modalidade]} ${x.c.modalidade}`,
      render: (x) => (
        <div className="min-w-[10.5rem] max-w-[13.5rem]">
          <div className="flex items-center gap-1.5 text-text whitespace-nowrap">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: corModalidade(x.c) }} aria-hidden />
            {x.c.modalidade}
            {x.c.formaBNDES && <span className="text-xs text-label">· {x.c.formaBNDES}</span>}
          </div>
          <div className="text-xs text-label leading-snug truncate pl-3.5" title={`${x.c.credor} · Empresa ${x.c.empresa}`}>
            <span className="font-semibold text-text">{x.c.credor}</span> · Empresa {x.c.empresa}
          </div>
          {x.c.agente && (
            <div className="text-xs text-label leading-snug truncate pl-3.5" title={x.c.agente}>
              {x.c.agente}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "taxa",
      header: "Taxa contratada",
      value: (x) => x.taxaEfetivaAA,
      render: (x) => (
        <div className="whitespace-nowrap">
          <div className="text-text">{taxaContratadaDivida(x.c)}</div>
          <div className="text-xs text-label">Efetiva {fmtPct(x.taxaEfetivaAA)} a.a.</div>
        </div>
      ),
    },
    {
      key: "saldo",
      header: "Saldo contábil",
      headerTitle: "Custo amortizado: principal atualizado + juros a pagar − custos a apropriar",
      align: "right",
      value: (x) => x.saldoContabil,
      render: (x) => <span className="font-semibold">{fmtNum(x.saldoContabil)}</span>,
      total: (r) => fmtNum(totalDivida(r)),
    },
    {
      key: "circulante",
      header: "Circulante",
      headerTitle: "Principal com vencimento em até 12 meses + juros a pagar − custos a apropriar no período (CPC 26)",
      align: "right",
      value: (x) => x.circulante,
      render: (x) => <span className={clsx(x.reclassificado && "text-negative font-semibold")}>{fmtNum(x.circulante, { dash: true })}</span>,
      total: (r) => fmtNum(soma(r, (x) => x.circulante), { dash: true }),
    },
    {
      key: "naoCirculante",
      header: "Não circulante",
      align: "right",
      value: (x) => x.naoCirculante,
      render: (x) => fmtNum(x.naoCirculante, { dash: true }),
      total: (r) => fmtNum(soma(r, (x) => x.naoCirculante), { dash: true }),
    },
    {
      key: "principal",
      header: "Principal atualizado",
      headerTitle: "Principal nominal remanescente + atualização monetária (IPCA nos contratos IPCA+ e TLP; excedente da TJLP sobre 6% a.a. nos contratos TJLP)",
      align: "right",
      value: (x) => x.principalAtualizado,
      render: (x) => fmtNum(x.principalAtualizado),
      total: (r) => fmtNum(soma(r, (x) => x.principalAtualizado)),
    },
    {
      key: "juros",
      header: "Juros a pagar",
      align: "right",
      value: (x) => x.jurosAPagar,
      render: (x) => fmtNum(x.jurosAPagar),
      total: (r) => fmtNum(soma(r, (x) => x.jurosAPagar)),
    },
    {
      key: "custos",
      header: "(−) Custos",
      headerTitle: "Custos de transação a apropriar (redutora do passivo, apropriação linear até o vencimento)",
      align: "right",
      value: (x) => x.custosAApropriar,
      render: (x) => <span className="text-label">{fmtRedutora(x.custosAApropriar)}</span>,
      total: (r) => fmtRedutora(soma(r, (x) => x.custosAApropriar)),
    },
    {
      key: "cet",
      header: "CET a.a.",
      headerTitle: "Custo efetivo total: TIR dos fluxos (captação líquida de custos × pagamentos projetados com o último dado disponível)",
      align: "right",
      value: (x) => x.cet,
      render: (x) => fmtPct(x.cet),
      total: (r) => fmtPct(ponderar(r, (x) => x.cet)),
    },
    {
      key: "proximo",
      header: "Próximo pagamento",
      headerTitle: `Principal + juros projetados com o último dado disponível importado do SAP (${fmtDate(ultimoDado)})`,
      align: "right",
      value: (x) => x.proximoPagamento?.data ?? "9999",
      render: (x) =>
        x.proximoPagamento ? (
          <div>
            <div>{fmtDate(x.proximoPagamento.data)}</div>
            <div className="text-xs text-label">
              {x.proximoPagamento.principal > 0.5 ? "P + J " : "Juros "}
              {fmtNum(x.proximoPagamento.principal + x.proximoPagamento.juros)}
            </div>
          </div>
        ) : (
          <span className="text-label">—</span>
        ),
    },
    {
      key: "vencimento",
      header: "Vencimento",
      align: "right",
      value: (x) => x.c.vencimento,
      render: (x) => (
        <div>
          <div>{fmtDate(x.c.vencimento)}</div>
          <div className={clsx("text-xs", x.diasAteVencimento <= 365 ? "text-critical font-semibold" : "text-label")}>{fmtPrazo(x.diasAteVencimento)}</div>
        </div>
      ),
    },
  ];

  const nomeEscopo = ESCOPOS.find((e) => e.value === escopo)?.label ?? "";
  const descricaoFiltros = [
    modalidade !== TODOS ? `Modalidade: ${modalidade}` : null,
    indexador !== TODOS ? `Indexador: ${indexador}` : null,
    busca.trim() ? `Pesquisa: "${busca.trim()}"` : null,
  ].filter(Boolean);

  const exportar = () => {
    const subtitulo = `${nomeEscopo}${descricaoFiltros.length ? ` · ${descricaoFiltros.join(" · ")}` : ""} · Valores em R$`;
    const notasProjecao = `CET e próximo pagamento projetados com o último dado disponível importado do SAP (${fmtDate(ultimoDado)}), mantido constante após a data-base.`;
    const ordenadas = [...linhas].sort((a, b) => b.saldoContabil - a.saldoContabil);
    exportarExcel(
      `C00_Carteira_Captacoes_${p.dataBase}.xlsx`,
      [
        {
          nome: "C00 - Carteira",
          titulo: "C00 – Carteira de captações (posição pelo custo amortizado)",
          subtitulo,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Transação SAP", largura: 13 },
            { titulo: "Empresa", largura: 10 },
            { titulo: "Modalidade", largura: 20 },
            { titulo: "Instrumento", largura: 48 },
            { titulo: "Credor", largura: 20 },
            { titulo: "Agente", largura: 36 },
            { titulo: "Indexador", largura: 10 },
            { titulo: "Taxa contratada", largura: 32 },
            { titulo: "Data de captação", tipo: "data", largura: 14 },
            { titulo: "Vencimento", tipo: "data", largura: 14 },
            { titulo: "Valor captado", tipo: "moeda" },
            { titulo: "Principal nominal", tipo: "moeda" },
            { titulo: "Atualização monetária", tipo: "moeda" },
            { titulo: "Principal atualizado", tipo: "moeda" },
            { titulo: "Juros a pagar", tipo: "moeda" },
            { titulo: "(−) Custos a apropriar", tipo: "moeda" },
            { titulo: "Saldo contábil", tipo: "moeda" },
            { titulo: "Circulante", tipo: "moeda" },
            { titulo: "Não circulante", tipo: "moeda" },
            { titulo: "Reclassificado (CPC 26)", largura: 12 },
            { titulo: "Taxa efetiva a.a.", tipo: "pct", largura: 12 },
            { titulo: "CET a.a.", tipo: "pct", largura: 10 },
            { titulo: "Prazo médio (anos)", tipo: "decimal", largura: 12 },
            { titulo: "Dias até o vencimento", tipo: "inteiro", largura: 12 },
            { titulo: "Próximo pagamento", tipo: "data", largura: 14 },
            { titulo: "Próx. pagto. – principal", tipo: "moeda" },
            { titulo: "Próx. pagto. – juros", tipo: "moeda" },
          ],
          linhas: ordenadas.map((x) => [
            x.c.id,
            x.c.transacao,
            x.c.empresa,
            x.c.modalidade,
            x.c.instrumento,
            x.c.credor,
            x.c.agente ?? "",
            x.c.indexador,
            taxaContratadaDivida(x.c),
            x.c.dataCaptacao,
            x.c.vencimento,
            x.c.valorCaptado,
            x.principalNominal,
            x.atualizacaoMonetaria,
            x.principalAtualizado,
            x.jurosAPagar,
            -x.custosAApropriar,
            x.saldoContabil,
            x.circulante,
            x.naoCirculante,
            x.reclassificado ? "Sim" : "Não",
            x.taxaEfetivaAA,
            x.cet,
            x.prazoMedioAnos,
            x.diasAteVencimento,
            x.proximoPagamento?.data ?? "",
            x.proximoPagamento?.principal ?? null,
            x.proximoPagamento?.juros ?? null,
          ]),
          total: [
            "TOTAL",
            `${linhas.length} contratos`,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            soma(linhas, (x) => x.c.valorCaptado),
            soma(linhas, (x) => x.principalNominal),
            soma(linhas, (x) => x.atualizacaoMonetaria),
            soma(linhas, (x) => x.principalAtualizado),
            soma(linhas, (x) => x.jurosAPagar),
            -soma(linhas, (x) => x.custosAApropriar),
            k.saldo,
            k.circulante,
            k.naoCirculante,
            "",
            k.custoMedio,
            k.cetMedio,
            k.prazoMedio,
            "",
            "",
            "",
            "",
          ],
          notas: [
            "(i) Saldo contábil pelo custo amortizado = principal atualizado + juros a pagar − custos de transação a apropriar (CPC 48).",
            "(ii) Circulante = principal com vencimento em até 12 meses + juros a pagar − custos a apropriar nos próximos 12 meses (CPC 26).",
            "(iii) Contratos com covenant descumprido na data-base sem waiver: todo o saldo no circulante (CPC 26, item 74).",
            "(iv) Taxa efetiva a.a. = juros + correção monetária com as taxas vigentes na data-base; totais ponderados pelo saldo contábil (prazo médio: pelo principal atualizado).",
            `(v) ${notasProjecao}`,
            "(vi) Juros compostos em base de 252 dias úteis (CDI e títulos IPCA+) e de 365 dias corridos (BNDES); o excedente da TJLP sobre 6% a.a. é capitalizado no principal (atualização monetária) e a TLP usa a taxa real da contratação; até a data-base, séries históricas de CDI, IPCA e TJLP importadas do SAP; datas de pagamento no dia útil seguinte.",
          ],
        },
        {
          nome: "Termos e garantias",
          titulo: "C00 – Termos contratuais, garantias e covenants",
          subtitulo,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Transação SAP", largura: 13 },
            { titulo: "Empresa", largura: 26 },
            { titulo: "Modalidade", largura: 20 },
            { titulo: "Forma BNDES", largura: 12 },
            { titulo: "Credor", largura: 20 },
            { titulo: "Agente", largura: 36 },
            { titulo: "Indexador", largura: 10 },
            { titulo: "Spread a.a.", tipo: "pct", largura: 10 },
            { titulo: "Spread do agente a.a.", tipo: "pct", largura: 12 },
            { titulo: "Custos de transação", tipo: "moeda" },
            { titulo: "Amortização", largura: 44 },
            { titulo: "Juros", largura: 36 },
            { titulo: "Garantias", largura: 60 },
            { titulo: "Covenants", largura: 50 },
            { titulo: "Finalidade", largura: 50 },
            { titulo: "Lastro", largura: 50 },
            { titulo: "Capitalização CPC 20", largura: 50 },
            { titulo: "Portfolio", largura: 14 },
            { titulo: "Linha de crédito", largura: 16 },
          ],
          linhas: ordenadas.map((x) => [
            x.c.id,
            x.c.transacao,
            `${x.c.empresa} – ${EMPRESAS_DIVIDA[x.c.empresa] ?? ""}`,
            x.c.modalidade,
            x.c.formaBNDES ?? "",
            x.c.credor,
            x.c.agente ?? "",
            x.c.indexador,
            x.c.spread,
            x.c.spreadAgente ?? null,
            x.c.custosTransacao,
            x.c.descricaoAmortizacao,
            x.c.descricaoJuros,
            x.c.garantias,
            x.c.covenants
              .map((id) => COVENANTS_DIVIDA.find((cv) => cv.id === id))
              .filter((cv): cv is CovenantDivida => !!cv)
              .map((cv) => `${cv.indicador} ${fmtLimite(cv)}`)
              .join("; "),
            x.c.finalidade,
            x.c.lastro ?? "",
            x.c.capitalizacaoCPC20 ? `${x.c.capitalizacaoCPC20.ativo} – até ${fmtDate(x.c.capitalizacaoCPC20.ate)}` : "",
            x.c.portfolio,
            x.c.linhaCredito ?? "",
          ]),
        },
        {
          nome: "Composição",
          titulo: "C00 – Composição do saldo contábil",
          subtitulo,
          colunas: [
            { titulo: "Visão", largura: 14 },
            { titulo: "Grupo", largura: 16 },
            { titulo: "Contratos", tipo: "inteiro", largura: 10 },
            { titulo: "Saldo contábil", tipo: "moeda", largura: 20 },
            { titulo: "Participação", tipo: "pct", largura: 12 },
          ],
          linhas: [
            ...k.porModalidade.map((f) => ["Modalidade", f.chave, f.qtd, f.valor, f.share]),
            ...k.porIndexador.map((f) => ["Indexador", f.chave, f.qtd, f.valor, f.share]),
          ],
          total: ["Total", "", linhas.length, k.saldo, k.saldo > 0 ? 1 : 0],
        },
      ],
      p.dataBase,
    );
  };

  const vazio = linhas.length === 0;
  const pctDoSaldo = (v: number) => (k.saldo > 0 ? `${fmtParticipacao(v, k.saldo)} do saldo` : "—");
  const ordenadasSaldo = [...linhas].sort((a, b) => b.saldoContabil - a.saldoContabil);
  const alternar = (id: string) => setSelecionado(id === selecionado ? null : id);

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Saldo (custo amortizado)" value={fmtCompact(k.saldo)} sub="Principal + juros − custos" />
          <HeaderKpi
            label="Circulante"
            value={fmtCompact(k.circulante)}
            state={k.reclass.length ? "negative" : "neutral"}
            sub={pctDoSaldo(k.circulante)}
          />
          <HeaderKpi label="Não circulante" value={fmtCompact(k.naoCirculante)} sub={pctDoSaldo(k.naoCirculante)} />
          <HeaderKpi label="Custo médio ponderado" value={vazio ? "—" : fmtPct(k.custoMedio)} unit={vazio ? undefined : "a.a."} sub={vazio ? "—" : `CET médio ${fmtPct(k.cetMedio)}`} />
          <HeaderKpi label="Prazo médio" value={vazio ? "—" : fmtDec(k.prazoMedio, 1)} unit={vazio ? undefined : "anos"} sub="Principal remanescente" />
          <HeaderKpi label="Contratos" value={fmtInt(linhas.length)} sub={plural(k.grupos, "modalidade", "modalidades")} />
        </>
      }
    >
      {/* Barra de filtros */}
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
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
          <FilterField label="Modalidade">
            <Select value={modalidade} onChange={setModalidade} options={opcoesModalidade} />
          </FilterField>
          <FilterField label="Indexador">
            <Select value={indexador} onChange={setIndexador} options={opcoesIndexador} />
          </FilterField>
          <FilterField label="Pesquisa">
            <SearchField value={busca} onChange={setBusca} placeholder="Contrato, instrumento, credor" />
          </FilterField>
        </div>
        {filtrosAtivos > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-2 text-[13px]">
            <span className="text-label">
              {plural(filtrosAtivos, "filtro ativo", "filtros ativos")} · {linhas.length} de {plural(posicoes.length, "contrato", "contratos")}
            </span>
            <button type="button" className="text-link font-semibold hover:underline" onClick={limparFiltros}>
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {covReclass.length > 0 && (
        <MessageStrip design="negative">
          {covReclass.map((a) => (
            <span key={a.cov.id} className="block">
              <strong className="font-semibold">
                {a.cov.indicador} descumprido em {fmtDate(a.dataApuracao)}
              </strong>{" "}
              ({fmtValorCovenant(a)} vs limite {fmtLimite(a.cov)}), sem waiver até a data-base: o não circulante de{" "}
              {a.cov.contratos.filter((id) => k.reclass.some((x) => x.c.id === id)).join(" e ")} ({fmtBRL(k.valorReclass)}) foi reclassificado
              para o circulante (CPC 26, item 74).
              {a.waiver && a.waiver.obtidoEm > p.dataBase && ` Waiver do ${a.waiver.credor} obtido em ${fmtDate(a.waiver.obtidoEm)}, após a data do balanço – não altera a classificação.`}
            </span>
          ))}
        </MessageStrip>
      )}

      <div className={clsx("grid gap-5", sel ? "xl:grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-1")}>
        <Card
          title={`Contratos (${linhas.length})`}
          subtitle="Valores em R$ · posição pelo custo amortizado na data-base · clique em um contrato para ver os termos e a decomposição do saldo"
          bodyClassName="px-0 pb-0"
          className="min-w-0 overflow-hidden"
        >
          <div className="hidden lg:block">
            <DataTable
              columns={colunas}
              rows={linhas}
              rowKey={(x) => x.c.id}
              onRowClick={(x) => alternar(x.c.id)}
              selectedKey={selecionado}
              rowClassName={(x) => (x.reclassificado && x.c.id !== selecionado ? HIGHLIGHT_RECLASSIFICADO : undefined)}
              showTotals
              defaultSort={{ key: "saldo", dir: "desc" }}
              emptyText="Nenhum contrato atende aos filtros"
            />
          </div>
          {/* Pop-in (sap.m.Table responsiva): em telas estreitas os valores descem para baixo do contrato */}
          <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
            {ordenadasSaldo.length === 0 && <li className="py-12 text-center text-label text-sm">Nenhum contrato atende aos filtros</li>}
            {ordenadasSaldo.map((x) => {
              const ativo = x.c.id === selecionado;
              return (
                <li key={x.c.id}>
                  <button
                    type="button"
                    onClick={() => alternar(x.c.id)}
                    aria-expanded={ativo}
                    className={clsx(
                      "w-full text-left px-4 py-3",
                      ativo ? "bg-selected shadow-[inset_3px_0_0_#0064d9]" : "hover:bg-[#f2f4f6]",
                      x.reclassificado && !ativo && "shadow-[inset_3px_0_0_#f53232]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: corModalidade(x.c) }} aria-hidden />
                          <span className="font-bold text-text whitespace-nowrap shrink-0">{x.c.id}</span>
                          <span className="text-xs text-label truncate">· {x.c.modalidade}</span>
                        </div>
                        <div className="text-xs text-text leading-snug pl-3.5">{taxaContratadaDivida(x.c)}</div>
                        <div className="text-xs text-label leading-snug truncate pl-3.5">
                          {x.c.credor} · Empresa {x.c.empresa}
                        </div>
                        {x.reclassificado && (
                          <ObjectStatus inverted state="negative" className="mt-1 ml-3.5">
                            Reclassificado (CPC 26)
                          </ObjectStatus>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-text tabular">{fmtNum(x.saldoContabil)}</div>
                        <div className="text-xs text-label tabular whitespace-nowrap">venc. {fmtDate(x.c.vencimento)}</div>
                      </div>
                    </div>
                    <PopInPosicao
                      circulante={x.circulante}
                      naoCirculante={x.naoCirculante}
                      principal={x.principalAtualizado}
                      juros={x.jurosAPagar}
                      destaqueCirculante={x.reclassificado}
                    />
                  </button>
                </li>
              );
            })}
            {ordenadasSaldo.length > 0 && (
              <li className="px-4 py-3 bg-[#f5f6f7]">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-bold text-text">Total ({linhas.length})</div>
                  <div className="text-sm font-bold text-text tabular">{fmtNum(k.saldo)}</div>
                </div>
                <PopInPosicao
                  circulante={k.circulante}
                  naoCirculante={k.naoCirculante}
                  principal={soma(linhas, (x) => x.principalAtualizado)}
                  juros={soma(linhas, (x) => x.jurosAPagar)}
                />
              </li>
            )}
          </ul>
          <p className="px-4 py-2.5 text-xs text-label border-t border-line-soft">
            Valores em R$. CET e próximo pagamento projetados com o último dado disponível importado do SAP ({fmtDate(ultimoDado)}).
          </p>
        </Card>
        {sel && (
          <DetalheContrato
            pos={sel}
            p={p}
            ultimoDado={ultimoDado}
            apuracoes={apuracoes}
            onClose={() => setSelecionado(null)}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DonutComposicao titulo="Composição por modalidade" subtitulo={`Saldo contábil · ${fmtCompact(k.saldo)}`} fatias={k.porModalidade} total={k.saldo} />
        <DonutComposicao titulo="Composição por indexador" subtitulo={`Saldo contábil · ${fmtCompact(k.saldo)}`} fatias={k.porIndexador} total={k.saldo} />
      </div>

      <MessageStrip>
        Saldo pelo custo amortizado = principal atualizado + juros a pagar − custos de transação a apropriar (CPC 48). Circulante =
        principal com vencimento em até 12 meses + juros a pagar − custos a apropriar no período (CPC 26). Juros compostos em base
        de 252 dias úteis (CDI e títulos IPCA+) e de 365 dias corridos (BNDES, com o excedente da TJLP sobre 6% a.a. capitalizado no
        principal); até a data-base valem as séries históricas de CDI, IPCA e TJLP importadas do SAP e, depois dela, o último dado
        disponível ({fmtDate(ultimoDado)}), que projeta taxas pós-fixadas, CET e próximos pagamentos (datas no dia útil seguinte).
      </MessageStrip>
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Gráfico de composição
// ---------------------------------------------------------------------------

function DonutComposicao({ titulo, subtitulo, fatias, total }: { titulo: string; subtitulo: string; fatias: Fatia[]; total: number }) {
  return (
    <Card title={titulo} subtitle={subtitulo}>
      {fatias.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-label">Nenhum contrato atende aos filtros</div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="relative w-40 h-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={fatias}
                  dataKey="valor"
                  nameKey="chave"
                  innerRadius="62%"
                  outerRadius="100%"
                  paddingAngle={fatias.length > 1 ? 1.5 : 0}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {fatias.map((f) => (
                    <Cell key={f.chave} fill={f.cor} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n) => [`${fmtBRL(v)} (${fmtPct(total > 0 ? v / total : 0, 1)})`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[11px] text-label leading-tight">Saldo</span>
              <span className="text-sm font-bold text-text tabular leading-tight">{fmtCompact(total)}</span>
            </div>
          </div>
          <ul className="w-full flex-1 min-w-0 divide-y divide-line-soft">
            {fatias.map((f) => (
              <li key={f.chave} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: f.cor }} />
                <span className="text-text font-semibold truncate">{f.chave}</span>
                <span className="text-xs text-label whitespace-nowrap">· {plural(f.qtd, "contrato", "contratos")}</span>
                <span className="ml-auto tabular text-text whitespace-nowrap">{fmtCompact(f.valor)}</span>
                <span className="tabular font-semibold text-text w-14 text-right shrink-0">{fmtPct(f.share, 1)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Painel de detalhe
// ---------------------------------------------------------------------------

function DetalheContrato({
  pos,
  p,
  ultimoDado,
  apuracoes,
  onClose,
}: {
  pos: PosicaoDivida;
  p: PremissasMercado;
  ultimoDado: string;
  apuracoes: ApuracaoCovenant[];
  onClose: () => void;
}) {
  const { c } = pos;
  const prox = pos.proximoPagamento;
  const covenants = c.covenants.map((id) => ({ cov: COVENANTS_DIVIDA.find((x) => x.id === id), apuracao: apuracoes.find((a) => a.cov.id === id) }));
  const covReclass = apuracoes.filter((a) => a.reclassifica && a.cov.contratos.includes(c.id));
  const reclassificado = pos.reclassificado ? valorReclassificado(pos, p.dataBase, p) : 0;
  const cpc20Ativo = c.capitalizacaoCPC20 ? c.capitalizacaoCPC20.ate > p.dataBase : false;
  const prazoTotalAnos = diffDays(c.dataCaptacao, c.vencimento) / 365;
  const pct = (v: number) => fmtParticipacao(v, pos.saldoContabil);
  const rotuloAtualizacao =
    c.indexador === "IPCA" || c.indexador === "TLP" ? " (IPCA)" : c.indexador === "TJLP" ? " (TJLP acima de 6% a.a.)" : "";

  const valorCampo: Record<string, string> = {
    C01: `${c.empresa} – ${EMPRESAS_DIVIDA[c.empresa] ?? ""}`,
    C02: c.transacao,
    C03: c.credor,
    C05: c.modalidade,
    C07: c.linhaCredito ?? "—",
    C08: fmtDate(c.dataCaptacao),
    C09: fmtDate(c.vencimento),
    C10: "BRL",
    C11: c.indexador,
    C12: fmtPct(c.spread),
    C13: fmtBRL(c.valorCaptado),
    C14: c.portfolio,
  };
  const mapa = MAPEAMENTO_C00.filter((m) => m.visao && valorCampo[m.id] !== undefined);

  return (
    <aside className="bg-white rounded-[var(--radius-card)] shadow-fiori-lg xl:shadow-fiori overflow-hidden self-auto xl:self-start flex flex-col fixed inset-x-4 bottom-4 top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 xl:sticky xl:inset-auto xl:top-[4.25rem] xl:z-auto xl:max-h-[calc(100vh-5.5rem)]">
      <header className="shrink-0 px-4 pt-3.5 pb-3 border-b border-line-soft">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-label">
              Contrato {c.id} · Transação {c.transacao}
            </div>
            <h3 className="text-lg font-bold text-text leading-snug">{c.instrumento}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-link hover:bg-hover shrink-0" aria-label="Fechar detalhe">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Tag>
            <span className="w-2 h-2 rounded-full mr-1.5 shrink-0" style={{ backgroundColor: corModalidade(c) }} aria-hidden />
            {c.modalidade}
          </Tag>
          <Tag>{c.indexador}</Tag>
          <Tag>Empresa {c.empresa}</Tag>
          {pos.reclassificado && (
            <ObjectStatus inverted state="negative">
              Reclassificado (CPC 26)
            </ObjectStatus>
          )}
          {cpc20Ativo && (
            <ObjectStatus inverted icon={false} state="neutral">
              Juros capitalizados (CPC 20)
            </ObjectStatus>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto fiori-scroll px-4 py-4 space-y-5">
        {pos.reclassificado && (
          <MessageStrip design="negative">
            {covReclass.length > 0 ? (
              <>
                {covReclass.map((a) => `${a.cov.indicador} descumprido em ${fmtDate(a.dataApuracao)} (${fmtValorCovenant(a)} vs limite ${fmtLimite(a.cov)})`).join("; ")}{" "}
                sem waiver obtido até a data do balanço.{" "}
              </>
            ) : (
              "Covenant descumprido na data do balanço sem waiver. "
            )}
            Pelo CPC 26, item 74, o passivo é classificado integralmente no circulante: {fmtBRL(reclassificado)} que seriam não circulante
            foram reclassificados.
            {covReclass.some((a) => a.waiver && a.waiver.obtidoEm > p.dataBase) &&
              ` O waiver obtido em ${fmtDate(covReclass.find((a) => a.waiver)?.waiver?.obtidoEm)} (após a data-base) é evento subsequente e não altera a classificação.`}
          </MessageStrip>
        )}

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Posição na data-base (custo amortizado)</h4>
          <dl className="space-y-1.5 text-[13px]">
            <Linha label="Principal nominal remanescente" valor={fmtBRL(pos.principalNominal, true)} />
            <Linha label={`(+) Atualização monetária${rotuloAtualizacao}`} valor={fmtBRL(pos.atualizacaoMonetaria, true)} />
            <div className="border-t border-line-soft pt-1.5">
              <Linha label="Principal atualizado" valor={fmtBRL(pos.principalAtualizado, true)} semi />
            </div>
            <Linha label="(+) Juros a pagar" valor={fmtBRL(pos.jurosAPagar, true)} />
            <Linha label="(−) Custos de transação a apropriar" valor={`(${fmtBRL(pos.custosAApropriar, true)})`} />
            <div className="border-t border-line-soft pt-1.5">
              <Linha label="Saldo contábil" valor={fmtBRL(pos.saldoContabil, true)} forte />
            </div>
            <Linha label={`Circulante (${pct(pos.circulante)})`} valor={fmtBRL(pos.circulante, true)} cor={pos.reclassificado ? "text-negative font-semibold" : undefined} />
            <Linha label={`Não circulante (${pct(pos.naoCirculante)})`} valor={fmtBRL(pos.naoCirculante, true)} />
          </dl>
          <div className="flex h-2 rounded-full overflow-hidden mt-3 bg-[#e5e5e5]" aria-hidden>
            <div style={{ width: `${pos.saldoContabil > 0 ? (pos.circulante / pos.saldoContabil) * 100 : 0}%`, backgroundColor: pos.reclassificado ? "#f53232" : COR_CP }} />
            <div style={{ width: `${pos.saldoContabil > 0 ? (pos.naoCirculante / pos.saldoContabil) * 100 : 0}%`, backgroundColor: COR_NC }} />
          </div>
          <div className="flex justify-between text-[11px] text-label mt-1">
            <span>Circulante</span>
            <span>Não circulante</span>
          </div>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Custo e prazo</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Taxa efetiva a.a.">{fmtPct(pos.taxaEfetivaAA)}</Field>
            <Field label="CET a.a.">{fmtPct(pos.cet)}</Field>
            <Field label="Prazo médio">{`${fmtDec(pos.prazoMedioAnos, 2)} anos`}</Field>
            <Field label="Dias até o vencimento">
              <span className={clsx(pos.diasAteVencimento <= 365 && "text-critical")}>{fmtInt(pos.diasAteVencimento)} dias</span>
            </Field>
          </div>
          <div className="mt-3 rounded-lg border border-line-soft bg-[#f5f6f7] px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
              <CalendarClock className="w-4 h-4 text-link" />
              Próximo pagamento{prox ? ` · ${fmtDate(prox.data)}` : ""}
            </div>
            {prox ? (
              <dl className="space-y-1 text-[13px] mt-1.5">
                <Linha label="Principal" valor={fmtBRL(prox.principal, true)} />
                <Linha label="Juros" valor={fmtBRL(prox.juros, true)} />
                <div className="border-t border-line pt-1">
                  <Linha label={`Total (em ${fmtInt(diffDays(p.dataBase, prox.data))} dias)`} valor={fmtBRL(prox.principal + prox.juros, true)} semi />
                </div>
              </dl>
            ) : (
              <div className="text-[13px] text-label mt-1">Sem pagamentos futuros</div>
            )}
            <p className="text-[11px] text-label mt-1.5 leading-snug">Projetado com o último dado disponível importado do SAP ({fmtDate(ultimoDado)}).</p>
          </div>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Termos do contrato</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Transação SAP">{c.transacao}</Field>
            <Field label="Portfolio">{c.portfolio}</Field>
            <Texto label="Empresa" className="col-span-2">
              {c.empresa} – {EMPRESAS_DIVIDA[c.empresa] ?? "—"}
            </Texto>
            <Field label="Modalidade">{c.modalidade}</Field>
            <Field label="Forma BNDES">{c.formaBNDES ?? "—"}</Field>
            <Texto label="Credor">{c.credor}</Texto>
            <Texto label="Agente">{c.agente ?? "—"}</Texto>
            <Field label="Indexador">{c.indexador}</Field>
            <Field label="Spread a.a.">{fmtPct(c.spread)}</Field>
            {c.spreadAgente !== undefined && (
              <>
                <Field label="Spread do agente a.a.">{fmtPct(c.spreadAgente)}</Field>
                <Field label="Spread total (composto)">{fmtPct(spreadTotal(c))}</Field>
              </>
            )}
            <Texto label="Taxa contratada" className="col-span-2">
              {taxaContratadaDivida(c)}
            </Texto>
            <Field label="Data de captação">{fmtDate(c.dataCaptacao)}</Field>
            <Field label="Vencimento">{fmtDate(c.vencimento)}</Field>
            <Field label="Valor captado">{fmtBRL(c.valorCaptado)}</Field>
            <Field label="Custos de transação">{fmtBRL(c.custosTransacao)}</Field>
            <Field label="Prazo total">{`${fmtDec(prazoTotalAnos, 1)} anos`}</Field>
            <Field label="Linha de crédito">{c.linhaCredito ?? "—"}</Field>
            <Texto label="Amortização" className="col-span-2">
              {c.descricaoAmortizacao}
            </Texto>
            <Texto label="Pagamento de juros" className="col-span-2">
              {c.descricaoJuros}
            </Texto>
          </div>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Garantias, finalidade e covenants</h4>
          <div className="space-y-3">
            <Texto label="Garantias">{c.garantias}</Texto>
            <Texto label="Finalidade">{c.finalidade}</Texto>
            {c.lastro && <Texto label="Lastro">{c.lastro}</Texto>}
            <Texto label="Capitalização de juros (CPC 20)">
              {c.capitalizacaoCPC20 ? (
                <>
                  {c.capitalizacaoCPC20.ativo} – até {fmtDate(c.capitalizacaoCPC20.ate)}{" "}
                  <span className={clsx("font-normal", cpc20Ativo ? "text-info" : "text-label")}>({cpc20Ativo ? "em andamento" : "encerrada"})</span>
                </>
              ) : (
                <span className="font-normal text-label">Não se aplica – encargos reconhecidos na despesa financeira</span>
              )}
            </Texto>
            <div>
              <div className="text-[13px] text-label leading-tight mb-1">Covenants financeiros</div>
              {covenants.length === 0 ? (
                <div className="text-sm text-label">Sem covenants financeiros</div>
              ) : (
                <ul className="divide-y divide-line-soft rounded-lg border border-line-soft">
                  {covenants.map(({ cov, apuracao }) => {
                    if (!cov) return null;
                    const est = estadoCovenant(apuracao);
                    return (
                      <li key={cov.id} className="px-3 py-2 text-[13px]">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-text min-w-0">{cov.indicador}</span>
                          <ObjectStatus state={est.state}>{est.texto}</ObjectStatus>
                        </div>
                        <div className="text-xs text-label mt-0.5">
                          Limite {fmtLimite(cov)} · {cov.periodicidade.toLowerCase()}
                          {apuracao?.dataApuracao ? ` · apurado ${fmtValorCovenant(apuracao)} em ${fmtDate(apuracao.dataApuracao)}` : ""}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2 flex items-center gap-1.5">
            <Database className="w-4 h-4 text-[#5d36ff]" /> Origem no SAP (CDS Views)
          </h4>
          <ul className="divide-y divide-line-soft rounded-lg border border-line-soft">
            {mapa.map((m) => (
              <li key={m.id} className="px-3 py-1.5 flex items-center justify-between gap-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div className="text-label text-xs truncate">{m.coluna}</div>
                  <div className="font-mono text-[11px] text-[#5d36ff] truncate" title={`${m.visao}.${m.campo}`}>
                    {m.visao}.{m.campo}
                  </div>
                </div>
                <span className="text-text font-semibold text-right truncate shrink-0 max-w-[58%]" title={valorCampo[m.id]}>
                  {valorCampo[m.id]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

/** Valores da posição que descem para baixo do contrato na lista pop-in (telas estreitas) */
function PopInPosicao({
  circulante,
  naoCirculante,
  principal,
  juros,
  destaqueCirculante,
}: {
  circulante: number;
  naoCirculante: number;
  principal: number;
  juros: number;
  destaqueCirculante?: boolean;
}) {
  const item = (rotulo: string, valor: number, cls?: string) => (
    <div className="min-w-0">
      <dt className="text-xs text-label">{rotulo}</dt>
      <dd className={clsx("text-text font-semibold tabular", cls)}>{fmtNum(valor, { dash: true })}</dd>
    </div>
  );
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 mt-2 text-[13px]">
      {item("Circulante", circulante, destaqueCirculante ? "text-negative" : undefined)}
      {item("Não circulante", naoCirculante)}
      {item("Principal atualizado", principal)}
      {item("Juros a pagar", juros)}
    </dl>
  );
}

function Linha({ label, valor, forte, semi, cor }: { label: string; valor: string; forte?: boolean; semi?: boolean; cor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={clsx(forte || semi ? "text-text font-semibold" : "text-label")}>{label}</dt>
      <dd className={clsx("tabular whitespace-nowrap", forte ? "font-bold text-text text-sm" : semi ? "font-semibold text-text" : "text-text", cor)}>{valor}</dd>
    </div>
  );
}

/** Rótulo + texto longo (sem truncar) */
function Texto({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("min-w-0", className)}>
      <div className="text-[13px] text-label leading-tight">{label}</div>
      <div className="text-sm text-text font-semibold leading-snug mt-0.5 break-words">{children}</div>
    </div>
  );
}
