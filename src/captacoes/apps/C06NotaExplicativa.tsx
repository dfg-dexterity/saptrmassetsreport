import clsx from "clsx";
import { ChevronRight, Copy } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "../../shared/components/fiori/Button";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { TabBar } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, CHART_COLORS, CHART_SEMANTIC, HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { EMPRESA_CONTROLADORA, EMPRESAS } from "../../shared/data/empresas";
import { premissasNaDataBase, ultimoDadoNaDataBase } from "../../shared/data/mercado";
import { addDays, addMonths, fmtDate } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtCompact, fmtDec, fmtNum, fmtPct, fmtX } from "../../shared/lib/format";
import { useCovenants, useDivida } from "../context/useDivida";
import { relatorioCaptacao } from "../data/catalogo";
import { COR_MODALIDADE, GRUPO_MODALIDADE, taxaContratadaDivida, type ContratoDivida, type IndexadorDivida } from "../data/contratos";
import type { CovenantId } from "../data/covenants";
import { reclassificadosEm, type ApuracaoCovenant } from "../lib/covenants";
import {
  custoMedioPonderado,
  diferencaRollforward,
  movimentacaoDivida,
  perfilAmortizacao,
  posicoesDivida,
  prazoMedioCarteira,
  totalDivida,
  type CamposMov,
  type MovContrato,
  type PosicaoDivida,
} from "../lib/divida";
import { arredondarTabela, ratear, saldosMil } from "../lib/arredondamento";

const rel = relatorioCaptacao("c06");
const tooltipStyle = { backgroundColor: "#2e2e2e", border: "1px solid rgba(247, 243, 231, 0.13)", borderRadius: 0, color: "#f7f3e7", fontFamily: "Figtree, system-ui, sans-serif", fontSize: 12 };
const legendStyle = { fontSize: 12, fontFamily: "Figtree, system-ui, sans-serif" };

type Aba = "comp" | "mov" | "venc" | "carac" | "custos" | "cov" | "nota";

// ---------------------------------------------------------------------------
// Modalidades (ordem da nota explicativa)
// ---------------------------------------------------------------------------

type Grupo = "Debêntures" | "CRA" | "CRI" | "BNDES" | "CCB";

const GRUPOS: Grupo[] = ["Debêntures", "CRA", "CRI", "BNDES", "CCB"];

const NOME_GRUPO: Record<Grupo, string> = {
  Debêntures: "Debêntures",
  CRA: "Certificados de Recebíveis do Agronegócio (CRA)",
  CRI: "Certificados de Recebíveis Imobiliários (CRI)",
  BNDES: "Financiamentos BNDES (FINEM / FINAME)",
  CCB: "Cédulas de Crédito Bancário (CCB)",
};

/** Cor de cada modalidade – a mesma em todas as telas de Captações (COR_MODALIDADE) */
const COR_GRUPO = COR_MODALIDADE as Record<Grupo, string>;

/** Modalidades detalhadas na aba de características */
const GRUPOS_CARACTERISTICAS: Grupo[] = ["Debêntures", "CRA", "CRI", "BNDES"];

const grupoDe = (c: ContratoDivida) => GRUPO_MODALIDADE[c.modalidade] as Grupo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function soma<T>(xs: T[], f: (x: T) => number): number {
  return xs.reduce((s, x) => s + f(x), 0);
}

function listaPt(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** Primeira letra minúscula para uso no meio da frase, preservando siglas ("CDCA", "BNDES") */
function minuscula(s: string): string {
  if (!s || (s.length > 1 && s[1] === s[1].toUpperCase() && s[1] !== s[1].toLowerCase())) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** Garantias no meio da frase: "espécie quirografária", "sem garantia real" ou "garantias: …" */
function garantiasTexto(g: string): string {
  if (/^quirograf/i.test(g)) return "espécie quirografária (sem garantia real)";
  if (/^sem /i.test(g)) return minuscula(g);
  return `garantias: ${minuscula(g)}`;
}

/** Encerra a frase com ponto sem duplicar o de "a.a." */
function frase(s: string): string {
  return s.endsWith(".") ? s : `${s}.`;
}

/** Valor já arredondado em R$ mil (inteiro): negativos entre parênteses, zero como "–" */
function fmtK(v: number): string {
  return fmtNum(v, { parens: true, dash: true });
}

/** "R$ 12.345 mil" a partir de um valor já em R$ mil – espaços não separáveis (sem "R$" sozinho no fim da linha) */
function rsK(v: number): string {
  return `R$\u00a0${fmtNum(v)}\u00a0mil`;
}

/** "R$ 12.345 mil" a partir de um valor em R$ (textos da nota) */
function rsMil(v: number): string {
  return rsK(Math.round(v / 1000));
}

/** Nota das tabelas em R$ mil */
const NOTA_ARREDONDAMENTO =
  "Valores em R$ mil arredondados de modo que linhas e colunas fechem (a diferença de arredondamento é alocada à parcela com maior resto).";

/** Legenda dos gráficos: texto na cor do texto (a cor da série fica só no marcador) */
function textoLegenda(valor: string) {
  return <span style={{ color: "#f7f3e7" }}>{valor}</span>;
}

function useMediaQuery(query: string): boolean {
  const [ok, setOk] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOk(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return ok;
}

/** Spread total a.a. (BNDES indireto: spread do BNDES somado ao do agente financeiro, como no motor e nas escrituras) */
function spreadTotal(c: ContratoDivida): number {
  return c.spread + (c.spreadAgente ?? 0);
}

/** Encargos contratuais médios ponderados pelo saldo, por indexador: "CDI + 1,42% a.a. · IPCA + 6,20% a.a." */
function encargosMedios(pos: PosicaoDivida[]): string {
  const ordem: IndexadorDivida[] = ["CDI", "IPCA", "TJLP", "TLP", "Pré"];
  return ordem
    .map((idx) => {
      const xs = pos.filter((x) => x.c.indexador === idx);
      const saldo = totalDivida(xs);
      if (!xs.length || saldo <= 0) return null;
      const sp = soma(xs, (x) => spreadTotal(x.c) * x.saldoContabil) / saldo;
      return idx === "Pré" ? `${fmtPct(sp)} a.a. (pré)` : `${idx} + ${fmtPct(sp)} a.a.`;
    })
    .filter((x): x is string => x !== null)
    .join(" · ");
}

/** Custos de transação a apropriar após 12 meses (redutora do passivo não circulante) */
function custosNaoCirculante(x: PosicaoDivida): number {
  return Math.max(0, x.custosAApropriar - x.custosCirculante);
}

/** Saldo e parcela não circulante dos contratos na data, sem a reclassificação do CPC 26 */
function semReclassificacao(contratos: ContratoDivida[], ids: string[], data: string) {
  const pos = posicoesDivida(
    contratos.filter((c) => ids.includes(c.id)),
    data,
    premissasNaDataBase(data),
  );
  return { saldo: totalDivida(pos), nc: soma(pos, (x) => x.naoCirculante) };
}

// ---------------------------------------------------------------------------
// Arredondamento controlado (tabelas em R$ mil que fecham nas linhas e nas colunas)
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// Números da nota em R$ mil (arredondamento controlado: as tabelas fecham e repetem os mesmos valores)
// ---------------------------------------------------------------------------

/**
 * Mesmo critério do C02 para os totais do balanço: arredonda as parcelas e ajusta a maior (exceto as `fixos`) para
 * somar o total – assim circulante, não circulante e reclassificado são os mesmos números no C02 e no C06.
 */
function fecharEmMil(componentes: number[], alvoMil: number, fixos: number[] = []): number[] {
  const r = componentes.map((v) => Math.round(v / 1000));
  const dif = alvoMil - r.reduce((s, v) => s + v, 0);
  let i = -1;
  for (let k = 0; k < componentes.length; k++) {
    if (fixos.includes(k)) continue;
    if (i < 0 || Math.abs(componentes[k]) > Math.abs(componentes[i])) i = k;
  }
  if (dif !== 0 && i >= 0) r[i] += dif;
  return r;
}

interface CpNc {
  circ: number;
  nc: number;
  total: number;
}

const mil = (v: number) => v / 1000;


/**
 * Composição em R$ mil: modalidades × (circulante, não circulante) e, dentro de cada modalidade, os contratos, com os
 * saldos de `saldosMil` (os mesmos da movimentação no C01)
 */
function composicaoMil(linhas: { grupo: string; pos: PosicaoDivida[] }[]): { grupos: CpNc[]; total: CpNc; contratos: Map<string, CpNc> } {
  const contratos = new Map<string, CpNc>();
  if (!linhas.length) return { grupos: [], total: { circ: 0, nc: 0, total: 0 }, contratos };
  const s = saldosMil(linhas.flatMap((l) => l.pos.map((x) => ({ grupo: l.grupo, id: x.c.id, saldo: x.saldoContabil }))));
  const todas = linhas.flatMap((l) => l.pos);
  const g = arredondarTabela(
    linhas.map((l) => [mil(soma(l.pos, (x) => x.circulante)), mil(soma(l.pos, (x) => x.naoCirculante))]),
    {
      linhas: linhas.map((l) => s.grupos.get(l.grupo) ?? 0),
      colunas: fecharEmMil([soma(todas, (x) => x.circulante), soma(todas, (x) => x.naoCirculante)], s.total),
      geral: s.total,
    },
  );
  linhas.forEach((l, i) => {
    if (!l.pos.length) return;
    const c = arredondarTabela(
      l.pos.map((x) => [mil(x.circulante), mil(x.naoCirculante)]),
      { linhas: l.pos.map((x) => s.contratos.get(x.c.id) ?? 0), colunas: g.celulas[i], geral: g.linhas[i] },
    );
    l.pos.forEach((x, j) => contratos.set(x.c.id, { circ: c.celulas[j][0], nc: c.celulas[j][1], total: c.linhas[j] }));
  });
  return {
    grupos: g.celulas.map(([circ, nc], i) => ({ circ, nc, total: g.linhas[i] })),
    total: { circ: g.colunas[0], nc: g.colunas[1], total: g.geral },
    contratos,
  };
}

interface ComponentesSaldo {
  principal: number;
  am: number;
  juros: number;
  /** negativo (redutora) */
  custos: number;
  total: number;
}

/** Componentes do saldo contábil em R$ mil que somam o total da composição; `custos` fixa a redutora, se informada */
function componentesMil(s: ComponentesSaldo, total: number, custos?: number): ComponentesSaldo {
  if (custos === undefined) {
    const [principal, am, juros, c] = ratear([mil(s.principal), mil(s.am), mil(s.juros), mil(s.custos)], total);
    return { principal, am, juros, custos: c, total };
  }
  const [principal, am, juros] = ratear([mil(s.principal), mil(s.am), mil(s.juros)], total - custos);
  return { principal, am, juros, custos, total };
}

/** Movimentações que somam: saldo inicial + movimentações = saldo final */
const MOVS: CamposMov[] = ["captacoes", "custosTransacao", "juros", "atualizacaoMonetaria", "apropriacaoCustos", "pagamentoPrincipal", "pagamentoJuros"];

type MovMil = Record<CamposMov, number>;

function movMil(saldoInicial: number, saldoFinal: number, movs: number[], capitalizados: number): MovMil {
  const r = { saldoInicial, saldoFinal, capitalizados } as MovMil;
  MOVS.forEach((c, i) => (r[c] = movs[i] ?? 0));
  return r;
}

/** Coluna única (Controladora): saldos arredondados e movimentações rateadas para fechar */
function movimentacaoMilColuna(t: Record<CamposMov, number>): MovMil {
  const si = Math.round(mil(t.saldoInicial));
  const sf = Math.round(mil(t.saldoFinal));
  return movMil(si, sf, ratear(MOVS.map((c) => mil(t[c])), sf - si), Math.round(mil(t.capitalizados)));
}

// ---------------------------------------------------------------------------
// Covenants
// ---------------------------------------------------------------------------

const NOME_TEXTO: Record<CovenantId, string> = {
  dlEbitda: "índice dívida líquida/EBITDA",
  icsd: "índice de cobertura do serviço da dívida (ICSD)",
  capitalizacao: "índice de capitalização (patrimônio líquido/ativo total)",
  ebitdaDespFin: "índice EBITDA/encargos financeiros",
  dlImoveisPl: "índice (dívida líquida + imóveis a pagar)/patrimônio líquido",
};

const SIGLA: Record<CovenantId, string> = {
  dlEbitda: "DL/EBITDA",
  icsd: "ICSD",
  capitalizacao: "índice de capitalização",
  ebitdaDespFin: "EBITDA/encargos financeiros",
  dlImoveisPl: "(DL + imóveis a pagar)/PL",
};

function fmtCov(a: ApuracaoCovenant, v: number): string {
  return a.cov.formato === "pct" ? fmtPct(v, 1) : fmtX(v, 2);
}

function fmtLimite(a: ApuracaoCovenant): string {
  return a.cov.formato === "pct" ? fmtPct(a.cov.limite, 0) : fmtX(a.cov.limite, 2);
}

function fmtFolga(a: ApuracaoCovenant): string {
  if (!a.dataApuracao) return "—";
  const sinal = a.folga >= 0 ? "+" : "−";
  const abs = Math.abs(a.folga);
  return a.cov.formato === "pct" ? `${sinal}${fmtDec(abs * 100, 1)} p.p.` : `${sinal}${fmtX(abs, 2)}`;
}

function situacaoCovenant(a: ApuracaoCovenant): { state: ValueState; texto: string } {
  if (!a.dataApuracao) return { state: "neutral", texto: "Sem apuração" };
  if (a.status === "excedido") return a.reclassifica ? { state: "negative", texto: "Descumprido" } : { state: "critical", texto: "Descumprido · waiver" };
  if (a.status === "atencao") return { state: "critical", texto: "Atenção" };
  return { state: "positive", texto: "Cumprido" };
}

function situacaoPorExtenso(a: ApuracaoCovenant): string {
  if (a.status === "excedido") {
    return a.waiver
      ? `descumprido, com waiver do ${a.waiver.credor} obtido em ${fmtDate(a.waiver.obtidoEm)}${a.waiverVigente ? "" : " (após a data do balanço)"}`
      : "descumprido, sem waiver";
  }
  return a.status === "atencao" ? "cumprido, próximo do limite" : "cumprido";
}

function proximaApuracao(a: ApuracaoCovenant): string {
  return addMonths(a.dataApuracao!, a.cov.periodicidade === "Anual" ? 12 : 3);
}

interface EventoLinha {
  data: string;
  titulo: string;
  detalhe: string;
  state: ValueState;
  subsequente?: boolean;
}

interface Narrativa {
  design: "positive" | "critical" | "negative";
  titulo: string;
  paragrafos: string[];
  conclusao: string;
  eventos: EventoLinha[];
}

/** Texto sobre descumprimentos, waivers e reclassificação (CPC 26, itens 74–75) na data-base */
function narrativaCovenants(
  aps: ApuracaoCovenant[],
  db: string,
  contratos: ContratoDivida[],
  posDb: PosicaoDivida[],
  /** saldos por contrato em R$ mil, iguais aos da composição */
  milDb: Map<string, CpNc>,
): Narrativa {
  const paragrafos: string[] = [];
  const eventos: EventoLinha[] = [];
  const excedidos = aps.filter((a) => a.dataApuracao && a.status === "excedido");
  const atencao = aps.filter((a) => a.dataApuracao && a.status === "atencao");

  for (const a of excedidos) {
    const dA = a.dataApuracao!;
    const anual = a.cov.periodicidade === "Anual";
    const periodo = anual ? ` do exercício de ${dA.slice(0, 4)}` : "";
    const relacao = a.cov.tipo === "min" ? "abaixo do mínimo" : "acima do máximo";
    const ids = listaPt(a.cov.contratos);
    const antes = semReclassificacao(contratos, a.cov.contratos, dA);
    // na data-base, o saldo integral é o mesmo da composição (contratos arredondados que somam a modalidade)
    const saldoIntegral =
      dA === db ? rsK(a.cov.contratos.reduce((s, id) => s + (milDb.get(id)?.total ?? 0), 0)) : rsMil(antes.saldo);
    const w = a.waiver;

    paragrafos.push(
      `Em ${fmtDate(dA)}, o ${NOME_TEXTO[a.cov.id]}${periodo} foi apurado em ${fmtCov(a, a.valor)}, ${relacao} de ${fmtLimite(a)} exigido nos contratos ${ids}.`,
    );
    eventos.push({
      data: dA,
      titulo: `Apuração do ${SIGLA[a.cov.id]}${anual ? ` ${dA.slice(0, 4)}` : ""}`,
      detalhe: `${fmtCov(a, a.valor)} – ${relacao} de ${fmtLimite(a)} (${ids})`,
      state: "negative",
    });
    if (!w || w.obtidoEm > dA) {
      eventos.push({
        data: dA,
        titulo: "Reclassificação para o circulante",
        detalhe: `${rsMil(antes.nc)} do não circulante no balanço de ${fmtDate(dA)} (CPC 26, item 74)`,
        state: "critical",
      });
    }

    if (a.reclassifica) {
      paragrafos.push(
        w
          ? `Como a anuência (waiver) do ${w.credor} somente foi obtida em ${fmtDate(w.obtidoEm)}, após a data do balanço, a Companhia não detinha, em ${fmtDate(db)}, o direito de postergar a liquidação desses passivos por pelo menos 12 meses. Por isso, a parcela de ${rsMil(antes.nc)} que seria classificada no não circulante foi reclassificada para o passivo circulante (CPC 26, itens 74 e 75), e o saldo integral desses contratos, de ${saldoIntegral}, está apresentado no circulante.`
          : `Até a data do balanço não havia sido obtida a anuência (waiver) dos credores. Por isso, a parcela de ${rsMil(antes.nc)} que seria classificada no não circulante foi reclassificada para o passivo circulante (CPC 26, itens 74 e 75), e o saldo integral desses contratos, de ${saldoIntegral}, está apresentado no circulante.`,
      );
      if (w) {
        paragrafos.push(
          `O waiver obtido em ${fmtDate(w.obtidoEm)}, que dispensou o vencimento antecipado, é evento subsequente que não origina ajuste (CPC 24). Os saldos desses contratos voltarão a ser apresentados conforme o cronograma contratual nas próximas demonstrações.`,
        );
        eventos.push({
          data: w.obtidoEm,
          titulo: `Waiver do ${w.credor}`,
          detalhe: "Dispensa do vencimento antecipado – evento subsequente, sem ajuste (CPC 24)",
          state: "positive",
          subsequente: w.obtidoEm > db,
        });
      }
    } else if (w && a.waiverVigente) {
      paragrafos.push(
        w.obtidoEm > dA
          ? `Em ${fmtDate(w.obtidoEm)}, o ${w.credor} concedeu waiver dispensando o vencimento antecipado. Como a anuência foi obtida após a data do balanço de ${fmtDate(dA)}, naquela data a parcela não circulante desses contratos, de ${rsMil(antes.nc)}, foi reclassificada para o passivo circulante (CPC 26, item 74).`
          : `O ${w.credor} concedeu waiver em ${fmtDate(w.obtidoEm)}, antes da data do balanço; por isso, os saldos foram mantidos conforme o cronograma contratual.`,
      );
      const posC = posDb.filter((x) => a.cov.contratos.includes(x.c.id));
      const circ = soma(posC, (x) => milDb.get(x.c.id)?.circ ?? 0);
      const nc = soma(posC, (x) => milDb.get(x.c.id)?.nc ?? 0);
      paragrafos.push(
        `Em ${fmtDate(db)}, com o waiver vigente, os contratos ${ids} são apresentados conforme o cronograma contratual: ${rsK(circ)} no circulante e ${rsK(nc)} no não circulante. A próxima apuração do ${SIGLA[a.cov.id]} ocorrerá em ${fmtDate(proximaApuracao(a))}.`,
      );
      eventos.push({ data: w.obtidoEm, titulo: `Waiver do ${w.credor}`, detalhe: "Dispensa do vencimento antecipado", state: "positive" });
      eventos.push({
        data: db,
        titulo: "Data-base",
        detalhe: `Cronograma contratual: ${rsK(circ)} no circulante e ${rsK(nc)} no não circulante`,
        state: "information",
      });
    }
  }

  for (const a of atencao) {
    paragrafos.push(
      `O ${NOME_TEXTO[a.cov.id]}, apurado em ${fmtCov(a, a.valor)} em ${fmtDate(a.dataApuracao)}, está próximo do limite de ${fmtLimite(a)}; a Companhia acompanha o indicador trimestralmente.`,
    );
  }

  const conclusao = excedidos.length
    ? `Os demais índices financeiros previstos nos contratos de captação estavam cumpridos na última apuração.`
    : `Em ${fmtDate(db)}, a Companhia cumpria todos os índices financeiros (covenants) previstos em seus contratos de captação.`;

  const reclassifica = excedidos.some((a) => a.reclassifica);
  const titulo = reclassifica
    ? `${listaPt(excedidos.map((a) => SIGLA[a.cov.id]))} descumprido sem waiver na data do balanço – passivo reclassificado para o circulante`
    : excedidos.length
      ? `${listaPt(excedidos.map((a) => SIGLA[a.cov.id]))} descumprido na última apuração – waiver obtido`
      : atencao.length
        ? "Todos os covenants cumpridos – há indicadores próximos do limite"
        : "Todos os covenants cumpridos na última apuração";

  return {
    design: reclassifica ? "negative" : excedidos.length || atencao.length ? "critical" : "positive",
    titulo,
    paragrafos,
    conclusao,
    eventos: eventos.map((e, i) => ({ e, i })).sort((a, b) => (a.e.data < b.e.data ? -1 : a.e.data > b.e.data ? 1 : a.i - b.i)).map((x) => x.e),
  };
}

// ---------------------------------------------------------------------------
// Movimentação (linhas da movimentação)
// ---------------------------------------------------------------------------

function linhasMovimentacao(ab: string, db: string): { campo: CamposMov; rotulo: string; forte?: boolean }[] {
  return [
    { campo: "saldoInicial", rotulo: `Saldo em ${fmtDate(ab)}`, forte: true },
    { campo: "captacoes", rotulo: "(+) Captações" },
    { campo: "custosTransacao", rotulo: "(−) Custos de transação incorridos" },
    { campo: "juros", rotulo: "(+) Juros apropriados" },
    { campo: "atualizacaoMonetaria", rotulo: "(+) Atualização monetária (IPCA / TLP)" },
    { campo: "apropriacaoCustos", rotulo: "(+) Apropriação dos custos de transação" },
    { campo: "pagamentoPrincipal", rotulo: "(−) Amortização de principal" },
    { campo: "pagamentoJuros", rotulo: "(−) Pagamento de juros" },
    { campo: "saldoFinal", rotulo: `Saldo em ${fmtDate(db)}`, forte: true },
  ];
}

// ---------------------------------------------------------------------------
// Texto da nota
// ---------------------------------------------------------------------------

type Bloco = { t: "titulo" | "secao" | "p" | "li"; texto: string };

function textoParaCopiar(blocos: Bloco[]): string {
  let out = "";
  blocos.forEach((b, i) => {
    const anterior = blocos[i - 1];
    if (i > 0) out += b.t === "li" && anterior?.t === "li" ? "\n" : "\n\n";
    out += b.t === "li" ? `• ${b.texto}` : b.texto;
  });
  return out;
}

interface LinhaComp {
  grupo: Grupo;
  pos: PosicaoDivida[];
  posA: PosicaoDivida[];
  encargos: string;
  taxa: number;
  circ: number;
  nc: number;
  total: number;
  circA: number;
  ncA: number;
  totalA: number;
}

interface LinhaCusto {
  x: PosicaoDivida;
  original: number;
  apropriado: number;
  circ: number;
  nc: number;
  aApropriar: number;
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function C06NotaExplicativa() {
  const { premissas: p, contratos, posicoes, reclassificados, abertura: ab } = useDivida();
  const apuracoes = useCovenants();
  const [aba, setAba] = useState<Aba>("comp");
  const [abertos, setAbertos] = useState<Set<Grupo>>(() => new Set());
  const db = p.dataBase;

  const d = useMemo(() => {
    // Abertura (31/12 do exercício anterior) com as premissas e a reclassificação daquela data
    const reclA = reclassificadosEm(ab);
    const posA = posicoesDivida(contratos, ab, premissasNaDataBase(ab), reclA);
    const total = totalDivida(posicoes);
    const totalA = totalDivida(posA);
    const circ = soma(posicoes, (x) => x.circulante);
    const nc = soma(posicoes, (x) => x.naoCirculante);
    const circA = soma(posA, (x) => x.circulante);
    const ncA = soma(posA, (x) => x.naoCirculante);

    const composicao: LinhaComp[] = GRUPOS.map((g) => {
      const pos = posicoes.filter((x) => grupoDe(x.c) === g);
      const pa = posA.filter((x) => grupoDe(x.c) === g);
      return {
        grupo: g,
        pos,
        posA: pa,
        encargos: encargosMedios(pos.length ? pos : pa),
        taxa: custoMedioPonderado(pos),
        circ: soma(pos, (x) => x.circulante),
        nc: soma(pos, (x) => x.naoCirculante),
        total: totalDivida(pos),
        circA: soma(pa, (x) => x.circulante),
        ncA: soma(pa, (x) => x.naoCirculante),
        totalA: totalDivida(pa),
      };
    }).filter((l) => l.pos.length || l.posA.length);

    const saldo = (xs: PosicaoDivida[]) => ({
      principal: soma(xs, (x) => x.principalNominal),
      am: soma(xs, (x) => x.atualizacaoMonetaria),
      juros: soma(xs, (x) => x.jurosAPagar),
      custos: -soma(xs, (x) => x.custosAApropriar),
      total: totalDivida(xs),
    });

    // Movimentação abertura → data-base
    const movCons = movimentacaoDivida(contratos, ab, db, p);
    const movCtrl = movimentacaoDivida(
      contratos.filter((c) => c.empresa === EMPRESA_CONTROLADORA),
      ab,
      db,
      p,
    );
    const movGrupos = GRUPOS.map((g) => ({
      grupo: g,
      total: movimentacaoDivida(
        contratos.filter((c) => grupoDe(c) === g),
        ab,
        db,
        p,
      ).total,
    })).filter((x) => Object.values(x.total).some((v) => Math.abs(v) >= 500));
    const novas = movCons.linhas.filter((l) => l.captacoes > 0);
    const liquidados = movCons.linhas.filter((l) => l.c.vencimento <= db);
    const capitalizados = movCons.linhas.filter((l) => l.capitalizados > 0);
    const difRoll = diferencaRollforward(movCons.total);

    // Vencimentos do não circulante (principal pelo valor contábil da data-base)
    const limite = addDays(db, 365);
    const ano0 = Number(addDays(limite, 1).slice(0, 4));
    const anoCorte = ano0 + 4;
    const porGrupoAno = new Map<Grupo, Map<number, number>>();
    const anosTodos = new Set<number>();
    let principalCP = 0;
    for (const x of posicoes) {
      const perfil = perfilAmortizacao(x, db);
      principalCP += perfil.circulante;
      const g = grupoDe(x.c);
      const m = porGrupoAno.get(g) ?? new Map<number, number>();
      for (const [ano, v] of perfil.porAno) {
        m.set(ano, (m.get(ano) ?? 0) + v);
        anosTodos.add(ano);
      }
      porGrupoAno.set(g, m);
    }
    const gruposVenc = GRUPOS.filter((g) => posicoes.some((x) => grupoDe(x.c) === g));
    const valorFaixa = (g: Grupo, f: (a: number) => boolean) =>
      [...(porGrupoAno.get(g) ?? new Map<number, number>()).entries()].filter(([a]) => f(a)).reduce((s, [, v]) => s + v, 0);
    const faixas = [
      ...[0, 1, 2, 3].map((i) => ({ rotulo: String(ano0 + i), f: (a: number) => a === ano0 + i })),
      { rotulo: `${anoCorte} em diante`, f: (a: number) => a >= anoCorte },
    ];
    const vencimentos = faixas.map((fx) => {
      const valores = gruposVenc.map((g) => valorFaixa(g, fx.f));
      return { rotulo: fx.rotulo, valores, total: soma(valores, (v) => v) };
    });
    const principalNC = gruposVenc.map((g) => valorFaixa(g, () => true));
    const custosNCGrupo = gruposVenc.map((g) =>
      soma(
        posicoes.filter((x) => grupoDe(x.c) === g),
        custosNaoCirculante,
      ),
    );
    const ncGrupo = gruposVenc.map((g) =>
      soma(
        posicoes.filter((x) => grupoDe(x.c) === g),
        (x) => x.naoCirculante,
      ),
    );
    const graficoVenc = [...anosTodos]
      .sort((a, b) => a - b)
      // zeros como nulos: a dica do gráfico lista só as modalidades com parcelas no ano
      .map((a) => ({ ano: String(a), ...Object.fromEntries(gruposVenc.map((g) => [g, (porGrupoAno.get(g)?.get(a) ?? 0) / 1e6 || null])) }));
    const bndesReclass = posicoes.filter((x) => x.reclassificado);

    // Custos de transação
    const custos: LinhaCusto[] = posicoes.map((x) => {
      const ncC = custosNaoCirculante(x);
      return {
        x,
        original: x.c.custosTransacao,
        apropriado: x.c.custosTransacao - x.custosAApropriar,
        circ: x.custosAApropriar - ncC,
        nc: ncC,
        aApropriar: x.custosAApropriar,
      };
    });
    const custosAb = soma(posA, (x) => x.custosAApropriar);
    const custosIncorridos = -movCons.total.custosTransacao;
    const custosApropriados = movCons.total.apropriacaoCustos;
    const custosDb = soma(posicoes, (x) => x.custosAApropriar);

    // Circulante: parcelas com vencimento em até 12 meses (cronograma contratual) × longo prazo reclassificado
    // (CPC 26, item 74), com o mesmo desdobramento do C02
    const contratuais = new Map(posicoesDivida(contratos, db, p).map((x) => [x.c.id, x]));
    const desdobra = posicoes.map((x) => {
      const ct = contratuais.get(x.c.id) ?? x;
      const custosCirculante = x.principalCirculante + x.jurosAPagar - x.circulante;
      const custos12m = x.reclassificado ? ct.principalCirculante + ct.jurosAPagar - ct.circulante : custosCirculante;
      return {
        principal12m: ct.principalCirculante,
        principalReclass: x.principalCirculante - ct.principalCirculante,
        custos12m,
        custosReclass: custosCirculante - custos12m,
      };
    });

    // ------------------------------------------------------------------------------------------------
    // R$ mil que fecham (arredondamento controlado), encadeados para que as tabelas repitam os mesmos valores
    // ------------------------------------------------------------------------------------------------
    const compDb = composicaoMil(composicao.map((l) => ({ grupo: l.grupo, pos: l.pos })));
    const compAb = composicaoMil(composicao.map((l) => ({ grupo: l.grupo, pos: l.posA })));
    const totalGrupo = (c: typeof compDb, g: Grupo) => {
      const i = composicao.findIndex((l) => l.grupo === g);
      return i >= 0 ? c.grupos[i] : { circ: 0, nc: 0, total: 0 };
    };
    // movimentação por modalidade: saldos inicial e final iguais aos da composição
    const tabMov = arredondarTabela(
      movGrupos.map((m) => MOVS.map((c) => mil(m.total[c]))),
      {
        linhas: movGrupos.map((m) => totalGrupo(compDb, m.grupo).total - totalGrupo(compAb, m.grupo).total),
        geral: compDb.total.total - compAb.total.total,
      },
    );
    const capGrupos = ratear(movGrupos.map((m) => mil(m.total.capitalizados)));
    const movGruposMil = movGrupos.map((m, i) =>
      movMil(totalGrupo(compAb, m.grupo).total, totalGrupo(compDb, m.grupo).total, tabMov.celulas[i], capGrupos[i]),
    );
    const movConsMil = movMil(compAb.total.total, compDb.total.total, tabMov.colunas, soma(capGrupos, (v) => v));
    const movCtrlMil = movimentacaoMilColuna(movCtrl.total);
    // custos a apropriar: abertura (composição do saldo) + incorridos − apropriados (movimentação) = saldo na data-base
    const saldoAbMil = componentesMil(saldo(posA), compAb.total.total);
    const custosAbMil = -saldoAbMil.custos;
    const custosIncMil = -movConsMil.custosTransacao;
    const custosAprMil = movConsMil.apropriacaoCustos;
    const custosDbMil = custosAbMil + custosIncMil - custosAprMil;
    const saldoDbMil = componentesMil(saldo(posicoes), compDb.total.total, -custosDbMil);
    // vencimentos do não circulante: parcelas por ano − custos a apropriar = passivo não circulante da composição
    // (a linha de custos entra no arredondamento, para que ela – e não uma parcela redonda – absorva as diferenças)
    const ncGrupoMil = gruposVenc.map((g) => totalGrupo(compDb, g).nc);
    const [, custosNCTotalMil] = fecharEmMil([soma(principalNC, (v) => v), -soma(custosNCGrupo, (v) => v)], compDb.total.nc);
    const tabVenc = arredondarTabela(
      [...vencimentos.map((v) => v.valores.map(mil)), custosNCGrupo.map((v) => -mil(v))],
      { linhas: [...vencimentos.map(() => undefined), custosNCTotalMil], colunas: ncGrupoMil, geral: compDb.total.nc },
    );
    const nFaixas = vencimentos.length;
    const custosNCGrupoMil = (tabVenc.celulas[nFaixas] ?? []).map((v) => -v);
    const principalNCMil = ncGrupoMil.map((v, i) => v + (custosNCGrupoMil[i] ?? 0));
    const custosNCMil = soma(custosNCGrupoMil, (v) => v);
    // custos por contrato: custo original = apropriado + a apropriar (circulante + não circulante)
    const origMil = custos.map((l) => Math.round(mil(l.original)));
    const totalOrigMil = soma(origMil, (v) => v);
    const tabCustos = arredondarTabela(
      custos.map((l) => [mil(l.apropriado), mil(l.circ), mil(l.nc)]),
      { linhas: origMil, colunas: [totalOrigMil - custosDbMil, custosDbMil - custosNCMil, custosNCMil], geral: totalOrigMil },
    );
    // capitalizados por contrato somando o total da movimentação
    const capitalizadosMil = ratear(capitalizados.map((l) => mil(l.capitalizados)), movConsMil.capitalizados);
    const reclassLiquido = soma(desdobra, (x) => x.principalReclass - x.custosReclass);
    const [principal12mMil, reclassMil] = fecharEmMil(
      [
        soma(desdobra, (x) => x.principal12m),
        reclassLiquido,
        soma(posicoes, (x) => x.jurosAPagar),
        -soma(desdobra, (x) => x.custos12m),
      ],
      compDb.total.circ,
      [1],
    );
    const [principalReclassMil] = fecharEmMil([soma(desdobra, (x) => x.principalReclass), -soma(desdobra, (x) => x.custosReclass)], reclassMil);
    const m = {
      compDb,
      compAb,
      movGrupos: movGruposMil,
      movCons: movConsMil,
      movCtrl: movCtrlMil,
      saldoDb: saldoDbMil,
      saldoAb: saldoAbMil,
      custosAb: custosAbMil,
      custosInc: custosIncMil,
      custosApr: custosAprMil,
      custosDb: custosDbMil,
      custosCirc: custosDbMil - custosNCMil,
      custosNC: custosNCMil,
      venc: {
        linhas: tabVenc.celulas.slice(0, nFaixas),
        totais: tabVenc.linhas.slice(0, nFaixas),
        principalNC: principalNCMil,
        custosNC: custosNCGrupoMil,
        nc: ncGrupoMil,
      },
      custosPorContrato: new Map(
        custos.map((l, i) => {
          const [apropriado, circ, nc] = tabCustos.celulas[i];
          return [l.x.c.id, { original: origMil[i], apropriado, circ, nc, aApropriar: circ + nc }];
        }),
      ),
      custosTotal: {
        original: totalOrigMil,
        apropriado: tabCustos.colunas[0] ?? 0,
        circ: tabCustos.colunas[1] ?? 0,
        nc: tabCustos.colunas[2] ?? 0,
        aApropriar: (tabCustos.colunas[1] ?? 0) + (tabCustos.colunas[2] ?? 0),
      },
      capitalizados: new Map(capitalizados.map((l, i) => [l.c.id, capitalizadosMil[i]])),
      principalCP: principal12mMil + principalReclassMil,
      principalReclassLP: principalReclassMil,
      /** não circulante levado ao circulante, líquido dos custos de longo prazo (o mesmo valor do C00, C02 e C04) */
      reclassLiquido: reclassMil,
      principalCP12: principal12mMil,
    };

    const narrativa = narrativaCovenants(apuracoes, db, contratos, posicoes, compDb.contratos);

    return {
      m,
      posA,
      reclA,
      total,
      totalA,
      circ,
      nc,
      circA,
      ncA,
      composicao,
      saldoDb: saldo(posicoes),
      saldoAb: saldo(posA),
      custoMedio: custoMedioPonderado(posicoes),
      prazoMedio: prazoMedioCarteira(posicoes),
      movCons,
      movCtrl,
      movGrupos,
      novas,
      liquidados,
      capitalizados,
      difRoll,
      ano0,
      anoCorte,
      limite,
      principalCP,
      gruposVenc,
      vencimentos,
      principalNC,
      custosNCGrupo,
      ncGrupo,
      graficoVenc,
      bndesReclass,
      custos,
      custosAb,
      custosIncorridos,
      custosApropriados,
      custosDb,
      narrativa,
    };
  }, [contratos, posicoes, ab, db, p, apuracoes]);

  const { m } = d;
  const linhasMov = linhasMovimentacao(ab, db);
  const encargosMil = m.movCons.juros + m.movCons.atualizacaoMonetaria + m.movCons.apropriacaoCustos;
  const ultimoDado = ultimoDadoNaDataBase(db);
  const reclassDb = [...reclassificados];
  const reclassAb = [...d.reclA];
  const primeiroMesNC = addDays(d.limite, 1);
  const ultimaFaixa = d.vencimentos[d.vencimentos.length - 1];
  /** Contratos sujeitos ao covenant e em aberto na data-base */
  const contratosCov = (a: ApuracaoCovenant) => {
    const ativos = a.cov.contratos.filter((id) => posicoes.some((x) => x.c.id === id));
    return ativos.length ? ativos : a.cov.contratos;
  };
  const totalPrincipalNC = soma(d.principalNC, (v) => v);
  const totalCaracteristicas = GRUPOS_CARACTERISTICAS.reduce((s, g) => s + posicoes.filter((x) => grupoDe(x.c) === g).length, 0);

  // Notas de rodapé da composição (reclassificação CPC 26)
  const notaReclass = (ids: string[], data: string, naDataBase: boolean) => {
    const a = apuracoes.find((x) => x.cov.contratos.some((c) => ids.includes(c)) && x.status === "excedido");
    const w = a?.waiver;
    return `Em ${fmtDate(data)}, o saldo de ${listaPt(ids)} ${naDataBase ? "está" : "estava"} integralmente no circulante: ${a ? `o ${SIGLA[a.cov.id]} (${fmtCov(a, a.valor)}; ${a.cov.tipo === "min" ? "mínimo" : "máximo"} ${fmtLimite(a)}) foi descumprido` : "houve descumprimento de covenant"} sem waiver obtido até a data do balanço (CPC 26, item 74)${w ? `; o waiver do ${w.credor} foi obtido em ${fmtDate(w.obtidoEm)}${naDataBase ? ", como evento subsequente" : ""}` : ""}.`;
  };

  // -------------------------------------------------------------------------
  // Texto da nota
  // -------------------------------------------------------------------------

  const blocos: Bloco[] = (() => {
    const b: Bloco[] = [];
    const push = (t: Bloco["t"], texto: string) => b.push({ t, texto });
    const tm = m.movCons;

    push("titulo", "Empréstimos, financiamentos e debêntures");

    push("secao", "a) Política contábil");
    push(
      "p",
      "Os empréstimos, financiamentos, debêntures e certificados de recebíveis (CRA e CRI) são reconhecidos inicialmente pelo valor justo, líquido dos custos de transação incorridos, e mensurados subsequentemente pelo custo amortizado. Os juros e a atualização monetária são apropriados ao resultado pela fluência do prazo dos contratos, em regime exponencial (CDI e títulos em base de 252 dias úteis; BNDES em 365 dias corridos, com o excedente da TJLP sobre 6% a.a. capitalizado ao principal) e com as taxas efetivamente incorridas (séries históricas de CDI, IPCA, TJLP e TLP); os custos de transação são apropriados linearmente pelo prazo de cada contrato, por não gerarem diferença relevante em relação ao método da taxa efetiva de juros (CPC 48 / IFRS 9).",
    );
    push(
      "p",
      "Os encargos atribuíveis à construção de ativos qualificáveis são capitalizados como parte do custo do ativo até sua entrada em operação (CPC 20). Os saldos são classificados no passivo circulante quando a liquidação deve ocorrer em até 12 meses após a data do balanço ou quando, nessa data, a Companhia não tem o direito de postergar a liquidação por pelo menos 12 meses – por exemplo, em caso de descumprimento de cláusula restritiva sem anuência (waiver) prévia dos credores (CPC 26, itens 69 a 76).",
    );

    push("secao", "b) Composição");
    push(
      "p",
      `Em ${fmtDate(db)}, o saldo consolidado de empréstimos, financiamentos e debêntures era de ${rsK(m.compDb.total.total)} (${rsK(m.compAb.total.total)} em ${fmtDate(ab)}), dos quais ${rsK(m.compDb.total.circ)} no passivo circulante e ${rsK(m.compDb.total.nc)} no não circulante; na Controladora, o saldo era de ${rsK(m.movCtrl.saldoFinal)}. O custo médio ponderado da dívida – juros e atualização monetária – era de ${fmtPct(d.custoMedio)} a.a., com prazo médio remanescente do principal de ${fmtDec(d.prazoMedio, 1)} anos.`,
    );
    d.composicao.forEach((l, i) => {
      if (l.total > 0) push("li", frase(`${NOME_GRUPO[l.grupo]}: ${rsK(m.compDb.grupos[i].total)} (${fmtPct(d.total > 0 ? l.total / d.total : 0, 1)} do total) – ${l.encargos}`));
    });
    if (reclassDb.length) push("p", notaReclass(reclassDb, db, true));
    if (reclassAb.length) push("p", `Informação comparativa: ${minuscula(notaReclass(reclassAb, ab, false))}`);

    push("secao", "c) Movimentação");
    const captTxt = d.novas.length
      ? `a Companhia captou ${rsK(tm.captacoes)} ${
          d.novas.length === 1
            ? `(${minuscula(d.novas[0].c.instrumento)}, ${d.novas[0].c.id})`
            : `em ${d.novas.length} operações (${listaPt(d.novas.map((l) => l.c.id))})`
        }, com custos de transação de ${rsK(-tm.custosTransacao)}`
      : "não houve novas captações";
    const capTxt = tm.capitalizados > 0 ? `, dos quais ${rsK(tm.capitalizados)} capitalizados no imobilizado em andamento (CPC 20)` : "";
    push(
      "p",
      `No período de ${fmtDate(ab)} a ${fmtDate(db)}, ${captTxt}. Foram apropriados encargos de ${rsK(encargosMil)} (juros de ${rsK(tm.juros)}, atualização monetária de ${rsK(tm.atualizacaoMonetaria)} e custos de transação de ${rsK(tm.apropriacaoCustos)})${capTxt}. Os pagamentos somaram ${rsK(-tm.pagamentoPrincipal)} de principal e ${rsK(-tm.pagamentoJuros)} de juros${d.liquidados.length ? `, incluindo a liquidação ${d.liquidados.length === 1 ? "do contrato" : "dos contratos"} ${listaPt(d.liquidados.map((l) => l.c.id))}` : ""}. O saldo passou de ${rsK(tm.saldoInicial)} para ${rsK(tm.saldoFinal)}.`,
    );

    push("secao", "d) Cronograma de vencimentos do não circulante");
    push(
      "p",
      `As parcelas de principal classificadas no passivo não circulante, de ${rsK(soma(m.venc.principalNC, (v) => v))} (antes dos custos de transação a apropriar de ${rsK(m.custosNC)}), têm o seguinte cronograma de vencimento:`,
    );
    d.vencimentos.forEach((v, i) => push("li", `${v.rotulo}: ${rsK(m.venc.totais[i])}`));
    push(
      "p",
      `Os valores em moeda corrente dos contratos indexados ao IPCA e à TLP consideram a atualização monetária até ${fmtDate(db)}, e os dos contratos em TJLP, o excedente da TJLP sobre 6% a.a. capitalizado ao principal. Os juros e as parcelas futuras dos contratos pós-fixados são projetados com o último dado disponível importado do SAP (${fmtDate(ultimoDado)}): CDI de ${fmtPct(p.cdi)} a.a., IPCA de ${fmtPct(p.ipca12m)} em 12 meses e TJLP de ${fmtPct(p.tjlp)} a.a.; nos contratos em TLP, a taxa real é a fixada na contratação. Pagamentos com vencimento em dia não útil são liquidados no dia útil seguinte.`,
    );

    push("secao", "e) Características e garantias");
    push("p", "As principais características das captações em aberto na data-base estão resumidas a seguir:");
    for (const x of posicoes) {
      const c = x.c;
      const forma =
        c.formaBNDES && !c.instrumento.toLowerCase().includes(c.formaBNDES.toLowerCase())
          ? `, na forma ${c.formaBNDES === "Direto" ? "direta" : "indireta"}${c.agente ? ` (${c.agente.replace(" (agente financeiro)", "")})` : ""}`
          : "";
      push(
        "li",
        `${c.id} – ${c.instrumento}${forma}: captação de ${rsMil(c.valorCaptado)} em ${fmtDate(c.dataCaptacao)}, vencimento em ${fmtDate(c.vencimento)}, remuneração de ${taxaContratadaDivida(c)}; ${garantiasTexto(c.garantias)}${c.lastro ? `; lastro: ${minuscula(c.lastro)}` : ""}; finalidade: ${minuscula(c.finalidade)}.`,
      );
    }

    push("secao", "f) Cláusulas restritivas (covenants)");
    push(
      "p",
      "Os contratos de captação contêm cláusulas restritivas financeiras, apuradas trimestral ou anualmente com base nas demonstrações financeiras consolidadas, cujo descumprimento pode ensejar o vencimento antecipado das dívidas. Na última apuração, os índices eram:",
    );
    for (const a of apuracoes) {
      if (!a.dataApuracao) continue;
      push(
        "li",
        `${a.cov.indicador} (${a.cov.tipo === "max" ? "máximo" : "mínimo"} ${fmtLimite(a)} – ${listaPt(contratosCov(a))}): ${fmtCov(a, a.valor)} em ${fmtDate(a.dataApuracao)} – ${situacaoPorExtenso(a)}.`,
      );
    }
    for (const par of d.narrativa.paragrafos) push("p", par);
    push("p", d.narrativa.conclusao);
    return b;
  })();

  const textoNota = textoParaCopiar(blocos);

  // -------------------------------------------------------------------------
  // Exportação
  // -------------------------------------------------------------------------

  const exportar = () => {
    const cpA = (id: string) => m.compAb.contratos.get(id);
    const cpD = (id: string) => m.compDb.contratos.get(id);
    const tituloGrupos = d.gruposVenc.map((g) => ({ titulo: g, tipo: "inteiro" as const, largura: 14 }));
    exportarExcel(
      `C06_Nota_Captacoes_${db}.xlsx`,
      [
        {
          nome: "Composição",
          titulo: "C06 – Empréstimos, financiamentos e debêntures: composição por modalidade",
          subtitulo: `Consolidado · R$ mil · ${fmtDate(db)} × ${fmtDate(ab)}`,
          colunas: [
            { titulo: "Modalidade / contrato", largura: 48 },
            { titulo: "Encargos contratuais (média ponderada)", largura: 40 },
            { titulo: "Taxa efetiva (% a.a.)", tipo: "decimal", largura: 14 },
            { titulo: `Circulante ${fmtDate(db)}`, tipo: "inteiro", largura: 16 },
            { titulo: `Não circulante ${fmtDate(db)}`, tipo: "inteiro", largura: 18 },
            { titulo: `Total ${fmtDate(db)}`, tipo: "inteiro", largura: 16 },
            { titulo: `Circulante ${fmtDate(ab)}`, tipo: "inteiro", largura: 16 },
            { titulo: `Não circulante ${fmtDate(ab)}`, tipo: "inteiro", largura: 18 },
            { titulo: `Total ${fmtDate(ab)}`, tipo: "inteiro", largura: 16 },
          ],
          linhas: d.composicao.flatMap((l, i) => [
            [
              NOME_GRUPO[l.grupo],
              l.encargos,
              l.pos.length ? l.taxa * 100 : null,
              m.compDb.grupos[i].circ,
              m.compDb.grupos[i].nc,
              m.compDb.grupos[i].total,
              m.compAb.grupos[i].circ,
              m.compAb.grupos[i].nc,
              m.compAb.grupos[i].total,
            ],
            ...idsDoGrupo(l).map((id) => {
              const x = l.pos.find((y) => y.c.id === id);
              const xa = l.posA.find((y) => y.c.id === id);
              const c = (x ?? xa)!.c;
              return [
                `    ${c.id} – ${c.instrumento}`,
                taxaContratadaDivida(c),
                x ? x.taxaEfetivaAA * 100 : null,
                x ? (cpD(id)?.circ ?? null) : null,
                x ? (cpD(id)?.nc ?? null) : null,
                x ? (cpD(id)?.total ?? null) : null,
                xa ? (cpA(id)?.circ ?? null) : null,
                xa ? (cpA(id)?.nc ?? null) : null,
                xa ? (cpA(id)?.total ?? null) : null,
              ];
            }),
          ]),
          total: ["Total", "", d.custoMedio * 100, m.compDb.total.circ, m.compDb.total.nc, m.compDb.total.total, m.compAb.total.circ, m.compAb.total.nc, m.compAb.total.total],
          notas: [
            "Saldos pelo custo amortizado: principal atualizado + juros a pagar − custos de transação a apropriar (CPC 48).",
            NOTA_ARREDONDAMENTO,
            "Taxa efetiva a.a. = juros + correção monetária com as taxas vigentes na data-base (pós-fixados projetados com o último dado disponível importado do SAP).",
            ...(reclassDb.length ? [notaReclass(reclassDb, db, true)] : []),
            ...(reclassAb.length ? [notaReclass(reclassAb, ab, false)] : []),
          ],
        },
        {
          nome: "Saldo contábil",
          titulo: "C06 – Composição do saldo contábil (custo amortizado)",
          subtitulo: "Consolidado · R$ mil",
          colunas: [
            { titulo: "Componente", largura: 44 },
            { titulo: fmtDate(db), tipo: "inteiro", largura: 16 },
            { titulo: fmtDate(ab), tipo: "inteiro", largura: 16 },
          ],
          linhas: [
            ["Principal (valor nominal)", m.saldoDb.principal, m.saldoAb.principal],
            ["Atualização monetária do principal", m.saldoDb.am, m.saldoAb.am],
            ["Juros a pagar", m.saldoDb.juros, m.saldoAb.juros],
            ["(−) Custos de transação a apropriar", m.saldoDb.custos, m.saldoAb.custos],
          ],
          total: ["Saldo contábil", m.saldoDb.total, m.saldoAb.total],
          notas: [NOTA_ARREDONDAMENTO],
        },
        {
          nome: "Movimentação",
          titulo: "C06 – Movimentação de empréstimos, financiamentos e debêntures",
          subtitulo: `${fmtDate(ab)} → ${fmtDate(db)} · R$ mil`,
          colunas: [
            { titulo: "Movimentação", largura: 44 },
            { titulo: "Controladora", tipo: "inteiro", largura: 16 },
            { titulo: "Consolidado", tipo: "inteiro", largura: 16 },
          ],
          linhas: linhasMov.map((l) => [l.rotulo, m.movCtrl[l.campo], m.movCons[l.campo]]),
          notas: [
            `Encargos capitalizados no imobilizado em andamento (CPC 20): Controladora ${rsK(m.movCtrl.capitalizados)} · Consolidado ${rsK(m.movCons.capitalizados)}.`,
            NOTA_ARREDONDAMENTO,
          ],
        },
        {
          nome: "Mov. por modalidade",
          titulo: "C06 – Movimentação por modalidade (consolidado)",
          subtitulo: `${fmtDate(ab)} → ${fmtDate(db)} · R$ mil`,
          colunas: [
            { titulo: "Movimentação", largura: 44 },
            ...d.movGrupos.map((m) => ({ titulo: m.grupo, tipo: "inteiro" as const, largura: 14 })),
            { titulo: "Total", tipo: "inteiro", largura: 14 },
          ],
          linhas: linhasMov.map((l) => [l.rotulo, ...m.movGrupos.map((g) => g[l.campo]), m.movCons[l.campo]]),
          notas: [NOTA_ARREDONDAMENTO],
        },
        {
          nome: "Vencimentos NC",
          titulo: "C06 – Cronograma de vencimentos do não circulante (principal)",
          subtitulo: `Consolidado · R$ mil · parcelas após ${fmtDate(d.limite)}`,
          colunas: [{ titulo: "Ano de vencimento", largura: 30 }, ...tituloGrupos, { titulo: "Total", tipo: "inteiro", largura: 14 }],
          linhas: [
            ...d.vencimentos.map((v, i) => [v.rotulo, ...m.venc.linhas[i], m.venc.totais[i]]),
            ["Principal no não circulante", ...m.venc.principalNC, soma(m.venc.principalNC, (v) => v)],
            ["(−) Custos de transação a apropriar", ...m.venc.custosNC.map((v) => -v), -m.custosNC],
          ],
          total: ["Passivo não circulante", ...m.venc.nc, m.compDb.total.nc],
          notas: [
            "Principal pelo valor contábil da data-base (inclui a atualização monetária de IPCA e TLP e o excedente da TJLP capitalizado até a data-base).",
            NOTA_ARREDONDAMENTO,
          ],
        },
        {
          nome: "Características",
          titulo: "C06 – Características das debêntures, CRA, CRI e financiamentos BNDES",
          subtitulo: "Contratos em aberto na data-base · R$ mil",
          colunas: [
            { titulo: "Modalidade", largura: 14 },
            { titulo: "Contrato", largura: 10 },
            { titulo: "Instrumento", largura: 52 },
            { titulo: "Empresa", largura: 22 },
            { titulo: "Forma (BNDES) / agente", largura: 40 },
            { titulo: "Captação", tipo: "data", largura: 12 },
            { titulo: "Vencimento", tipo: "data", largura: 12 },
            { titulo: "Remuneração", largura: 30 },
            { titulo: "Valor captado", tipo: "inteiro", largura: 14 },
            { titulo: `Saldo ${fmtDate(db)}`, tipo: "inteiro", largura: 14 },
            { titulo: "Amortização", largura: 40 },
            { titulo: "Juros", largura: 36 },
            { titulo: "Garantias", largura: 60 },
            { titulo: "Finalidade", largura: 50 },
            { titulo: "Lastro", largura: 50 },
          ],
          linhas: posicoes
            .filter((x) => GRUPOS_CARACTERISTICAS.includes(grupoDe(x.c)))
            .map((x) => [
              grupoDe(x.c),
              x.c.id,
              x.c.instrumento,
              EMPRESAS[x.c.empresa]?.nome ?? x.c.empresa,
              x.c.formaBNDES ? `${x.c.formaBNDES}${x.c.agente ? ` – ${x.c.agente}` : ""}` : (x.c.agente ?? ""),
              x.c.dataCaptacao,
              x.c.vencimento,
              taxaContratadaDivida(x.c),
              Math.round(mil(x.c.valorCaptado)),
              m.compDb.contratos.get(x.c.id)?.total ?? 0,
              x.c.descricaoAmortizacao,
              x.c.descricaoJuros,
              x.c.garantias,
              x.c.finalidade,
              x.c.lastro ?? "",
            ]),
        },
        {
          nome: "Custos de transação",
          titulo: "C06 – Custos de transação a apropriar (CPC 48 – custo amortizado)",
          subtitulo: "Consolidado · R$ mil",
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Instrumento", largura: 52 },
            { titulo: "Custo original", tipo: "inteiro", largura: 14 },
            { titulo: "Apropriado acumulado", tipo: "inteiro", largura: 16 },
            { titulo: "A apropriar – circulante", tipo: "inteiro", largura: 18 },
            { titulo: "A apropriar – não circulante", tipo: "inteiro", largura: 20 },
            { titulo: "Total a apropriar", tipo: "inteiro", largura: 16 },
            { titulo: "CET (% a.a.)", tipo: "decimal", largura: 12 },
          ],
          linhas: d.custos.map((l) => {
            const c = m.custosPorContrato.get(l.x.c.id)!;
            return [l.x.c.id, l.x.c.instrumento, c.original, c.apropriado, c.circ, c.nc, c.aApropriar, l.x.cet * 100];
          }),
          total: ["Total", "", m.custosTotal.original, m.custosTotal.apropriado, m.custosTotal.circ, m.custosTotal.nc, m.custosTotal.aApropriar, ""],
          notas: [
            `Saldo a apropriar em ${fmtDate(ab)}: ${rsK(m.custosAb)} · (+) incorridos em novas captações: ${rsK(m.custosInc)} · (−) apropriados ao resultado: ${rsK(m.custosApr)} · saldo em ${fmtDate(db)}: ${rsK(m.custosDb)}.`,
            NOTA_ARREDONDAMENTO,
            "CET = TIR dos fluxos do contrato (captação líquida dos custos × pagamentos realizados e projetados com o último dado disponível importado do SAP).",
          ],
        },
        {
          nome: "Covenants",
          titulo: "C06 – Cláusulas restritivas (covenants) na data-base",
          colunas: [
            { titulo: "Indicador", largura: 36 },
            { titulo: "Fórmula", largura: 60 },
            { titulo: "Limite", largura: 10 },
            { titulo: "Apurado", tipo: "decimal", largura: 10 },
            { titulo: "Data de apuração", tipo: "data", largura: 14 },
            { titulo: "Folga", largura: 12 },
            { titulo: "Situação", largura: 20 },
            { titulo: "Contratos", largura: 24 },
            { titulo: "Waiver", largura: 30 },
          ],
          linhas: apuracoes.map((a) => [
            a.cov.indicador,
            a.cov.formula,
            `${a.cov.tipo === "max" ? "≤" : "≥"} ${fmtLimite(a)}`,
            a.dataApuracao ? (a.cov.formato === "pct" ? a.valor * 100 : a.valor) : null,
            a.dataApuracao,
            fmtFolga(a),
            situacaoCovenant(a).texto,
            contratosCov(a).join(", "),
            a.waiver ? `${a.waiver.credor} em ${fmtDate(a.waiver.obtidoEm)}${a.waiverVigente ? "" : " (após a data-base)"}` : "",
          ]),
          notas: [...d.narrativa.paragrafos, d.narrativa.conclusao],
        },
        {
          nome: "Texto da nota",
          titulo: "Minuta do texto da nota explicativa",
          colunas: [{ titulo: "Texto", largura: 140 }],
          linhas: textoNota.split("\n").map((l) => [l]),
        },
      ],
      db,
    );
  };

  const toggleGrupo = (g: Grupo) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  const copiar = () => {
    const selecionarTexto = () => {
      const el = document.getElementById("texto-nota");
      const sel = window.getSelection();
      if (!el || !sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      toast.info("Texto selecionado – use Ctrl+C para copiar");
    };
    try {
      navigator.clipboard.writeText(textoNota).then(() => toast.success("Texto copiado"), selecionarTexto);
    } catch {
      selecionarTexto();
    }
  };

  // -------------------------------------------------------------------------
  // Colunas das tabelas
  // -------------------------------------------------------------------------

  /** Saldo do contrato em R$ mil, igual ao da composição (os contratos somam a modalidade) */
  const saldoMil = (x: PosicaoDivida) => m.compDb.contratos.get(x.c.id)?.total ?? 0;
  const custoMil = (l: LinhaCusto) => m.custosPorContrato.get(l.x.c.id)!;

  const colCaracteristicas = (bndes: boolean): Column<PosicaoDivida>[] => [
    {
      key: "inst",
      header: bndes ? "Contrato / forma" : "Emissão / contrato",
      minWidth: 250,
      value: (x) => x.c.id,
      render: (x) => (
        <div className="py-0.5 max-w-[320px]">
          <div className="font-semibold text-text leading-snug">{x.c.instrumento}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-label">
            <Tag>{x.c.id}</Tag>
            {x.c.formaBNDES && <Tag color={x.c.formaBNDES === "Direto" ? "#009994" : "#a462a6"}>{x.c.formaBNDES}</Tag>}
            <span>{EMPRESAS[x.c.empresa]?.nome ?? x.c.empresa}</span>
          </div>
          {bndes ? (
            <div className="text-xs text-label mt-0.5">
              {x.c.agente ? `Agente financeiro: ${x.c.agente.replace(" (agente financeiro)", "")}` : "Contratação direta com o BNDES"}
              {x.c.linhaCredito && ` · linha ${x.c.linhaCredito}`}
            </div>
          ) : (
            x.c.agente && <div className="text-xs text-label mt-0.5">{x.c.agente}</div>
          )}
        </div>
      ),
      total: () => "Total",
    },
    {
      key: "prazo",
      header: "Captação → vencimento",
      minWidth: 180,
      value: (x) => x.c.vencimento,
      render: (x) => (
        <div className="max-w-[230px]">
          <div className="tabular whitespace-nowrap">
            {fmtDate(x.c.dataCaptacao)} → {fmtDate(x.c.vencimento)}
          </div>
          <div className="text-xs text-label leading-snug mt-0.5">{x.c.descricaoAmortizacao}</div>
        </div>
      ),
    },
    {
      key: "rem",
      header: "Remuneração",
      minWidth: 180,
      value: (x) => x.taxaEfetivaAA,
      render: (x) => (
        <div className="max-w-[230px]">
          <div className="font-semibold text-text whitespace-nowrap">{taxaContratadaDivida(x.c)}</div>
          <div className="text-xs text-label leading-snug mt-0.5">Juros {minuscula(x.c.descricaoJuros)}</div>
        </div>
      ),
    },
    {
      key: "valor",
      header: "Valor captado",
      headerTitle: "Valor captado (R$ mil)",
      align: "right",
      minWidth: 110,
      value: (x) => x.c.valorCaptado,
      render: (x) => fmtK(Math.round(mil(x.c.valorCaptado))),
      total: (rows) => fmtK(soma(rows, (x) => Math.round(mil(x.c.valorCaptado)))),
    },
    {
      key: "saldo",
      header: `Saldo ${fmtDate(db)}`,
      headerTitle: "Saldo pelo custo amortizado (R$ mil)",
      align: "right",
      minWidth: 120,
      value: (x) => x.saldoContabil,
      render: (x) => <span className="font-semibold">{fmtK(saldoMil(x))}</span>,
      total: (rows) => fmtK(soma(rows, saldoMil)),
    },
    {
      key: "gar",
      header: "Garantias",
      minWidth: 220,
      render: (x) => <div className="text-[13px] leading-snug max-w-[300px]">{x.c.garantias}</div>,
    },
    {
      key: "fin",
      header: bndes ? "Finalidade" : "Finalidade / lastro",
      minWidth: 220,
      render: (x) => (
        <div className="max-w-[300px]">
          <div className="text-[13px] leading-snug">{x.c.finalidade}</div>
          {x.c.lastro && <div className="text-xs text-label leading-snug mt-0.5">Lastro: {x.c.lastro}</div>}
        </div>
      ),
    },
  ];

  const colCustos: Column<LinhaCusto>[] = [
    {
      key: "contrato",
      header: "Contrato",
      minWidth: 210,
      value: (l) => l.x.c.id,
      render: (l) => (
        <div className="py-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-text">{l.x.c.id}</span>
            <span className="text-xs text-label">· {grupoDe(l.x.c)}</span>
          </div>
          <div className="text-xs text-label tabular whitespace-nowrap mt-0.5">
            {fmtDate(l.x.c.dataCaptacao)} → {fmtDate(l.x.c.vencimento)}
          </div>
        </div>
      ),
      total: () => "Total",
    },
    {
      key: "original",
      header: "Custo original",
      align: "right",
      minWidth: 110,
      value: (l) => l.original,
      render: (l) => fmtK(custoMil(l).original),
      total: () => fmtK(m.custosTotal.original),
    },
    {
      key: "apropriado",
      header: "Apropriado acumulado",
      align: "right",
      minWidth: 140,
      value: (l) => l.apropriado,
      render: (l) => fmtK(custoMil(l).apropriado),
      total: () => fmtK(m.custosTotal.apropriado),
    },
    {
      key: "circ",
      header: "Circulante",
      headerTitle: "Custos a apropriar nos próximos 12 meses (redutora do passivo circulante)",
      align: "right",
      minWidth: 100,
      value: (l) => l.circ,
      render: (l) => fmtK(custoMil(l).circ),
      total: () => fmtK(m.custosTotal.circ),
    },
    {
      key: "nc",
      header: "Não circulante",
      headerTitle: "Custos a apropriar após 12 meses (redutora do passivo não circulante)",
      align: "right",
      minWidth: 120,
      value: (l) => l.nc,
      render: (l) => fmtK(custoMil(l).nc),
      total: () => fmtK(m.custosTotal.nc),
    },
    {
      key: "total",
      header: "Total a apropriar",
      align: "right",
      minWidth: 120,
      value: (l) => l.aApropriar,
      render: (l) => <span className="font-semibold">{fmtK(custoMil(l).aApropriar)}</span>,
      total: () => fmtK(m.custosTotal.aApropriar),
    },
    {
      key: "pct",
      header: "Apropriação",
      headerTitle: "Parcela do custo original já apropriada ao resultado",
      minWidth: 140,
      value: (l) => (l.original > 0 ? l.apropriado / l.original : 0),
      render: (l) => {
        const pct = l.original > 0 ? l.apropriado / l.original : 0;
        return (
          <div className="flex items-center gap-2">
            <MicroBar className="w-16 shrink-0" value={pct} color={CHART_SEMANTIC.neutral} />
            <span className="tabular text-[13px] text-label whitespace-nowrap">{fmtPct(pct, 0)}</span>
          </div>
        );
      },
    },
    {
      key: "cet",
      header: "CET a.a.",
      headerTitle: "Custo efetivo total: TIR dos fluxos (captação líquida dos custos × pagamentos realizados e projetados)",
      align: "right",
      minWidth: 100,
      value: (l) => l.x.cet,
      render: (l) => fmtPct(l.x.cet),
    },
  ];

  const colCovenants: Column<ApuracaoCovenant>[] = [
    {
      key: "ind",
      header: "Indicador",
      minWidth: 280,
      value: (a) => a.cov.indicador,
      render: (a) => (
        <div className="py-0.5 max-w-[380px]">
          <div className="font-semibold text-text">{a.cov.indicador}</div>
          <div className="text-xs text-label leading-snug mt-0.5">{a.cov.formula}</div>
        </div>
      ),
    },
    {
      key: "lim",
      header: "Limite",
      align: "right",
      minWidth: 90,
      value: (a) => a.cov.limite,
      render: (a) => `${a.cov.tipo === "max" ? "≤" : "≥"} ${fmtLimite(a)}`,
    },
    {
      key: "val",
      header: "Apurado",
      align: "right",
      minWidth: 100,
      value: (a) => a.valor,
      render: (a) => (
        <div>
          <div className="font-bold">{a.dataApuracao ? fmtCov(a, a.valor) : "—"}</div>
          <div className="text-xs text-label font-normal">{fmtDate(a.dataApuracao)}</div>
        </div>
      ),
    },
    {
      key: "folga",
      header: "Folga",
      align: "right",
      minWidth: 90,
      value: (a) => a.folga,
      render: (a) => <span className={a.folga >= 0 ? "text-positive" : "text-negative"}>{fmtFolga(a)}</span>,
    },
    {
      key: "sit",
      header: "Situação",
      minWidth: 170,
      value: (a) => a.status,
      render: (a) => {
        const s = situacaoCovenant(a);
        return <ObjectStatus state={s.state}>{s.texto}</ObjectStatus>;
      },
    },
    {
      key: "contratos",
      header: "Contratos",
      minWidth: 170,
      render: (a) => (
        <div className="flex flex-wrap gap-1 max-w-[220px]">
          {contratosCov(a).map((c) => (
            <Tag key={c}>{c}</Tag>
          ))}
        </div>
      ),
    },
    {
      key: "waiver",
      header: "Waiver",
      minWidth: 170,
      render: (a) =>
        a.waiver ? (
          <div>
            <div className="text-text">
              {a.waiver.credor} em {fmtDate(a.waiver.obtidoEm)}
            </div>
            <div className="text-xs text-label">{a.waiverVigente ? "Vigente na data-base" : "Obtido após a data-base"}</div>
          </div>
        ) : (
          <span className="text-label">—</span>
        ),
    },
  ];

  // -------------------------------------------------------------------------
  // Gráficos
  // -------------------------------------------------------------------------

  const graficoComp = d.composicao.map((l) => ({ grupo: l.grupo, abertura: l.totalA / 1e6, dataBase: l.total / 1e6 }));
  const graficoCustos = d.custos.map((l) => ({ id: l.x.c.id, apropriado: l.apropriado / 1000, circ: l.circ / 1000, nc: l.nc / 1000 }));

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Dívida bruta" value={fmtCompact(d.total)} sub={`${fmtDate(ab)}: ${fmtCompact(d.totalA)}`} />
          <HeaderKpi
            label="Circulante"
            value={fmtCompact(d.circ)}
            state={reclassDb.length ? "negative" : "neutral"}
            sub={reclassDb.length ? `inclui ${listaPt(reclassDb)} (CPC 26)` : `${fmtPct(d.total > 0 ? d.circ / d.total : 0, 1)} do total`}
          />
          <HeaderKpi label="Não circulante" value={fmtCompact(d.nc)} sub={`prazo médio ${fmtDec(d.prazoMedio, 1)} anos`} />
          <HeaderKpi label="Custo médio ponderado" value={fmtPct(d.custoMedio)} sub="a.a. · juros + correção monetária" />
        </>
      }
      headerExtra={
        <div className="border-b border-line-soft -mb-5">
          <TabBar
            value={aba}
            onChange={setAba}
            items={[
              { value: "comp", label: "Composição" },
              { value: "mov", label: "Movimentação" },
              { value: "venc", label: "Vencimentos do não circulante" },
              { value: "carac", label: "Características", count: totalCaracteristicas },
              { value: "custos", label: "Custos de transação" },
              { value: "cov", label: "Covenants" },
              { value: "nota", label: "Texto da nota" },
            ]}
          />
        </div>
      }
    >
      {/* ------------------------------------------------------------------ Composição */}
      {aba === "comp" && (
        <>
          {reclassDb.length > 0 && (
            <MessageStrip design="negative">
              <strong>Reclassificação para o circulante.</strong> {notaReclass(reclassDb, db, true)}
            </MessageStrip>
          )}
          <Card
            title="Empréstimos, financiamentos e debêntures – composição por modalidade"
            subtitle={`Consolidado · R$ mil · ${fmtDate(db)} comparado a ${fmtDate(ab)} · clique na modalidade para ver os contratos`}
          >
            <ComposicaoCelular
              linhas={d.composicao}
              compDb={m.compDb}
              compAb={m.compAb}
              db={db}
              ab={ab}
              custoMedio={d.custoMedio}
              abertos={abertos}
              onToggle={toggleGrupo}
            />
            <div className="hidden sm:block overflow-x-auto fiori-scroll -mx-4 px-4">
              <table className="w-full text-sm border-separate border-spacing-0 min-w-[1080px]">
                <thead>
                  <tr className="text-[13px]">
                    <th className="sticky left-0 z-[2] bg-surface-2" />
                    <th className="hidden sm:table-cell" />
                    <th />
                    <th colSpan={3} className="text-center py-1.5 pl-4 border-b border-line-soft whitespace-nowrap">
                      {fmtDate(db)}
                    </th>
                    <th colSpan={3} className="text-center py-1.5 pl-6 border-b border-line-soft whitespace-nowrap">
                      {fmtDate(ab)}
                    </th>
                  </tr>
                  <tr className="text-[13px]">
                    <th className="sticky left-0 z-[2] bg-surface-2 text-left py-2 pr-3 border-b-2 border-brand min-w-[170px] sm:min-w-[250px]">Modalidade</th>
                    <th className="hidden sm:table-cell text-left py-2 pr-3 border-b-2 border-brand min-w-[210px]">Encargos contratuais (média ponderada)</th>
                    <th className="text-right py-2 pl-3 border-b-2 border-brand whitespace-nowrap">Taxa efetiva a.a.</th>
                    <th className="text-right py-2 pl-4 border-b-2 border-brand whitespace-nowrap">Circulante</th>
                    <th className="text-right py-2 pl-4 border-b-2 border-brand whitespace-nowrap">Não circulante</th>
                    <th className="text-right py-2 pl-4 border-b-2 border-brand whitespace-nowrap">Total</th>
                    <th className="text-right py-2 pl-6 border-b-2 border-brand whitespace-nowrap">Circulante</th>
                    <th className="text-right py-2 pl-4 border-b-2 border-brand whitespace-nowrap">Não circulante</th>
                    <th className="text-right py-2 pl-4 pr-2 border-b-2 border-brand whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.composicao.map((l, gi) => {
                    const aberto = abertos.has(l.grupo);
                    const gDb = m.compDb.grupos[gi];
                    const gAb = m.compAb.grupos[gi];
                    const ids = idsDoGrupo(l);
                    return (
                      <Fragment key={l.grupo}>
                        <tr className="group cursor-pointer hover:bg-hover" onClick={() => toggleGrupo(l.grupo)}>
                          <td className="sticky left-0 z-[1] bg-surface group-hover:bg-hover py-2.5 pr-3 border-b border-line-soft">
                            <button
                              type="button"
                              className="inline-flex items-start gap-1.5 text-left font-semibold text-text"
                              aria-expanded={aberto}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleGrupo(l.grupo);
                              }}
                            >
                              <ChevronRight className={clsx("w-4 h-4 mt-0.5 shrink-0 text-label transition-transform", aberto && "rotate-90")} />
                              <span className="inline-flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COR_GRUPO[l.grupo] }} />
                                {l.grupo}
                                <span className="text-label font-normal">({ids.length})</span>
                              </span>
                            </button>
                            <div className="sm:hidden text-xs text-label leading-snug mt-0.5 pl-[2.375rem]">{l.encargos}</div>
                          </td>
                          <td className="hidden sm:table-cell py-2.5 pr-3 border-b border-line-soft text-label text-[13px] leading-snug">{l.encargos}</td>
                          <td className="py-2.5 pl-3 border-b border-line-soft text-right tabular whitespace-nowrap">{l.pos.length ? fmtPct(l.taxa) : "–"}</td>
                          <Num v={gDb.circ} />
                          <Num v={gDb.nc} />
                          <Num v={gDb.total} forte />
                          <Num v={gAb.circ} largo />
                          <Num v={gAb.nc} />
                          <Num v={gAb.total} forte ultimo />
                        </tr>
                        {aberto &&
                          ids.map((id) => {
                            const x = l.pos.find((y) => y.c.id === id);
                            const xa = l.posA.find((y) => y.c.id === id);
                            const c = (x ?? xa)!.c;
                            const cDb = x ? m.compDb.contratos.get(id) : undefined;
                            const cAb = xa ? m.compAb.contratos.get(id) : undefined;
                            return (
                              <tr key={id} className="text-[13px] bg-surface-3">
                                <td className="sticky left-0 z-[1] bg-surface-3 py-2 pl-7 pr-3 border-b border-line-soft">
                                  <div className="font-semibold text-text">
                                    {c.id}
                                    {x?.reclassificado && <span className="ml-1.5 text-negative font-normal">(reclassificado)</span>}
                                    {!x?.reclassificado && xa?.reclassificado && <span className="ml-1.5 text-label font-normal">(reclassificado em {fmtDate(ab)})</span>}
                                  </div>
                                  <div className="text-xs text-label leading-snug max-w-[160px] sm:max-w-[280px]">{c.instrumento}</div>
                                  <div className="sm:hidden text-xs text-label mt-0.5">{taxaContratadaDivida(c)}</div>
                                </td>
                                <td className="hidden sm:table-cell py-2 pr-3 border-b border-line-soft text-label">
                                  {taxaContratadaDivida(c)}
                                  {!x && <div className="text-xs">Liquidado em {fmtDate(c.vencimento)}</div>}
                                  {x && !xa && <div className="text-xs">Captado em {fmtDate(c.dataCaptacao)}</div>}
                                </td>
                                <td className="py-2 pl-3 border-b border-line-soft text-right tabular text-label">{x ? fmtPct(x.taxaEfetivaAA) : "–"}</td>
                                <Num v={cDb?.circ ?? 0} leve />
                                <Num v={cDb?.nc ?? 0} leve />
                                <Num v={cDb?.total ?? 0} leve />
                                <Num v={cAb?.circ ?? 0} leve largo />
                                <Num v={cAb?.nc ?? 0} leve />
                                <Num v={cAb?.total ?? 0} leve ultimo />
                              </tr>
                            );
                          })}
                      </Fragment>
                    );
                  })}
                  <tr className="font-bold">
                    <td className="sticky left-0 z-[1] bg-surface-3 py-2.5 pl-2 pr-3 border-y border-line">Total</td>
                    <td className="hidden sm:table-cell bg-surface-3 py-2.5 border-y border-line" />
                    <td className="bg-surface-3 py-2.5 pl-3 border-y border-line text-right tabular whitespace-nowrap">{fmtPct(d.custoMedio)}</td>
                    <Num v={m.compDb.total.circ} total />
                    <Num v={m.compDb.total.nc} total />
                    <Num v={m.compDb.total.total} total />
                    <Num v={m.compAb.total.circ} total largo />
                    <Num v={m.compAb.total.nc} total />
                    <Num v={m.compAb.total.total} total ultimo />
                  </tr>
                </tbody>
              </table>
            </div>
            <ul className="text-xs text-label mt-4 space-y-1 leading-relaxed">
              <li>(i) Saldos pelo custo amortizado: principal atualizado + juros a pagar − custos de transação a apropriar (CPC 48).</li>
              <li>
                (ii) Circulante: parcelas de principal com vencimento em até 12 meses e juros a pagar, líquidos dos custos de transação a
                apropriar no período.
              </li>
              <li>
                (iii) Taxa efetiva a.a.: juros + correção monetária do principal com as taxas vigentes na data-base; contratos pós-fixados
                projetados com o último dado disponível importado do SAP ({fmtDate(ultimoDado)}).
              </li>
              {reclassAb.length > 0 && <li>(iv) {notaReclass(reclassAb, ab, false)}</li>}
              <li>
                ({reclassAb.length > 0 ? "v" : "iv"}) Valores em R$ mil arredondados de modo que linhas e colunas fechem (diferença
                de arredondamento alocada à parcela com maior resto).
              </li>
            </ul>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
            <Card className="xl:col-span-2" title="Composição do saldo contábil" subtitle="Consolidado · R$ mil · custo amortizado">
              <NotaTabela
                cabecalho={[fmtDate(db), fmtDate(ab)]}
                minWidth={320}
                linhas={[
                  { rotulo: "Principal (valor nominal)", valores: [m.saldoDb.principal, m.saldoAb.principal] },
                  { rotulo: "Atualização monetária do principal", valores: [m.saldoDb.am, m.saldoAb.am] },
                  { rotulo: "Juros a pagar", valores: [m.saldoDb.juros, m.saldoAb.juros] },
                  { rotulo: "(−) Custos de transação a apropriar", valores: [m.saldoDb.custos, m.saldoAb.custos] },
                  { rotulo: "Saldo contábil", valores: [m.saldoDb.total, m.saldoAb.total], forte: true },
                  { rotulo: "Circulante", valores: [m.compDb.total.circ, m.compAb.total.circ], recuo: true },
                  { rotulo: "Não circulante", valores: [m.compDb.total.nc, m.compAb.total.nc], recuo: true },
                ]}
              />
            </Card>
            <Card
              className="xl:col-span-3 flex flex-col"
              bodyClassName="flex-1 flex flex-col"
              title="Saldo por modalidade"
              subtitle={`R$ milhões · ${fmtDate(ab)} × ${fmtDate(db)}`}
            >
              <div className="h-64 xl:h-auto xl:flex-1 xl:min-h-[256px] -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={graficoComp} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
                    <CartesianGrid vertical={false} stroke="#3f3f3d" />
                    <XAxis dataKey="grupo" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#575653" }} interval={0} />
                    <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => fmtDec(v, 0)} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`R$\u00a0${fmtDec(v, 1)}\u00a0mi`, n]} cursor={{ fill: "#2f2e2e" }} />
                    <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} formatter={textoLegenda} />
                    <Bar dataKey="abertura" name={fmtDate(ab)} fill={CHART_SEMANTIC.neutral} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                    <Bar dataKey="dataBase" name={fmtDate(db)} fill={CHART_COLORS[6]} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}

      {/* ------------------------------------------------------------------ Movimentação */}
      {aba === "mov" && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
            <Card
              className="xl:col-span-3"
              title="Movimentação de empréstimos, financiamentos e debêntures"
              subtitle={`R$ mil · ${fmtDate(ab)} → ${fmtDate(db)}`}
              status={
                Math.abs(d.difRoll) < 1 ? (
                  <ObjectStatus state="positive" inverted>
                    Conciliado
                  </ObjectStatus>
                ) : (
                  <ObjectStatus state="negative" inverted>
                    Diferença {rsMil(d.difRoll)}
                  </ObjectStatus>
                )
              }
            >
              <NotaTabela
                cabecalho={["Controladora", "Consolidado"]}
                linhas={linhasMov.map((l) => ({ rotulo: l.rotulo, valores: [m.movCtrl[l.campo], m.movCons[l.campo]], forte: l.forte }))}
              />
              <p className="text-[13px] text-text mt-4 leading-relaxed">
                <strong>Encargos do período:</strong> {rsK(encargosMil)} no consolidado (juros, atualização monetária e apropriação
                dos custos de transação)
                {m.movCons.capitalizados > 0 ? (
                  <>
                    , dos quais {rsK(m.movCons.capitalizados)} capitalizados no imobilizado em andamento (CPC 20) e{" "}
                    {rsK(encargosMil - m.movCons.capitalizados)} reconhecidos como despesa financeira.
                  </>
                ) : (
                  ", integralmente reconhecidos como despesa financeira."
                )}
              </p>
            </Card>

            <Card className="xl:col-span-2" title="Captações, liquidações e capitalização" subtitle={`Consolidado · R$ mil · ${fmtDate(ab)} → ${fmtDate(db)}`}>
              <ListaEventos
                titulo="Novas captações"
                vazio="Nenhuma captação no período."
                itens={d.novas.map((l) => ({
                  chave: l.c.id,
                  titulo: l.c.id,
                  detalhe: `${l.c.instrumento} · ${fmtDate(l.c.dataCaptacao)}`,
                  valor: Math.round(mil(l.captacoes)),
                }))}
              />
              <div className="h-4" />
              <ListaEventos
                titulo="Contratos liquidados"
                vazio="Nenhum contrato liquidado no período."
                itens={d.liquidados.map((l) => ({
                  chave: l.c.id,
                  titulo: l.c.id,
                  detalhe: `${l.c.instrumento} · ${fmtDate(l.c.vencimento)}`,
                  valor: Math.round(mil(-(l.pagamentoPrincipal + l.pagamentoJuros))),
                }))}
              />
              <div className="h-4" />
              <ListaEventos
                titulo="Encargos capitalizados (CPC 20)"
                vazio="Sem capitalização de encargos no período."
                itens={d.capitalizados
                  .map((l: MovContrato) => ({
                    chave: l.c.id,
                    titulo: l.c.id,
                    detalhe: l.c.capitalizacaoCPC20 ? `${l.c.capitalizacaoCPC20.ativo} · até ${fmtDate(l.c.capitalizacaoCPC20.ate)}` : l.c.instrumento,
                    valor: m.capitalizados.get(l.c.id) ?? 0,
                  }))
                  .filter((x) => x.valor !== 0)}
              />
              <div className="mt-5 pt-4 border-t border-line-soft">
                <div className="text-[13px] font-bold text-text mb-1.5">Efeito no caixa do período (DFC)</div>
                <dl className="text-[13px] divide-y divide-line-soft">
                  <LinhaCaixa rotulo="Captações líquidas dos custos de transação" v={m.movCons.captacoes + m.movCons.custosTransacao} />
                  <LinhaCaixa rotulo="Amortização de principal" v={m.movCons.pagamentoPrincipal} />
                  <LinhaCaixa rotulo="Pagamento de juros" v={m.movCons.pagamentoJuros} />
                  <LinhaCaixa
                    rotulo="Efeito líquido"
                    v={m.movCons.captacoes + m.movCons.custosTransacao + m.movCons.pagamentoPrincipal + m.movCons.pagamentoJuros}
                    forte
                  />
                </dl>
              </div>
              <p className="text-xs text-label mt-3 leading-relaxed">
                Liquidações: principal + juros pagos no período. Na DFC, os juros pagos seguem a política de classificação da Companhia
                (CPC 03, itens 31 a 34).
              </p>
            </Card>
          </div>

          <Card title="Movimentação por modalidade" subtitle={`Consolidado · R$ mil · ${fmtDate(ab)} → ${fmtDate(db)}`}>
            <NotaTabela
              cabecalho={[...d.movGrupos.map((g) => g.grupo), "Total"]}
              minWidth={900}
              totalPrimeiro
              linhas={linhasMov.map((l) => ({
                rotulo: l.rotulo,
                valores: [...m.movGrupos.map((g) => g[l.campo]), m.movCons[l.campo]],
                forte: l.forte,
              }))}
            />
          </Card>
        </>
      )}

      {/* ------------------------------------------------------------------ Vencimentos */}
      {aba === "venc" && (
        <>
          {d.bndesReclass.length > 0 && (
            <MessageStrip design="negative">
              Os contratos {listaPt(d.bndesReclass.map((x) => x.c.id))} estão integralmente no circulante (CPC 26, item 74) e, por isso,
              não constam do cronograma do não circulante: principal de {rsMil(soma(d.bndesReclass, (x) => x.principalAtualizado))}{" "}
              apresentado no passivo circulante em {fmtDate(db)}, dos quais {rsK(m.principalReclassLP)} de parcelas de longo prazo
              reclassificadas.
            </MessageStrip>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
            <Card
              className="xl:col-span-3"
              title="Cronograma de vencimentos do não circulante"
              subtitle={`Principal por ano de vencimento · R$ mil · parcelas a partir de ${fmtDate(primeiroMesNC)}`}
            >
              <NotaTabela
                primeira="Ano de vencimento"
                cabecalho={[...d.gruposVenc, "Total"]}
                minWidth={760}
                totalPrimeiro
                linhas={[
                  ...d.vencimentos.map((v, i) => ({ rotulo: v.rotulo, valores: [...m.venc.linhas[i], m.venc.totais[i]] })),
                  { rotulo: "Principal no não circulante", valores: [...m.venc.principalNC, soma(m.venc.principalNC, (v) => v)], forte: true },
                  { rotulo: "(−) Custos de transação a apropriar", valores: [...m.venc.custosNC.map((v) => -v), -m.custosNC] },
                  { rotulo: "Passivo não circulante", valores: [...m.venc.nc, m.compDb.total.nc], forte: true },
                ]}
              />
              <ul className="text-xs text-label mt-4 space-y-1 leading-relaxed">
                <li>
                  (i){" "}
                  {db.endsWith("-12-31") ? (
                    <>Principal no circulante em {fmtDate(db)}: </>
                  ) : (
                    <>
                      {d.ano0}: parcelas de {fmtDate(primeiroMesNC)} a 31/12/{d.ano0}. Principal no circulante em {fmtDate(db)}:{" "}
                    </>
                  )}
                  {rsK(m.principalCP12)} de parcelas com vencimento em até 12 meses (até {fmtDate(d.limite)})
                  {m.principalReclassLP > 0 ? (
                    <>
                      {" "}
                      e {rsK(m.principalReclassLP)} de principal de longo prazo de {listaPt(reclassDb)} reclassificado para o
                      circulante ({rsK(m.reclassLiquido)} líquidos dos custos de transação de longo prazo) por descumprimento de
                      covenant sem waiver na data do balanço (CPC 26, item 74); total de {rsK(m.principalCP)}
                    </>
                  ) : null}
                  .
                </li>
                <li>
                  (ii) Principal pelo valor contábil da data-base, incluindo a atualização monetária de IPCA e TLP e o excedente da
                  TJLP sobre 6% a.a. capitalizado até {fmtDate(db)}.
                </li>
                <li>(iii) Custos de transação a apropriar após 12 meses, deduzidos do passivo não circulante (CPC 48).</li>
                <li>(iv) Valores arredondados de modo que linhas e colunas fechem com a composição (aba Composição).</li>
              </ul>
            </Card>

            <Card className="xl:col-span-2" title="Perfil de amortização do não circulante" subtitle="Principal por ano · R$ milhões">
              <div className="h-72 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.graficoVenc} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#3f3f3d" />
                    <XAxis dataKey="ano" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#575653" }} interval={0} />
                    <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={32} tickFormatter={(v: number) => fmtDec(v, 0)} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number, n: string) => [`R$\u00a0${fmtDec(v, 1)}\u00a0mi`, n]}
                      cursor={{ fill: "#2f2e2e" }}
                    />
                    <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} formatter={textoLegenda} />
                    {d.gruposVenc.map((g) => (
                      <Bar key={g} dataKey={g} stackId="nc" name={g} fill={COR_GRUPO[g]} maxBarSize={40} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {ultimaFaixa.total > 0 && (
                <p className="text-xs text-label mt-3 leading-relaxed">
                  {d.anoCorte} em diante: {rsK(m.venc.totais[m.venc.totais.length - 1])} (
                  {fmtPct(totalPrincipalNC > 0 ? ultimaFaixa.total / totalPrincipalNC : 0, 1)} do principal não circulante):{" "}
                  {listaPt(
                    d.gruposVenc
                      .map((g, i) => ({ g, v: m.venc.linhas[m.venc.linhas.length - 1][i] }))
                      .filter((x) => x.v > 0)
                      .sort((a, b) => b.v - a.v)
                      .map((x) => `${x.g} ${rsK(x.v)}`),
                  )}
                  .
                </p>
              )}
            </Card>
          </div>
        </>
      )}

      {/* ------------------------------------------------------------------ Características */}
      {aba === "carac" &&
        GRUPOS_CARACTERISTICAS.map((g) => {
          const pos = posicoes.filter((x) => grupoDe(x.c) === g);
          if (!pos.length) return null;
          return (
            <Card
              key={g}
              title={NOME_GRUPO[g]}
              subtitle={`${pos.length} ${pos.length === 1 ? "contrato" : "contratos"} em aberto em ${fmtDate(db)} · valores em R$ mil`}
              icon={<span className="block w-2.5 h-2.5 mt-1.5 rounded-full" style={{ backgroundColor: COR_GRUPO[g] }} />}
              bodyClassName="px-0 pb-0"
            >
              <div className="hidden lg:block">
                <DataTable columns={colCaracteristicas(g === "BNDES")} rows={pos} rowKey={(x) => x.c.id} showTotals={pos.length > 1} />
              </div>
              <CaracteristicasCelular pos={pos} bndes={g === "BNDES"} saldoMil={saldoMil} db={db} />
            </Card>
          );
        })}

      {/* ------------------------------------------------------------------ Custos de transação */}
      {aba === "custos" && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
            <Card className="xl:col-span-2" title="Movimentação dos custos a apropriar" subtitle={`Consolidado · R$ mil · ${fmtDate(ab)} → ${fmtDate(db)}`}>
              <NotaTabela
                cabecalho={["Consolidado"]}
                minWidth={320}
                linhas={[
                  { rotulo: `Saldo a apropriar em ${fmtDate(ab)}`, valores: [m.custosAb], forte: true },
                  { rotulo: "(+) Custos incorridos em novas captações", valores: [m.custosInc] },
                  { rotulo: "(−) Apropriação ao resultado", valores: [-m.custosApr] },
                  { rotulo: `Saldo a apropriar em ${fmtDate(db)}`, valores: [m.custosDb], forte: true },
                  { rotulo: "Circulante (próximos 12 meses)", valores: [m.custosCirc], recuo: true },
                  { rotulo: "Não circulante", valores: [m.custosNC], recuo: true },
                ]}
              />
              <p className="text-xs text-label mt-4 leading-relaxed">
                Os custos de transação (estruturação, comissões, assessoria legal, registro e agente fiduciário) são deduzidos do valor
                captado e apropriados ao resultado como encargo financeiro pelo prazo do contrato, compondo o custo amortizado e o custo
                efetivo total (CET) de cada captação (CPC 48).
              </p>
            </Card>
            <Card className="xl:col-span-3" title="Custos por contrato" subtitle="R$ mil · apropriado acumulado × a apropriar">
              <div className="-ml-2" style={{ height: Math.max(240, graficoCustos.length * 26 + 60) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={graficoCustos} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={5}>
                    <CartesianGrid horizontal={false} stroke="#3f3f3d" />
                    <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#575653" }} tickFormatter={(v: number) => fmtDec(v, 0)} />
                    <YAxis type="category" dataKey="id" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={60} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`R$\u00a0${fmtDec(v, 0)}\u00a0mil`, n]} cursor={{ fill: "#2f2e2e" }} />
                    <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} formatter={textoLegenda} />
                    <Bar dataKey="apropriado" stackId="c" name="Apropriado acumulado" fill="#575653" isAnimationActive={false} />
                    <Bar dataKey="circ" stackId="c" name="A apropriar – circulante" fill={CHART_COLORS[1]} isAnimationActive={false} />
                    <Bar dataKey="nc" stackId="c" name="A apropriar – não circulante" fill={CHART_COLORS[6]} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card
            title="Custos de transação por contrato"
            subtitle={`Custo amortizado (CPC 48) · R$ mil · posição em ${fmtDate(db)} · circulante e não circulante: saldo a apropriar`}
            bodyClassName="px-0 pb-0"
          >
            <div className="hidden lg:block">
              <DataTable columns={colCustos} rows={d.custos} rowKey={(l) => l.x.c.id} showTotals />
            </div>
            <CustosCelular custos={d.custos} valores={custoMil} total={m.custosTotal} />
            <p className="text-xs text-label px-4 py-3 leading-relaxed border-t border-line-soft">
              CET: taxa interna de retorno dos fluxos de cada contrato – captação líquida dos custos de transação × pagamentos de principal e
              juros realizados até a data-base e projetados com o último dado disponível importado do SAP ({fmtDate(ultimoDado)}).
            </p>
          </Card>
        </>
      )}

      {/* ------------------------------------------------------------------ Covenants */}
      {aba === "cov" && (
        <>
          <MessageStrip design={d.narrativa.design}>
            <strong>{d.narrativa.titulo}.</strong>{" "}
            {d.narrativa.paragrafos.length ? d.narrativa.paragrafos[0] : d.narrativa.conclusao}
          </MessageStrip>

          {d.narrativa.eventos.length > 0 && (
            <Card title="Descumprimento, waiver e classificação do passivo" subtitle="CPC 26, itens 74 a 76 · CPC 24 (eventos subsequentes)">
              <ol className={clsx("grid grid-cols-1 sm:grid-cols-2 gap-4", d.narrativa.eventos.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
                {d.narrativa.eventos.map((e, i) => (
                  <li key={i} className="relative pl-4 border-l-[3px] rounded-sm" style={{ borderColor: COR_ESTADO[e.state] }}>
                    <div className="text-xs text-label tabular">
                      {fmtDate(e.data)}
                      {e.subsequente && " · evento subsequente"}
                    </div>
                    <div className="text-sm font-bold text-text mt-0.5">{e.titulo}</div>
                    <div className="text-[13px] text-label leading-snug mt-0.5">{e.detalhe}</div>
                  </li>
                ))}
              </ol>
              <div className="mt-5 pt-4 border-t border-line-soft">
                <div className="space-y-2.5 text-[13px] text-text leading-relaxed max-w-4xl">
                  {d.narrativa.paragrafos.slice(1).map((par, i) => (
                    <p key={i}>{par}</p>
                  ))}
                  <p>{d.narrativa.conclusao}</p>
                </div>
              </div>
            </Card>
          )}

          <Card title="Cláusulas restritivas financeiras" subtitle={`Situação na data-base ${fmtDate(db)} · última apuração de cada índice`} bodyClassName="px-0 pb-0">
            <div className="hidden lg:block">
              <DataTable columns={colCovenants} rows={apuracoes} rowKey={(a) => a.cov.id} />
            </div>
            {/* Pop-in (sap.m.Table responsiva) em telas estreitas */}
            <ul className="lg:hidden border-t border-line divide-y divide-line-soft">
              {apuracoes.map((a) => {
                const sit = situacaoCovenant(a);
                return (
                  <li key={a.cov.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text">{a.cov.indicador}</div>
                        <div className="text-xs text-label leading-snug mt-0.5">{a.cov.formula}</div>
                      </div>
                      <ObjectStatus state={sit.state} className="shrink-0">
                        {sit.texto}
                      </ObjectStatus>
                    </div>
                    <dl className="grid grid-cols-3 gap-x-3 mt-2 text-[13px]">
                      <PopIn rotulo="Limite" valor={`${a.cov.tipo === "max" ? "≤" : "≥"} ${fmtLimite(a)}`} />
                      <PopIn
                        rotulo="Apurado"
                        valor={
                          <>
                            {a.dataApuracao ? fmtCov(a, a.valor) : "—"}
                            <span className="block text-xs text-label font-normal">{fmtDate(a.dataApuracao)}</span>
                          </>
                        }
                      />
                      <PopIn rotulo="Folga" valor={<span className={a.folga >= 0 ? "text-positive" : "text-negative"}>{fmtFolga(a)}</span>} />
                    </dl>
                    <div className="flex flex-wrap items-center gap-1 mt-2">
                      {contratosCov(a).map((c) => (
                        <Tag key={c}>{c}</Tag>
                      ))}
                      {a.waiver && (
                        <span className="text-xs text-label ml-1">
                          Waiver {a.waiver.credor} em {fmtDate(a.waiver.obtidoEm)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-label px-4 py-3 leading-relaxed border-t border-line-soft">
              Índices apurados com base nas demonstrações financeiras consolidadas: trimestrais (DL/EBITDA, EBITDA/encargos financeiros e
              (DL + imóveis a pagar)/PL) e anuais (ICSD e índice de capitalização). O descumprimento sem waiver obtido até a data do balanço
              exige a classificação do passivo no circulante (CPC 26, item 74).
            </p>
          </Card>
        </>
      )}

      {/* ------------------------------------------------------------------ Texto */}
      {aba === "nota" && (
        <Card
          title="Minuta do texto da nota explicativa"
          subtitle="Gerada automaticamente com os números da data-base – revise antes de publicar"
          actions={
            <Button icon={<Copy className="w-4 h-4" />} onClick={copiar}>
              Copiar
            </Button>
          }
        >
          <article id="texto-nota" className="max-w-3xl text-[15px] leading-relaxed text-text space-y-3">
            {renderBlocos(blocos)}
          </article>
        </Card>
      )}

      <MessageStrip>
        Valores em R$ mil, exceto quando indicado, arredondados de modo que linhas e colunas fechem. Exercício: {fmtDate(ab)} a{" "}
        {fmtDate(db)}. Saldos pelo custo amortizado (CPC 48), com juros compostos (CDI e títulos em {p.baseDiasUteis} dias úteis;
        BNDES em {p.baseDiasCorridos} dias corridos, com o excedente da TJLP sobre 6% a.a. capitalizado) e as séries históricas de
        CDI, IPCA, TJLP e TLP importadas do SAP até a data-base; juros e parcelas futuras dos contratos pós-fixados projetados com
        o último dado disponível ({fmtDate(ultimoDado)}), com pagamentos em dia não útil no dia útil seguinte. Classificação
        circulante × não circulante conforme CPC 26.
      </MessageStrip>
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Componentes locais
// ---------------------------------------------------------------------------

const COR_ESTADO: Record<ValueState, string> = {
  positive: "#009994",
  critical: "#ffa436",
  negative: "#d9563e",
  information: "#009994",
  neutral: "#908c85",
};

/** Contratos da modalidade na data-base ou na abertura (ordem da carteira) */
function idsDoGrupo(l: LinhaComp): string[] {
  const ids: string[] = [];
  for (const x of [...l.pos, ...l.posA]) if (!ids.includes(x.c.id)) ids.push(x.c.id);
  return ids;
}

/** Célula numérica da tabela de composição (valor já em R$ mil) */
function Num({ v, forte, total, leve, largo, ultimo }: { v: number; forte?: boolean; total?: boolean; leve?: boolean; largo?: boolean; ultimo?: boolean }) {
  return (
    <td
      className={clsx(
        "text-right tabular whitespace-nowrap",
        largo ? "pl-6" : "pl-4",
        ultimo && "pr-2",
        total ? "bg-surface-3 py-2.5 border-y border-line" : clsx("border-b border-line-soft", leve ? "py-2 text-label" : "py-2.5"),
        forte && "font-semibold",
      )}
    >
      {fmtK(v)}
    </td>
  );
}

interface LinhaNota {
  rotulo: string;
  valores: number[];
  forte?: boolean;
  recuo?: boolean;
}

/**
 * Tabela no padrão de nota explicativa (valores já em R$ mil, negativos entre parênteses) com a 1ª coluna fixa.
 * `totalPrimeiro`: a última coluna é o total – destacada e, no celular, logo após o rótulo (visível sem rolar).
 */
function NotaTabela({
  cabecalho,
  linhas,
  minWidth = 520,
  primeira = "R$ mil",
  totalPrimeiro = false,
}: {
  cabecalho: string[];
  linhas: LinhaNota[];
  minWidth?: number;
  primeira?: string;
  totalPrimeiro?: boolean;
}) {
  const estreito = !useMediaQuery("(min-width: 640px)");
  const ultima = cabecalho.length - 1;
  const ordem = totalPrimeiro && estreito ? [ultima, ...cabecalho.map((_, i) => i).slice(0, -1)] : cabecalho.map((_, i) => i);
  const ehTotal = (i: number) => totalPrimeiro && i === ultima;
  // No celular a largura mínima é menor, para que a 1ª coluna (fixa) não esconda os valores
  const larguras = { "--mw": `${Math.min(minWidth, 150 + 85 * cabecalho.length)}px`, "--mw-sm": `${minWidth}px` } as CSSProperties;
  return (
    <div className="overflow-x-auto fiori-scroll">
      <table className="w-full text-sm border-separate border-spacing-0 min-w-[var(--mw)] sm:min-w-[var(--mw-sm)]" style={larguras}>
        <thead>
          <tr className="text-[13px]">
            <th
              className={clsx(
                "sticky left-0 z-[2] bg-surface-2 text-left py-2 pr-3 border-b-2 border-brand",
                totalPrimeiro && "max-sm:w-[150px] max-sm:min-w-[150px] max-sm:shadow-[inset_-1px_0_0_#3f3f3d]",
              )}
            >
              {primeira}
            </th>
            {ordem.map((i) => (
              <th
                key={i}
                className={clsx("text-right py-2 pl-4 pr-2 border-b-2 border-brand whitespace-nowrap", ehTotal(i) && "bg-surface-2")}
              >
                {cabecalho[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const cell = l.forte ? "py-2.5 bg-surface-3 border-y border-line font-bold" : "py-2 border-b border-line-soft";
            return (
              <tr key={l.rotulo}>
                <td
                  className={clsx(
                    "sticky left-0 z-[1] pr-3",
                    l.forte ? cell : clsx(cell, "bg-surface"),
                    l.recuo ? "pl-6 text-label" : "pl-2",
                    totalPrimeiro && "max-sm:shadow-[inset_-1px_0_0_#3f3f3d]",
                  )}
                >
                  {l.rotulo}
                </td>
                {ordem.map((i) => (
                  <td
                    key={i}
                    className={clsx(
                      "text-right tabular whitespace-nowrap pl-4 pr-2",
                      cell,
                      l.recuo && "text-label",
                      ehTotal(i) && !l.forte && "bg-surface-3 font-semibold",
                    )}
                  >
                    {fmtK(l.valores[i])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PopIn({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-label truncate">{rotulo}</dt>
      <dd className="text-text font-semibold tabular">{valor}</dd>
    </div>
  );
}

function LinhaCaixa({ rotulo, v, forte }: { rotulo: string; v: number; forte?: boolean }) {
  return (
    <div className={clsx("flex items-baseline justify-between gap-3 py-1.5", forte && "font-bold")}>
      <dt className={forte ? "text-text" : "text-label"}>{rotulo}</dt>
      <dd className="tabular text-text whitespace-nowrap">{fmtK(v)}</dd>
    </div>
  );
}

function ListaEventos({
  titulo,
  itens,
  vazio,
}: {
  titulo: string;
  itens: { chave: string; titulo: string; detalhe: string; valor: number }[];
  vazio: string;
}) {
  return (
    <div>
      <div className="text-[13px] font-bold text-text mb-1">
        {titulo} <span className="text-label font-normal">({itens.length})</span>
      </div>
      {itens.length === 0 ? (
        <p className="text-sm text-label">{vazio}</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {itens.map((it) => (
            <li key={it.chave} className="flex items-start justify-between gap-3 py-1.5 text-[13px]">
              <span className="min-w-0">
                <span className="font-semibold text-text">{it.titulo}</span> <span className="text-label">· {it.detalhe}</span>
              </span>
              <span className="tabular text-text whitespace-nowrap">{fmtK(it.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ComposicaoMil = ReturnType<typeof composicaoMil>;

/** Composição por modalidade no celular (lista com pop-in, no lugar da tabela larga) */
function ComposicaoCelular({
  linhas,
  compDb,
  compAb,
  db,
  ab,
  custoMedio,
  abertos,
  onToggle,
}: {
  linhas: LinhaComp[];
  compDb: ComposicaoMil;
  compAb: ComposicaoMil;
  db: string;
  ab: string;
  custoMedio: number;
  abertos: Set<Grupo>;
  onToggle: (g: Grupo) => void;
}) {
  return (
    <div className="sm:hidden -mx-4">
      <div className="flex items-end justify-between gap-3 px-4 py-2 text-xs text-label border-y border-line">
        <span className="font-semibold text-text text-[13px]">Modalidade</span>
        <span className="text-right">
          R$ mil · <span className="font-semibold text-text">{fmtDate(db)}</span> ({fmtDate(ab)})
        </span>
      </div>
      <ul className="divide-y divide-line-soft">
        {linhas.map((l, gi) => {
          const g = compDb.grupos[gi];
          const ga = compAb.grupos[gi];
          const aberto = abertos.has(l.grupo);
          const ids = idsDoGrupo(l);
          return (
            <li key={l.grupo}>
              <button type="button" className="w-full text-left px-4 py-3" aria-expanded={aberto} onClick={() => onToggle(l.grupo)}>
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-text min-w-0">
                    <ChevronRight className={clsx("w-4 h-4 shrink-0 text-label transition-transform", aberto && "rotate-90")} />
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COR_GRUPO[l.grupo] }} />
                    {l.grupo}
                    <span className="text-label font-normal">({ids.length})</span>
                  </span>
                  <span className="text-right shrink-0 tabular">
                    <span className="block text-sm font-bold text-text">{fmtK(g.total)}</span>
                    <span className="block text-xs text-label">({fmtK(ga.total)})</span>
                  </span>
                </div>
                <div className="text-xs text-label leading-snug mt-0.5 pl-[22px]">{l.encargos}</div>
                <dl className="grid grid-cols-3 gap-x-3 mt-2 pl-[22px] text-[13px]">
                  <PopIn rotulo="Circulante" valor={fmtK(g.circ)} />
                  <PopIn rotulo="Não circulante" valor={fmtK(g.nc)} />
                  <PopIn rotulo="Taxa efetiva" valor={l.pos.length ? fmtPct(l.taxa) : "–"} />
                </dl>
              </button>
              {aberto && (
                <ul className="bg-surface-3 border-t border-line-soft divide-y divide-line-soft">
                  {ids.map((id) => {
                    const x = l.pos.find((y) => y.c.id === id);
                    const xa = l.posA.find((y) => y.c.id === id);
                    const c = (x ?? xa)!.c;
                    const cd = compDb.contratos.get(id);
                    const ca = compAb.contratos.get(id);
                    return (
                      <li key={id} className="pl-[38px] pr-4 py-2.5 text-[13px]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold text-text">
                              {c.id}
                              {x?.reclassificado && <span className="ml-1.5 text-negative font-normal">(reclassificado)</span>}
                            </div>
                            <div className="text-xs text-label leading-snug">
                              {taxaContratadaDivida(c)}
                              {!x ? ` · liquidado em ${fmtDate(c.vencimento)}` : !xa ? ` · captado em ${fmtDate(c.dataCaptacao)}` : ""}
                            </div>
                          </div>
                          <div className="text-right shrink-0 tabular">
                            <div className="font-semibold text-text">{fmtK(cd?.total ?? 0)}</div>
                            <div className="text-xs text-label">({fmtK(ca?.total ?? 0)})</div>
                          </div>
                        </div>
                        {x && (
                          <div className="text-xs text-label mt-0.5 tabular">
                            Circulante {fmtK(cd?.circ ?? 0)} · não circulante {fmtK(cd?.nc ?? 0)}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        <li className="px-4 py-3 bg-surface-3 border-t border-line">
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-bold text-text">Total</span>
            <span className="text-right tabular">
              <span className="block text-sm font-bold text-text">{fmtK(compDb.total.total)}</span>
              <span className="block text-xs text-label">({fmtK(compAb.total.total)})</span>
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-x-3 mt-2 text-[13px]">
            <PopIn rotulo="Circulante" valor={fmtK(compDb.total.circ)} />
            <PopIn rotulo="Não circulante" valor={fmtK(compDb.total.nc)} />
            <PopIn rotulo="Taxa efetiva" valor={fmtPct(custoMedio)} />
          </dl>
        </li>
      </ul>
    </div>
  );
}

/** Características dos contratos no celular (lista com pop-in, no lugar da tabela larga) */
function CaracteristicasCelular({
  pos,
  bndes,
  saldoMil,
  db,
}: {
  pos: PosicaoDivida[];
  bndes: boolean;
  saldoMil: (x: PosicaoDivida) => number;
  db: string;
}) {
  const captado = (x: PosicaoDivida) => Math.round(mil(x.c.valorCaptado));
  return (
    <ul className="lg:hidden border-t border-line divide-y divide-line-soft">
      {pos.map((x) => (
        <li key={x.c.id} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text leading-snug">{x.c.instrumento}</div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-label">
                <Tag>{x.c.id}</Tag>
                {x.c.formaBNDES && <Tag color={x.c.formaBNDES === "Direto" ? "#009994" : "#a462a6"}>{x.c.formaBNDES}</Tag>}
                <span>{EMPRESAS[x.c.empresa]?.nome ?? x.c.empresa}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-bold tabular text-text">{fmtK(saldoMil(x))}</div>
              <div className="text-xs text-label whitespace-nowrap">saldo {fmtDate(db)}</div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2.5 text-[13px]">
            <PopIn rotulo="Captação → vencimento" valor={`${fmtDate(x.c.dataCaptacao)} → ${fmtDate(x.c.vencimento)}`} />
            <PopIn rotulo="Valor captado" valor={fmtK(captado(x))} />
          </dl>
          <div className="text-xs text-label leading-snug mt-2 space-y-1">
            <p>
              <span className="text-text font-semibold">{taxaContratadaDivida(x.c)}</span> · juros {minuscula(x.c.descricaoJuros)}
            </p>
            <p>
              <span className="text-text">Amortização:</span> {x.c.descricaoAmortizacao}
            </p>
            {bndes && (
              <p>
                {x.c.agente ? `Agente financeiro: ${x.c.agente.replace(" (agente financeiro)", "")}` : "Contratação direta com o BNDES"}
                {x.c.linhaCredito && ` · linha ${x.c.linhaCredito}`}
              </p>
            )}
            {!bndes && x.c.agente && <p>{x.c.agente}</p>}
            <p>
              <span className="text-text">Garantias:</span> {x.c.garantias}
            </p>
            <p>
              <span className="text-text">Finalidade:</span> {x.c.finalidade}
            </p>
            {x.c.lastro && (
              <p>
                <span className="text-text">Lastro:</span> {x.c.lastro}
              </p>
            )}
          </div>
        </li>
      ))}
      {pos.length > 1 && (
        <li className="px-4 py-3 bg-surface-3 flex items-start justify-between gap-3">
          <span className="text-sm font-bold text-text">Total</span>
          <span className="text-right tabular">
            <span className="block text-sm font-bold text-text">{fmtK(soma(pos, saldoMil))}</span>
            <span className="block text-xs text-label">captado {fmtK(soma(pos, captado))}</span>
          </span>
        </li>
      )}
    </ul>
  );
}

interface CustoMil {
  original: number;
  apropriado: number;
  circ: number;
  nc: number;
  aApropriar: number;
}

/** Custos de transação por contrato no celular (lista com pop-in, no lugar da tabela larga) */
function CustosCelular({ custos, valores, total }: { custos: LinhaCusto[]; valores: (l: LinhaCusto) => CustoMil; total: CustoMil }) {
  return (
    <ul className="lg:hidden border-t border-line divide-y divide-line-soft">
      {custos.map((l) => {
        const v = valores(l);
        const pct = l.original > 0 ? l.apropriado / l.original : 0;
        return (
          <li key={l.x.c.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm">
                  <span className="font-semibold text-text">{l.x.c.id}</span>
                  <span className="text-xs text-label"> · {grupoDe(l.x.c)}</span>
                </div>
                <div className="text-xs text-label tabular">
                  {fmtDate(l.x.c.dataCaptacao)} → {fmtDate(l.x.c.vencimento)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold tabular text-text">{fmtK(v.aApropriar)}</div>
                <div className="text-xs text-label whitespace-nowrap">a apropriar · CET {fmtPct(l.x.cet)}</div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2 text-[13px]">
              <PopIn rotulo="Custo original" valor={fmtK(v.original)} />
              <PopIn rotulo="Apropriado acumulado" valor={`${fmtK(v.apropriado)} · ${fmtPct(pct, 0)}`} />
              <PopIn rotulo="Circulante" valor={fmtK(v.circ)} />
              <PopIn rotulo="Não circulante" valor={fmtK(v.nc)} />
            </dl>
          </li>
        );
      })}
      <li className="px-4 py-3 bg-surface-3">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-bold text-text">Total</span>
          <span className="text-sm font-bold tabular text-text">{fmtK(total.aApropriar)}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2 text-[13px]">
          <PopIn rotulo="Custo original" valor={fmtK(total.original)} />
          <PopIn rotulo="Apropriado acumulado" valor={fmtK(total.apropriado)} />
          <PopIn rotulo="Circulante" valor={fmtK(total.circ)} />
          <PopIn rotulo="Não circulante" valor={fmtK(total.nc)} />
        </dl>
      </li>
    </ul>
  );
}

function renderBlocos(blocos: Bloco[]): ReactNode[] {
  const out: ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = (k: number) => {
    if (!lista.length) return;
    out.push(
      <ul key={`ul-${k}`} className="list-disc pl-5 space-y-1">
        {lista.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>,
    );
    lista = [];
  };
  blocos.forEach((b, i) => {
    if (b.t === "li") {
      lista.push(b.texto);
      return;
    }
    fecharLista(i);
    if (b.t === "titulo")
      out.push(
        <h3 key={i} className="text-lg font-bold">
          {b.texto}
        </h3>,
      );
    else if (b.t === "secao")
      out.push(
        <h4 key={i} className="text-base font-bold pt-2">
          {b.texto}
        </h4>,
      );
    else out.push(<p key={i}>{b.texto}</p>);
  });
  fecharLista(blocos.length);
  return out;
}
