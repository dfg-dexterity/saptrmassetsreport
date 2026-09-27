import clsx from "clsx";
import { AlertTriangle, ArrowRight, CheckCircle2, UserRound, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, SegmentedButton, Select, TabBar } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { usePremissas } from "../../shared/context/MercadoContext";
import { IMPORTACAO_SAP, premissasNaDataBase, ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import { addDays, fmtDate, fmtMonthLong, fromDay, isBusinessDay, previousMonthEnd, proximoDiaUtil, toDay } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec } from "../../shared/lib/format";
import { ptaxNaData } from "../../shared/lib/taxas";
import { ESCOPOS, operacoesDoEscopo, type Escopo } from "../context/useDados";
import { OPERACOES } from "../data/carteira";
import { relatorioPorId } from "../data/catalogo";
import { FUNDOS } from "../data/fundos";
import { TITULOS } from "../data/tesouro";
import { TIME_DEPOSITS } from "../data/timeDeposits";
import {
  contratosMestre,
  movimentacaoMestre,
  TIPOS_CONTRATO,
  type ContratoMestre,
  type EventoMestre,
  type MovMestre,
  type TipoContrato,
} from "../lib/carteiraMestre";
import { posicoesEm } from "../lib/finance";
import { cotaFundo, posicaoFundo } from "../lib/fundos";
import { posicaoTitulo, puTitulo } from "../lib/tesouro";
import { posicaoTimeDeposit, saldoME } from "../lib/timeDeposit";

const rel = relatorioPorId("r12");

/**
 * R12 – Conciliação de fim de mês das aplicações financeiras: TRM (Carteira-Mestre) × FI-GL por conta contábil e tipo
 * de contrato, TRM × extratos externos, roll-forward do mês com checagens de integridade e checklist de fechamento
 * (DU-1 a DU+3). As diferenças são fictícias e determinísticas (dependem da data-base), sempre com a causa apurada.
 */

type Aba = "gl" | "extratos" | "rollforward" | "checklist";
type StatusConc = "Conciliado" | "Diferença explicada" | "Pendente";
/** timing = lançamento em outro período; preco = fonte de preço diferente; pendente = sem explicação aceita */
type Natureza = "timing" | "preco" | "pendente";
type StatusEtapa = "Concluída" | "Com ressalva" | "Pendente";
type Responsavel = "Tesouraria" | "Contabilidade" | "Controladoria";
type MoedaME = "USD" | "EUR";

/** Diferenças de até R$ 1,00 por linha são arredondamento (conciliado) */
const TOLERANCIA = 1;
const TOLERANCIA_TXT = fmtBRL(TOLERANCIA, true);

const STATUS_STATE: Record<StatusConc, ValueState> = { Conciliado: "positive", "Diferença explicada": "critical", Pendente: "negative" };
const ETAPA_STATE: Record<StatusEtapa, ValueState> = { Concluída: "positive", "Com ressalva": "critical", Pendente: "neutral" };

// ---------------------------------------------------------------------------
// Plano de contas (ambiente de teste – fictício) e determinação de contas
// ---------------------------------------------------------------------------

interface ContaPlano {
  conta: string;
  descricao: string;
  circulante: boolean;
  componente: "curva" | "mtm";
  regra: string;
}

const PLANO_CONTAS: ContaPlano[] = [
  {
    conta: "1.1.2.01",
    descricao: "Aplicações financeiras – renda fixa bancária",
    circulante: true,
    componente: "curva",
    regra: "Renda fixa bancária realizável em até 12 meses · principal + juros (curva)",
  },
  {
    conta: "1.1.2.02",
    descricao: "Títulos públicos federais",
    circulante: true,
    componente: "curva",
    regra: "Tesouro Direto com vencimento em até 12 meses · PU na curva × quantidade",
  },
  {
    conta: "1.1.2.03",
    descricao: "Cotas de fundos de investimento",
    circulante: true,
    componente: "curva",
    regra: "Fundos de investimento · cota × quantidade (valor justo por resultado)",
  },
  {
    conta: "1.1.2.04",
    descricao: "Aplicações no exterior – time deposits",
    circulante: true,
    componente: "curva",
    regra: "Time deposits com vencimento em até 12 meses · saldo em moeda × PTAX de fechamento",
  },
  {
    conta: "1.1.2.09",
    descricao: "Ajuste a valor justo (MTM) – circulante",
    circulante: true,
    componente: "mtm",
    regra: "Contratos circulantes a valor justo (VJORA/VJPR) · mercado − curva (acréscimo ou redutora)",
  },
  {
    conta: "1.2.1.01",
    descricao: "Aplicações financeiras – não circulante",
    circulante: false,
    componente: "curva",
    regra: "Contratos com vencimento acima de 12 meses (qualquer tipo) · curva",
  },
  {
    conta: "1.2.1.09",
    descricao: "Ajuste a valor justo (MTM) – não circulante",
    circulante: false,
    componente: "mtm",
    regra: "Contratos não circulantes a valor justo (VJORA/VJPR) · mercado − curva (acréscimo ou redutora)",
  },
];

function contaCurva(c: ContratoMestre): string {
  if (!c.circulante) return "1.2.1.01";
  if (c.tipo === "Renda fixa bancária") return "1.1.2.01";
  if (c.tipo === "Tesouro Direto") return "1.1.2.02";
  if (c.tipo === "Fundo de investimento") return "1.1.2.03";
  return "1.1.2.04";
}

function contaMTM(c: ContratoMestre): string {
  return c.circulante ? "1.1.2.09" : "1.2.1.09";
}

/** Base do saldo TRM comparado com o extrato de cada tipo de contrato */
const BASE_EXTRATO: Record<TipoContrato, string> = {
  "Renda fixa bancária": "Curva",
  "Tesouro Direto": "Mercado (PU ANBIMA)",
  "Fundo de investimento": "Cota × quantidade",
  "Time deposit": "ME × PTAX",
};

const FONTE_TIPO: Record<TipoContrato, string> = {
  "Renda fixa bancária": "Bancos emissores e B3",
  "Tesouro Direto": "B3 / agentes de custódia",
  "Fundo de investimento": "Administradores",
  "Time deposit": "Bancos no exterior (ME)",
};

/** Fundos que divulgam a cota de fechamento em D+1 (multimercado, ações e cambial) */
const CLASSES_COTA_D1 = new Set(["Multimercado macro", "Ações", "Cambial"]);

// ---------------------------------------------------------------------------
// Checklist de fechamento
// ---------------------------------------------------------------------------

interface Etapa {
  id: string;
  du: number;
  etapa: string;
  transacao: string | null;
  responsavel: Responsavel;
}

const ETAPAS: Etapa[] = [
  {
    id: "mercado",
    du: -1,
    etapa: "Importar dados de mercado para o SAP: PTAX (TCURR), taxas indicativas ANBIMA/PU dos títulos, cotas de fundos e índices (CDI/IPCA)",
    transacao: null,
    responsavel: "Tesouraria",
  },
  { id: "tbb1", du: 0, etapa: "Lançamento dos fluxos do mês: aplicações, juros recebidos, resgates, cupons e come-cotas", transacao: "TBB1", responsavel: "Tesouraria" },
  { id: "tpm44", du: 0, etapa: "Apropriação (accrual/deferral) dos juros por competência", transacao: "TPM44", responsavel: "Contabilidade" },
  { id: "tpm1", du: 1, etapa: "Avaliação: marcação a mercado dos títulos e variação cambial dos time deposits", transacao: "TPM1", responsavel: "Contabilidade" },
  { id: "tpm10", du: 1, etapa: "Lançamentos da gestão de posições – conferência do diário gerado", transacao: "TPM10", responsavel: "Contabilidade" },
  { id: "gl", du: 2, etapa: "Conciliar TRM × FI-GL por conta contábil e tipo de contrato (esta tela)", transacao: null, responsavel: "Contabilidade" },
  {
    id: "extratos",
    du: 2,
    etapa: "Conciliar TRM × extratos: bancos, B3/custodiantes, administradores de fundos e bancos no exterior (esta tela)",
    transacao: null,
    responsavel: "Tesouraria",
  },
  { id: "rollforward", du: 2, etapa: "Roll-forward do mês e checagens de integridade (esta tela)", transacao: null, responsavel: "Controladoria" },
  { id: "aprovacao", du: 3, etapa: "Aprovação da Controladoria e envio dos saldos para a nota explicativa (R02)", transacao: null, responsavel: "Controladoria" },
];

const TRANSACOES_SAP: { codigo: string; descricao: string }[] = [
  { codigo: "TBB1", descricao: "Lançamento dos fluxos (aplicações, resgates, juros recebidos, cupons e come-cotas) no FI-GL" },
  { codigo: "TPM44", descricao: "Apropriação por competência (accrual/deferral) dos juros das aplicações" },
  { codigo: "TPM1", descricao: "Avaliação: MTM dos títulos a valor justo (VJORA/VJPR) e variação cambial dos time deposits" },
  { codigo: "TPM10", descricao: "Lançamentos da gestão de posições – conferência do diário gerado antes da conciliação" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const r2 = (v: number) => Math.round(v * 100) / 100;
const arred = (v: number, casas: number) => Math.round(v * 10 ** casas) / 10 ** casas;
const truncar = (v: number, casas: number) => Math.trunc(v * 10 ** casas + 1e-9) / 10 ** casas;

function fmtValor(v: number): string {
  return fmtDec(v, 2);
}

/** Diferença com sinal explícito (+/−); zero sem sinal */
function fmtDif(v: number, casas = 2): string {
  if (Math.abs(v) < 0.5 / 10 ** casas) return fmtDec(0, casas);
  return `${v > 0 ? "+" : "−"}${fmtDec(Math.abs(v), casas)}`;
}

function fmtDifBRL(v: number): string {
  if (Math.abs(v) < 0.005) return fmtBRL(0, true);
  return `${v > 0 ? "+" : "−"}${fmtBRL(Math.abs(v), true)}`;
}

const fmtTaxa = (v: number) => `${fmtDec(v * 100, 2)}%`;

function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function diaSemana(iso: string): string {
  return DIAS_SEMANA[(((toDay(iso) + 4) % 7) + 7) % 7];
}

/**
 * Calendário de fechamento (feriados nacionais – base ANBIMA): DU0 = último dia útil do mês da data-base; DU-n = n-ésimo
 * dia útil anterior; DU+n = n-ésimo dia útil após o fim do mês.
 */
function diaUtil(dataBase: string, n: number): string {
  if (n > 0) {
    let d = dataBase;
    for (let k = 0; k < n; k++) d = proximoDiaUtil(addDays(d, 1));
    return d;
  }
  let d = toDay(dataBase);
  while (!isBusinessDay(d)) d--;
  for (let k = 0; k > n; k--) {
    d--;
    while (!isBusinessDay(d)) d--;
  }
  return fromDay(d);
}

function rotuloDU(n: number): string {
  return n === 0 ? "DU0" : n > 0 ? `DU+${n}` : `DU${n}`;
}

/** Último dia útil local do banco no exterior (segunda a sexta) até a data */
function ultimoDiaUtilExterior(iso: string): string {
  let d = toDay(iso);
  for (;;) {
    const dow = (((d + 4) % 7) + 7) % 7;
    if (dow !== 0 && dow !== 6) return fromDay(d);
    d--;
  }
}

/** Luminância relativa (WCAG 2.x) */
function luminancia(rgb: number[]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Texto da tag escurecido até contraste ≥ 4,5:1 sobre o fundo com a cor a 8% */
function corTextoTag(hex: string): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const fundo = luminancia(rgb.map((v) => 255 - (255 - v) * 0.08));
  let c = rgb;
  while ((fundo + 0.05) / (luminancia(c) + 0.05) < 4.5) c = c.map((v) => Math.floor(v * 0.9));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const META_TIPO = new Map(
  TIPOS_CONTRATO.map((t) => [t.tipo, { ...t, texto: corTextoTag(t.cor), borda: `${t.cor}66`, fundo: `${t.cor}14` }]),
);

function metaTipo(t: TipoContrato) {
  return META_TIPO.get(t)!;
}

const DESTAQUE_PENDENTE = "bg-[#fff6f9]! [&>td:first-child]:shadow-[inset_4px_0_0_#f53232]";
const DESTAQUE_EXPLICADA = "[&>td:first-child]:shadow-[inset_4px_0_0_#e76500]";
const destaqueLinha = (s: StatusConc) => (s === "Pendente" ? DESTAQUE_PENDENTE : s === "Diferença explicada" ? DESTAQUE_EXPLICADA : undefined);
const destaquePopIn = (s: StatusConc) =>
  s === "Pendente" ? "bg-[#fff6f9] shadow-[inset_4px_0_0_#f53232]" : s === "Diferença explicada" ? "shadow-[inset_4px_0_0_#e76500]" : undefined;

const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

// ---------------------------------------------------------------------------
// Motor da conciliação (helpers locais sobre a Carteira-Mestre)
// ---------------------------------------------------------------------------

interface ItemDif {
  natureza: Natureza;
  valor: number;
  texto: string;
}

interface LinhaGL {
  chave: string;
  conta: ContaPlano;
  tipo: TipoContrato;
  contratos: number;
  saldoTRM: number;
  saldoGL: number;
  diferenca: number;
  arredondamento: number;
  itens: ItemDif[];
  status: StatusConc;
  motivo: string | null;
}

interface DetalheTitulo {
  tipo: "titulo";
  custodiante: string;
  quantidade: number;
  puTRM: number;
  puExtrato: number;
  taxaTRM: number;
  taxaExtrato: number;
}

interface DetalheFundo {
  tipo: "fundo";
  administrador: string;
  quantidade: number;
  quantidadeExtrato: number;
  cotaTRM: number;
  cotaExtrato: number;
  dataCota: string;
  d1: boolean;
}

interface DetalheTD {
  tipo: "td";
  banco: string;
  moeda: MoedaME;
  saldoTRMME: number;
  saldoExtratoME: number;
  ptax: number;
  dataExtrato: string;
}

interface LinhaExtrato {
  c: ContratoMestre;
  fonte: string;
  base: string;
  saldoTRM: number;
  saldoExtrato: number;
  diferenca: number;
  itens: ItemDif[];
  status: StatusConc;
  motivo: string | null;
  detalhe: DetalheTitulo | DetalheFundo | DetalheTD | null;
}

interface Checagem {
  id: string;
  descricao: string;
  ok: boolean;
  detalhe: string;
}

interface EtapaStatus extends Etapa {
  data: string;
  status: StatusEtapa;
  nota: string | null;
}

function statusDe(itens: ItemDif[], diferenca: number): StatusConc {
  if (itens.some((i) => i.natureza === "pendente")) return "Pendente";
  return Math.abs(diferenca) > TOLERANCIA ? "Diferença explicada" : "Conciliado";
}

function motivoDe(itens: ItemDif[], arredondamento: number, textoArred: string): string | null {
  const textos = itens.map((i) => i.texto);
  if (Math.abs(arredondamento) >= 0.005) textos.push(itens.length ? `Inclui ${fmtDifBRL(arredondamento)} de arredondamento.` : textoArred);
  return textos.length ? textos.join(" ") : null;
}

function identidade(m: MovMestre): number {
  return m.saldoFinal - (m.saldoInicial + m.aplicacoes + m.rendimentos - m.resgatesBrutos - m.comeCotas);
}

function montarConciliacao(db: string, p: PremissasMercado, escopo: Escopo) {
  const inicio = previousMonthEnd(db);
  /** fechamento em andamento: a data-base é o último dado importado do SAP (meses anteriores já aprovados) */
  const emAndamento = db === IMPORTACAO_SAP.ultimoDadoDisponivel;
  const du0 = diaUtil(db, 0);
  const duM1 = diaUtil(db, -1);
  const du1 = diaUtil(db, 1);
  const noEscopo = (empresa: string) => escopo === "todas" || empresa === escopo;

  const contratos = contratosMestre(db, p, escopo);
  const mov = movimentacaoMestre(inicio, db, p, escopo);

  // Exceções do fechamento em andamento (fictícias): a última aplicação de renda fixa do mês ficou sem a apropriação
  // (TPM44) no FI-GL e a primeira, indexada ao CDI, tem extrato do banco com taxa diferente da negociada.
  const aplicacoesRF = mov.eventos
    .filter((e) => e.tipo === "Aplicação" && e.tipoContrato === "Renda fixa bancária")
    .map((e) => contratos.find((c) => c.codigo === e.codigo))
    .filter((c): c is ContratoMestre => !!c);
  const opGL = emAndamento ? (aplicacoesRF[aplicacoesRF.length - 1] ?? null) : null;
  const opExtrato = emAndamento ? (aplicacoesRF.find((c) => c !== opGL && c.indexador === "CDI") ?? null) : null;

  // ------------------------------------------------------------------ TRM × FI-GL
  const grupos = new Map<string, { conta: ContaPlano; tipo: TipoContrato; itens: { c: ContratoMestre; v: number }[] }>();
  const adicionar = (conta: string, c: ContratoMestre, v: number) => {
    const k = `${conta}|${c.tipo}`;
    let g = grupos.get(k);
    if (!g) {
      g = { conta: PLANO_CONTAS.find((x) => x.conta === conta)!, tipo: c.tipo, itens: [] };
      grupos.set(k, g);
    }
    g.itens.push({ c, v });
  };
  for (const c of contratos) {
    adicionar(contaCurva(c), c, c.saldoCurva);
    const mtm = c.valorContabil - c.saldoCurva;
    if (c.cpc48 !== "Custo Amortizado" && Math.abs(mtm) >= 0.005) adicionar(contaMTM(c), c, mtm);
  }

  const ptaxFim: Record<MoedaME, number> = { USD: p.ptaxUSD, EUR: p.ptaxEUR };
  const ptaxPenultimo: Record<MoedaME, number> = { USD: ptaxNaData("USD", duM1, p), EUR: ptaxNaData("EUR", duM1, p) };
  const comeCotas = mov.eventos.filter((e) => e.tipo === "Come-cotas");

  const gl: LinhaGL[] = [];
  for (const conta of PLANO_CONTAS) {
    for (const t of TIPOS_CONTRATO) {
      const g = grupos.get(`${conta.conta}|${t.tipo}`);
      if (!g) continue;
      const saldoTRM = g.itens.reduce((s, i) => s + i.v, 0);
      const arredondamento = g.itens.reduce((s, i) => s + (r2(i.v) - i.v), 0);
      const itens: ItemDif[] = [];
      if (conta.componente === "curva" && t.tipo === "Time deposit") {
        const moedas = [...new Set(g.itens.map((i) => i.c.moeda))].filter((m): m is MoedaME => m !== "BRL");
        const valor = g.itens.reduce((s, i) => (i.c.moeda === "BRL" ? s : s + r2(i.c.saldoME * (ptaxPenultimo[i.c.moeda] - i.c.ptax))), 0);
        if (Math.abs(valor) >= 0.005)
          itens.push({
            natureza: "timing",
            valor,
            texto: `Variação cambial de ${fmtDate(du0)} (último dia útil) contabilizada em D+1, ${fmtDate(du1)}: o FI-GL está avaliado à PTAX de ${fmtDate(duM1)} (${moedas.map((m) => `${m} ${fmtDec(ptaxPenultimo[m], 4)}`).join("; ")}) e o TRM à PTAX de fechamento (${moedas.map((m) => `${m} ${fmtDec(ptaxFim[m], 4)}`).join("; ")}). Regulariza no mês seguinte.`,
          });
      }
      if (conta.componente === "curva" && t.tipo === "Fundo de investimento" && comeCotas.length) {
        const valor = r2(comeCotas.reduce((s, e) => s + e.ir, 0));
        itens.push({
          natureza: "timing",
          valor,
          texto: `Come-cotas de ${fmtDate(comeCotas[0].data)} (IR de ${fmtBRL(valor, true)} em ${plural(comeCotas.length, "fundo", "fundos")}) informado pelos administradores e contabilizado em D+1, ${fmtDate(du1)}: o FI-GL ainda não reflete a redução das cotas (contrapartida em IRRF a compensar).`,
        });
      }
      if (opGL && conta.componente === "curva" && t.tipo === opGL.tipo && contaCurva(opGL) === conta.conta) {
        const juros = r2(opGL.saldoCurva - opGL.principalBRL);
        itens.push({
          natureza: "pendente",
          valor: -juros,
          texto: `Log da TPM44 com erro na operação ${opGL.codigo} (${opGL.produto} ${opGL.contraparte}, aplicada em ${fmtDate(opGL.dataAplicacao)}): determinação de contas não encontrada – juros de ${fmtBRL(juros, true)} apropriados no TRM e não contabilizados. Corrigir e reprocessar a TPM44.`,
        });
      }
      const diferenca = itens.reduce((s, i) => s + i.valor, 0) + arredondamento;
      gl.push({
        chave: `${conta.conta}|${t.tipo}`,
        conta,
        tipo: t.tipo,
        contratos: new Set(g.itens.map((i) => i.c.id)).size,
        saldoTRM,
        saldoGL: saldoTRM + diferenca,
        diferenca,
        arredondamento,
        itens,
        status: statusDe(itens, diferenca),
        motivo: motivoDe(itens, arredondamento, "Arredondamento de centavos nos lançamentos por contrato – dentro da tolerância."),
      });
    }
  }

  // ------------------------------------------------------------------ TRM × extratos
  const extratos: LinhaExtrato[] = [];
  for (const t of TIPOS_CONTRATO) {
    for (const c of contratos.filter((x) => x.tipo === t.tipo)) {
      const itens: ItemDif[] = [];
      let saldoTRM = c.saldoCurva;
      let saldoExtrato = c.saldoCurva;
      let fonte = "";
      let textoArred = "Arredondamento de centavos – dentro da tolerância.";
      let detalhe: LinhaExtrato["detalhe"] = null;

      if (c.tipo === "Renda fixa bancária") {
        const titulo = c.produto === "Debênture" || c.produto === "CRI" || c.produto === "CRA";
        fonte = titulo ? `B3 – extrato de custódia (${c.contraparte})` : `${c.contraparte} – extrato de posição`;
        saldoExtrato = r2(c.principalBRL * truncar(c.saldoCurva / c.principalBRL, 8));
        textoArred = "Fator acumulado truncado na 8ª casa decimal pelo emissor – centavos, dentro da tolerância.";
        if (opExtrato && c.id === opExtrato.id) {
          const taxa = OPERACOES.find((o) => o.transacao === c.id)?.taxa ?? 1;
          const juros = c.saldoCurva - c.principalBRL;
          const valor = -r2((juros * 0.01) / taxa);
          saldoExtrato += valor;
          itens.push({
            natureza: "pendente",
            valor,
            texto: `Extrato do ${c.contraparte} remunera ${fmtDec((taxa - 0.01) * 100, 1)}% do CDI; a nota de negociação e o cadastro do TRM têm ${fmtDec(taxa * 100, 1)}% do CDI (juros desde ${fmtDate(c.dataAplicacao)}). Contestar com o banco antes da aprovação.`,
          });
        }
      } else if (c.tipo === "Tesouro Direto") {
        const tit = TITULOS.find((x) => x.id === c.codigo)!;
        const x = posicaoTitulo(tit, db, p);
        // agente com fonte de preço própria: ±1 bp sobre a taxa indicativa ANBIMA (sinal alterna com o mês)
        const bp = tit.custodiante.includes("Bradesco") ? (Number(db.slice(5, 7)) % 2 === 1 ? 1 : -1) : 0;
        const taxaExtrato = x.taxaMercado + bp / 10_000;
        const puExtrato = truncar(bp ? puTitulo(tit, db, taxaExtrato, p) : x.puMercado, 6);
        fonte = `${tit.custodiante} – PU de mercado`;
        saldoTRM = c.saldoMercado;
        saldoExtrato = r2(tit.quantidade * puExtrato);
        textoArred = "PU truncado na 6ª casa decimal (convenção B3/Tesouro) – centavos, dentro da tolerância.";
        const dif = saldoExtrato - saldoTRM;
        if (bp && Math.abs(dif) > TOLERANCIA)
          itens.push({
            natureza: "preco",
            valor: dif,
            texto: `PU do agente (${fmtDec(puExtrato, 6)}) calculado com taxa de ${fmtDec(taxaExtrato * 100, 2)}% – fonte própria, ${bp > 0 ? "+" : "−"}1 bp sobre a taxa indicativa ANBIMA de ${fmtDec(x.taxaMercado * 100, 2)}% usada no TRM. Diferença de precificação, sem ajuste contábil.`,
          });
        detalhe = {
          tipo: "titulo",
          custodiante: tit.custodiante,
          quantidade: tit.quantidade,
          puTRM: x.puMercado,
          puExtrato,
          taxaTRM: x.taxaMercado,
          taxaExtrato: bp ? taxaExtrato : x.taxaMercado,
        };
      } else if (c.tipo === "Fundo de investimento") {
        const f = FUNDOS.find((x) => x.id === c.codigo)!;
        const pos = posicaoFundo(f, db, p);
        const d1 = CLASSES_COTA_D1.has(f.classe);
        const dataCota = d1 ? duM1 : db;
        const cotaExtrato = arred(cotaFundo(f, dataCota, p), 8);
        const quantidadeExtrato = arred(pos.quantidade, 6);
        fonte = `${f.administrador} – posição de cotas`;
        saldoExtrato = r2(quantidadeExtrato * cotaExtrato);
        textoArred = "Quantidade (6 casas) e cota (8 casas) arredondadas pelo administrador – centavos, dentro da tolerância.";
        const dif = saldoExtrato - saldoTRM;
        if (d1 && Math.abs(dif) > TOLERANCIA)
          itens.push({
            natureza: "timing",
            valor: dif,
            texto: `Posição extraída em ${rotuloDU(0)} com a cota de ${fmtDate(dataCota)} (${fmtDec(cotaExtrato, 8)}): a cota de fechamento é divulgada pelo administrador em D+1. Diferença temporária – confirmar com a cota publicada em ${fmtDate(du1)}.`,
          });
        detalhe = {
          tipo: "fundo",
          administrador: f.administrador,
          quantidade: pos.quantidade,
          quantidadeExtrato,
          cotaTRM: pos.cota,
          cotaExtrato,
          dataCota,
          d1,
        };
      } else {
        const td = TIME_DEPOSITS.find((x) => x.id === c.codigo)!;
        const dataExtrato = ultimoDiaUtilExterior(db);
        const saldoExtratoME = r2(saldoME(td, dataExtrato));
        fonte = `${td.banco} – extrato em ${td.moeda}`;
        saldoExtrato = saldoExtratoME * c.ptax;
        textoArred = `Saldo em ${td.moeda} arredondado a centavos pelo banco – dentro da tolerância.`;
        const dias = toDay(db) - toDay(dataExtrato);
        const dif = saldoExtrato - saldoTRM;
        if (dias > 0 && Math.abs(dif) > TOLERANCIA)
          itens.push({
            natureza: "timing",
            valor: dif,
            texto: `Extrato emitido em ${fmtDate(dataExtrato)} (último dia útil local): juros de ${plural(dias, "dia corrido", "dias corridos")} até a data-base não incluídos (${td.moeda} ${fmtDec(saldoExtratoME - c.saldoME, 2)}). Diferença temporária.`,
          });
        detalhe = {
          tipo: "td",
          banco: td.banco,
          moeda: td.moeda,
          saldoTRMME: c.saldoME,
          saldoExtratoME,
          ptax: c.ptax,
          dataExtrato,
        };
      }

      const diferenca = saldoExtrato - saldoTRM;
      const explicado = itens.reduce((s, i) => s + i.valor, 0);
      const resto = diferenca - explicado;
      extratos.push({
        c,
        fonte,
        base: BASE_EXTRATO[c.tipo],
        saldoTRM,
        saldoExtrato,
        diferenca,
        itens,
        status: statusDe(itens, diferenca),
        motivo: motivoDe(itens, resto, textoArred),
        detalhe,
      });
    }
  }

  // ------------------------------------------------------------------ Roll-forward e checagens
  const porTipo = TIPOS_CONTRATO.map((t) => {
    const cs = contratos.filter((c) => c.tipo === t.tipo);
    return {
      ...t,
      mov: mov.porTipo[t.tipo],
      carteira: cs.reduce((s, c) => s + c.saldoCurva, 0),
      contabil: cs.reduce((s, c) => s + c.valorContabil, 0),
      contratos: cs.length,
    };
  });
  const saldoCarteira = contratos.reduce((s, c) => s + c.saldoCurva, 0);
  const valorContabil = contratos.reduce((s, c) => s + c.valorContabil, 0);
  const pAnterior = premissasNaDataBase(inicio);
  const saldoAnterior = contratosMestre(inicio, pAnterior, escopo).reduce((s, c) => s + c.saldoCurva, 0);
  const difIdentidade = Math.max(Math.abs(identidade(mov.total)), ...porTipo.map((t) => Math.abs(identidade(t.mov))));
  const difSaldoFinal = mov.total.saldoFinal - saldoCarteira;
  const difSaldoInicial = mov.total.saldoInicial - saldoAnterior;
  const rollforwardOk = difIdentidade < 0.005 && Math.abs(difSaldoFinal) < 0.005;

  const mtmVJORA = contratos.filter((c) => c.cpc48 === "VJ por ORA").reduce((s, c) => s + c.valorContabil - c.saldoCurva, 0);
  const mtmVJPR = contratos.filter((c) => c.cpc48 === "VJ por Resultado").reduce((s, c) => s + c.valorContabil - c.saldoCurva, 0);
  const mtmCusto = contratos.filter((c) => c.cpc48 === "Custo Amortizado").reduce((s, c) => s + c.mtm, 0);
  const mtmCalculado = contratos.filter((c) => c.cpc48 !== "Custo Amortizado").reduce((s, c) => s + c.mtm, 0);
  const mtmContabil = gl.filter((l) => l.conta.componente === "mtm").reduce((s, l) => s + l.saldoTRM, 0);
  const circulante = gl.filter((l) => l.conta.circulante).reduce((s, l) => s + l.saldoTRM, 0);

  // totais dos relatórios de origem (motores do R01, R08, R09 e R10)
  const r01 = posicoesEm(operacoesDoEscopo(escopo), db, p);
  const r08 = TITULOS.filter((t) => noEscopo(t.empresa))
    .map((t) => posicaoTitulo(t, db, p))
    .filter((x) => x.ativo);
  const r09 = FUNDOS.filter((f) => noEscopo(f.empresa))
    .map((f) => posicaoFundo(f, db, p))
    .filter((x) => x.ativo);
  const r10 = TIME_DEPOSITS.filter((t) => noEscopo(t.empresa))
    .map((t) => posicaoTimeDeposit(t, db, p))
    .filter((x) => x.ativo);
  const origem = [
    { id: "r01", rel: "R01", tipo: "Renda fixa bancária" as TipoContrato, n: r01.length, total: r01.reduce((s, x) => s + x.valorContabil, 0), un: ["operação", "operações"] },
    { id: "r08", rel: "R08", tipo: "Tesouro Direto" as TipoContrato, n: r08.length, total: r08.reduce((s, x) => s + x.valorContabil, 0), un: ["título", "títulos"] },
    { id: "r09", rel: "R09", tipo: "Fundo de investimento" as TipoContrato, n: r09.length, total: r09.reduce((s, x) => s + x.saldo, 0), un: ["fundo", "fundos"] },
    { id: "r10", rel: "R10", tipo: "Time deposit" as TipoContrato, n: r10.length, total: r10.reduce((s, x) => s + x.saldoBRL, 0), un: ["time deposit", "time deposits"] },
  ];

  const tds = contratos.filter((c) => c.tipo === "Time deposit");
  const moedasTD = [...new Set(tds.map((c) => c.moeda))].filter((m): m is MoedaME => m !== "BRL");
  const ptaxOk = tds.every((c) => c.moeda !== "BRL" && Math.abs(c.ptax - ptaxFim[c.moeda]) < 1e-9);
  const extFundos = extratos.filter((l) => l.c.tipo === "Fundo de investimento");
  const fundosIguais = extFundos.filter((l) => l.detalhe?.tipo === "fundo" && !l.detalhe.d1).length;
  const fundosD1 = extFundos.length - fundosIguais;
  const fmt2 = (v: number) => fmtDec(v, 2);

  const checagens: Checagem[] = [
    {
      id: "identidade",
      descricao: "Roll-forward fecha: SF = SI + aplicações + rendimentos − resgates − come-cotas",
      ok: difIdentidade < 0.005,
      detalhe: `Diferença de R$ ${fmt2(difIdentidade)} no total e em cada tipo de contrato`,
    },
    {
      id: "saldoFinal",
      descricao: `Saldo final do roll-forward = Σ saldo bruto da Carteira-Mestre em ${fmtDate(db)}`,
      ok: Math.abs(difSaldoFinal) < 0.005,
      detalhe: `${fmtBRL(saldoCarteira, true)} em ${plural(contratos.length, "contrato", "contratos")} · diferença de R$ ${fmt2(Math.abs(difSaldoFinal))}`,
    },
    {
      id: "saldoInicial",
      descricao: `Saldo inicial = saldo do fechamento de ${fmtDate(inicio)}`,
      ok: Math.abs(difSaldoInicial) < 0.005,
      detalhe: `${fmtBRL(saldoAnterior, true)} (Carteira-Mestre com as premissas daquela data-base) · diferença de R$ ${fmt2(Math.abs(difSaldoInicial))}`,
    },
    ...origem.map((o) => {
      const mestre = porTipo.find((t) => t.tipo === o.tipo)!;
      const dif = o.total - mestre.contabil;
      return {
        id: o.id,
        descricao: `${metaTipo(o.tipo).curto}: total do ${o.rel} × Carteira-Mestre (valor contábil)`,
        ok: Math.abs(dif) < 0.005 && o.n === mestre.contratos,
        detalhe: o.n
          ? `${fmtBRL(o.total, true)} em ${plural(o.n, o.un[0], o.un[1])} · diferença de R$ ${fmt2(Math.abs(dif))}`
          : `Sem ${o.un[1]} na empresa selecionada`,
      };
    }),
    {
      id: "mtm",
      descricao: "MTM contábil (contas 1.1.2.09 e 1.2.1.09) = MTM calculado dos contratos a valor justo",
      ok: Math.abs(mtmContabil - mtmCalculado) < 0.005,
      detalhe: `${fmtBRL(mtmContabil, true)} (VJORA ${fmtBRL(mtmVJORA, true)} · VJPR ${fmtBRL(mtmVJPR, true)}); o MTM de ${fmtBRL(mtmCusto, true)} dos contratos ao custo amortizado não é contabilizado – apenas divulgado (CPC 40)`,
    },
    {
      id: "ptax",
      descricao: "PTAX usada nos time deposits = PTAX importada (TCURR, tipo M)",
      ok: ptaxOk,
      detalhe: tds.length
        ? `${moedasTD.map((m) => `${m} ${fmtDec(ptaxFim[m], 4)}`).join(" · ")} de ${fmtDate(du0)} em ${plural(tds.length, "contrato", "contratos")}`
        : "Sem contratos em moeda estrangeira na empresa selecionada",
    },
    {
      id: "cotas",
      descricao: "Cotas do TRM × cotas informadas pelos administradores",
      ok: extFundos.every((l) => l.status !== "Pendente"),
      detalhe: extFundos.length
        ? `${fundosIguais} de ${plural(extFundos.length, "fundo", "fundos")} com a mesma cota${fundosD1 ? `; ${fundosD1} com a cota de ${fmtDate(duM1)} (divulgação em D+1 – diferença explicada)` : ""}`
        : "Sem fundos na empresa selecionada",
    },
    {
      id: "mercado",
      descricao: "Dados de mercado importados do SAP até a data-base",
      ok: db <= IMPORTACAO_SAP.ultimoDadoDisponivel,
      detalhe: `Último dado disponível na data-base: ${fmtDate(ultimoDadoNaDataBase(db))} – a conciliação não usa valores projetados`,
    },
  ];

  // ------------------------------------------------------------------ Checklist
  const glPend = gl.filter((l) => l.status === "Pendente");
  const glExp = gl.filter((l) => l.status === "Diferença explicada");
  const extPend = extratos.filter((l) => l.status === "Pendente");
  const extExp = extratos.filter((l) => l.status === "Diferença explicada");
  const checagensFalha = checagens.filter((c) => !c.ok);
  const fx = gl.flatMap((l) => (l.tipo === "Time deposit" ? l.itens.filter((i) => i.natureza === "timing") : []));
  const cc = gl.flatMap((l) => (l.tipo === "Fundo de investimento" ? l.itens.filter((i) => i.natureza === "timing") : []));
  const somaItens = (xs: ItemDif[]) => xs.reduce((s, i) => s + i.valor, 0);
  const qtdPendencias = glPend.length + extPend.length + checagensFalha.length;
  const fluxos = mov.eventos.length;

  const checklist: EtapaStatus[] = ETAPAS.map((e) => {
    let status: StatusEtapa = "Concluída";
    let nota: string | null = null;
    switch (e.id) {
      case "mercado":
        nota = `PTAX de fechamento${moedasTD.length ? ` (${moedasTD.map((m) => `${m} ${fmtDec(ptaxFim[m], 4)}`).join("; ")})` : ""}, taxas ANBIMA, cotas e CDI/IPCA carregados até ${fmtDate(ultimoDadoNaDataBase(db))}.`;
        break;
      case "tbb1":
        if (cc.length && Math.abs(somaItens(cc)) > TOLERANCIA) {
          status = "Com ressalva";
          nota = `Come-cotas (${fmtBRL(somaItens(cc), true)}) lançado em D+1 após o informe dos administradores – diferença temporária na conta 1.1.2.03.`;
        } else nota = fluxos ? `${plural(fluxos, "fluxo lançado", "fluxos lançados")} no mês.` : "Sem fluxos no mês.";
        break;
      case "tpm44":
        if (opGL) {
          status = "Com ressalva";
          nota = `Erro no log da operação ${opGL.codigo}: juros de ${fmtBRL(opGL.saldoCurva - opGL.principalBRL, true)} não contabilizados – reprocessar.`;
        }
        break;
      case "tpm1":
        if (fx.length && Math.abs(somaItens(fx)) > TOLERANCIA) {
          status = "Com ressalva";
          nota = `Variação cambial do último dia útil dos time deposits (${fmtDifBRL(-somaItens(fx))}) lançada em D+1 – item de conciliação da conta 1.1.2.04.`;
        }
        break;
      case "gl":
        if (glPend.length) {
          status = "Com ressalva";
          nota = `${plural(glPend.length, "diferença pendente", "diferenças pendentes")} (${fmtDifBRL(glPend.reduce((s, l) => s + l.diferenca, 0))}).`;
        } else if (glExp.length) nota = `${plural(glExp.length, "diferença temporária explicada", "diferenças temporárias explicadas")}.`;
        break;
      case "extratos":
        if (extPend.length) {
          status = "Com ressalva";
          nota = `${plural(extPend.length, "extrato com diferença pendente", "extratos com diferença pendente")} (${extPend.map((l) => l.c.codigo).join(", ")}).`;
        } else if (extExp.length) nota = `${plural(extExp.length, "diferença explicada", "diferenças explicadas")} (timing e fonte de preço).`;
        break;
      case "rollforward":
        if (checagensFalha.length) {
          status = "Com ressalva";
          nota = `${plural(checagensFalha.length, "checagem com falha", "checagens com falha")}.`;
        } else nota = `Diferença de R$ 0,00 · ${checagens.length} checagens OK.`;
        break;
      case "aprovacao":
        if (qtdPendencias) {
          status = "Pendente";
          nota = `Aguarda a regularização de ${plural(qtdPendencias, "pendência", "pendências")}.`;
        } else nota = "Período aprovado; saldos enviados para a nota explicativa.";
        break;
    }
    return { ...e, data: diaUtil(db, e.du), status, nota };
  });

  // ------------------------------------------------------------------ Resumos
  const contas = [...new Set(gl.map((l) => l.conta.conta))].map((conta) => {
    const ls = gl.filter((l) => l.conta.conta === conta);
    const status: StatusConc = ls.some((l) => l.status === "Pendente")
      ? "Pendente"
      : ls.some((l) => l.status === "Diferença explicada")
        ? "Diferença explicada"
        : "Conciliado";
    return { conta, status };
  });

  const planoResumo = PLANO_CONTAS.map((conta) => {
    const ls = gl.filter((l) => l.conta.conta === conta.conta);
    return {
      conta,
      contratos: ls.reduce((s, l) => s + l.contratos, 0),
      tipos: ls.map((l) => l.tipo),
      saldoTRM: ls.reduce((s, l) => s + l.saldoTRM, 0),
      saldoGL: ls.reduce((s, l) => s + l.saldoGL, 0),
    };
  });

  const naturezas = (["timing", "pendente"] as Natureza[]).map((n) => {
    const xs = gl.flatMap((l) => l.itens.filter((i) => i.natureza === n));
    return { natureza: n, qtd: xs.length, valor: somaItens(xs) };
  });
  const arredondamentoGL = gl.reduce((s, l) => s + l.arredondamento, 0);

  return {
    inicio,
    emAndamento,
    du0,
    duM1,
    du1,
    contratos,
    mov,
    gl,
    contas,
    planoResumo,
    naturezas,
    arredondamentoGL,
    extratos,
    porTipo,
    saldoCarteira,
    saldoAnterior,
    valorContabil,
    circulante,
    mtmVJORA,
    mtmVJPR,
    mtmCusto,
    rollforwardOk,
    difIdentidade,
    difSaldoFinal,
    checagens,
    checklist,
    glPend,
    glExp,
    extPend,
    extExp,
    checagensFalha,
    qtdPendencias,
  };
}

type Conciliacao = ReturnType<typeof montarConciliacao>;

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

/** Relatório relacionado a cada checagem de integridade */
const LINK_CHECAGEM: Record<string, { rotulo: string; rota?: string; aba?: Aba }> = {
  saldoInicial: { rotulo: "Carteira-Mestre", rota: "/carteira-mestre" },
  saldoFinal: { rotulo: "Carteira-Mestre", rota: "/carteira-mestre" },
  r01: { rotulo: "R01 – Composição", rota: "/r01-composicao" },
  r08: { rotulo: "R08 – Tesouro Direto", rota: "/r08-tesouro" },
  r09: { rotulo: "R09 – Fundos", rota: "/r09-fundos" },
  r10: { rotulo: "R10 – Time deposits", rota: "/r10-time-deposit" },
  mtm: { rotulo: "Ver TRM × FI-GL", aba: "gl" },
  ptax: { rotulo: "Premissas", rota: "/premissas" },
  cotas: { rotulo: "Ver TRM × extratos", aba: "extratos" },
  mercado: { rotulo: "Premissas", rota: "/premissas" },
};

export function R12Conciliacao() {
  const { premissas: p } = usePremissas();
  const db = p.dataBase;
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const [aba, setAba] = useState<Aba>("gl");
  const [tipoGL, setTipoGL] = useState<TipoContrato | null>(null);
  const [filtroGL, setFiltroGL] = useState<"todas" | "diferencas">("todas");
  const [tipoExt, setTipoExt] = useState<TipoContrato | null>(null);
  const [filtroExt, setFiltroExt] = useState<"todos" | "diferencas">("todos");

  const d = useMemo(() => montarConciliacao(db, p, escopo), [db, p, escopo]);

  const escopoLabel = ESCOPOS.find((e) => e.value === escopo)?.label ?? "";
  const inicioMes = addDays(d.inicio, 1);
  const contasOk = d.contas.filter((c) => c.status !== "Pendente").length;
  const contasExp = d.contas.filter((c) => c.status === "Diferença explicada").length;
  const extOk = d.extratos.length - d.extPend.length;
  const difGL = d.gl.reduce((s, l) => s + l.diferenca, 0);
  const difPendente = d.glPend.reduce((s, l) => s + l.diferenca, 0) + d.extPend.reduce((s, l) => s + l.diferenca, 0);
  const executadas = d.checklist.filter((e) => e.status !== "Pendente").length;
  const ressalvas = d.checklist.filter((e) => e.status === "Com ressalva").length;
  const aprovacao = d.checklist.find((e) => e.id === "aprovacao")!;
  const aprovado = aprovacao.status === "Concluída";

  const linhasGL = d.gl.filter((l) => (!tipoGL || l.tipo === tipoGL) && (filtroGL === "todas" || l.status !== "Conciliado"));
  const linhasExt = d.extratos.filter((l) => (!tipoExt || l.c.tipo === tipoExt) && (filtroExt === "todos" || l.status !== "Conciliado"));
  const glComDif = d.gl.filter((l) => l.status !== "Conciliado").length;
  const extComDif = d.extratos.filter((l) => l.status !== "Conciliado").length;

  const irPara = (a: Aba) => {
    setAba(a);
    if (a === "gl") {
      setTipoGL(null);
      setFiltroGL(d.glPend.length || d.glExp.length ? "diferencas" : "todas");
    }
    if (a === "extratos") {
      setTipoExt(null);
      setFiltroExt(d.extPend.length || d.extExp.length ? "diferencas" : "todos");
    }
  };

  // -------------------------------------------------------------------------
  // Exportação (uma planilha por aba)
  // -------------------------------------------------------------------------

  const exportar = () => {
    const somaGL = (fn: (l: LinhaGL) => number) => d.gl.reduce((s, l) => s + fn(l), 0);
    const somaExt = (fn: (l: LinhaExtrato) => number) => d.extratos.reduce((s, l) => s + fn(l), 0);
    const movs = d.porTipo.map((t) => t.mov);
    const linhaRF = (rotulo: string, fn: (m: MovMestre) => number) => [rotulo, ...movs.map(fn), fn(d.mov.total)];
    const idxTipo = (t: TipoContrato) => TIPOS_CONTRATO.findIndex((x) => x.tipo === t);
    const sinalEvento = (e: EventoMestre) => (e.tipo === "Aplicação" ? 1 : -1);
    exportarExcel(
      `R12_Conciliacao_Fim_de_Mes_${db}.xlsx`,
      [
        {
          nome: "TRM x FI-GL",
          titulo: "R12 – Conciliação TRM × FI-GL por conta contábil e tipo de contrato",
          subtitulo: `${escopoLabel} · saldos em R$ · diferença = FI-GL − TRM`,
          colunas: [
            { titulo: "Conta", largura: 11 },
            { titulo: "Descrição", largura: 46 },
            { titulo: "Tipo de contrato", largura: 22 },
            { titulo: "Contratos", tipo: "inteiro", largura: 11 },
            { titulo: "Saldo TRM (R$)", tipo: "moeda", largura: 18 },
            { titulo: "Saldo FI-GL (R$)", tipo: "moeda", largura: 18 },
            { titulo: "Diferença (R$)", tipo: "moeda", largura: 15 },
            { titulo: "Status", largura: 20 },
            { titulo: "Justificativa", largura: 110 },
          ],
          linhas: d.gl.map((l) => [l.conta.conta, l.conta.descricao, l.tipo, l.contratos, l.saldoTRM, l.saldoGL, l.diferenca, l.status, l.motivo ?? ""]),
          total: [
            "Total",
            "",
            "",
            d.contratos.length,
            somaGL((l) => l.saldoTRM),
            somaGL((l) => l.saldoGL),
            somaGL((l) => l.diferenca),
            `${contasOk}/${d.contas.length} contas sem pendência`,
            "",
          ],
          notas: [
            "Plano de contas do ambiente de teste (fictício). Saldo TRM = valor contábil da Carteira-Mestre: curva (custo amortizado) e mercado (valor justo – CPC 48), com o ajuste a valor justo separado nas contas 1.x.x.09.",
            `Tolerância: diferenças de até ${TOLERANCIA_TXT} por linha são arredondamento (conciliado). Diferença explicada = timing identificado, não bloqueia a aprovação; pendente = bloqueia a aprovação.`,
            ...d.planoResumo.filter((x) => Math.abs(x.saldoTRM) < 0.005).map((x) => `Conta ${x.conta.conta} (${x.conta.descricao}) sem saldo na data-base.`),
          ],
        },
        {
          nome: "TRM x Extratos",
          titulo: "R12 – Conciliação TRM × extratos por contrato",
          subtitulo: `${escopoLabel} · diferença = extrato − TRM`,
          colunas: [
            { titulo: "Contrato", largura: 11 },
            { titulo: "Tipo de contrato", largura: 22 },
            { titulo: "Produto", largura: 34 },
            { titulo: "Contraparte", largura: 26 },
            { titulo: "Fonte do extrato", largura: 50 },
            { titulo: "Base", largura: 20 },
            { titulo: "Saldo TRM (R$)", tipo: "moeda", largura: 18 },
            { titulo: "Saldo extrato (R$)", tipo: "moeda", largura: 18 },
            { titulo: "Diferença (R$)", tipo: "moeda", largura: 15 },
            { titulo: "Moeda", largura: 8 },
            { titulo: "Saldo TRM (ME)", tipo: "moeda", largura: 16 },
            { titulo: "Extrato (ME)", tipo: "moeda", largura: 16 },
            { titulo: "Diferença (ME)", tipo: "moeda", largura: 14 },
            { titulo: "Status", largura: 20 },
            { titulo: "Justificativa", largura: 110 },
          ],
          linhas: d.extratos.map((l) => {
            const me = l.detalhe?.tipo === "td" ? l.detalhe : null;
            return [
              l.c.codigo,
              l.c.tipo,
              l.c.produto,
              l.c.contraparte,
              l.fonte,
              l.base,
              l.saldoTRM,
              l.saldoExtrato,
              l.diferenca,
              l.c.moeda,
              me ? me.saldoTRMME : null,
              me ? me.saldoExtratoME : null,
              me ? me.saldoExtratoME - me.saldoTRMME : null,
              l.status,
              l.motivo ?? "",
            ];
          }),
          total: [
            "Total",
            "",
            "",
            "",
            "",
            "",
            somaExt((l) => l.saldoTRM),
            somaExt((l) => l.saldoExtrato),
            somaExt((l) => l.diferenca),
            "",
            null,
            null,
            null,
            `${extOk}/${d.extratos.length} sem pendência`,
            "",
          ],
          notas: [
            "Base de comparação: curva (renda fixa bancária), mercado – PU ANBIMA × quantidade (títulos públicos), cota × quantidade (fundos) e saldo em moeda × PTAX de fechamento (time deposits).",
            `Saldos do TRM apurados com as séries importadas do SAP até a data-base (último dado disponível: ${fmtDate(ultimoDadoNaDataBase(db))}); a conciliação não usa valores projetados.`,
          ],
        },
        {
          nome: "Roll-forward",
          titulo: `R12 – Roll-forward do mês (${fmtDate(inicioMes)} a ${fmtDate(db)}) por tipo de contrato`,
          subtitulo: `${escopoLabel} · saldo bruto em R$ (curva, cota ou ME × PTAX)`,
          colunas: [
            { titulo: "Movimentação", largura: 64 },
            ...TIPOS_CONTRATO.map((t) => ({ titulo: `${t.curto} (R$)`, tipo: "moeda" as const, largura: 18 })),
            { titulo: "Total (R$)", tipo: "moeda", largura: 18 },
          ],
          linhas: [
            linhaRF(`Saldo inicial em ${fmtDate(d.inicio)}`, (m) => m.saldoInicial),
            linhaRF("(+) Aplicações", (m) => m.aplicacoes),
            linhaRF("(+) Rendimentos (juros na curva, valorização da cota e variação cambial)", (m) => m.rendimentos),
            linhaRF("(−) Resgates brutos (resgates, cupons e vencimentos)", (m) => -m.resgatesBrutos),
            linhaRF("(−) Come-cotas (IR recolhido com redução de cotas)", (m) => -m.comeCotas),
            linhaRF(`Saldo final em ${fmtDate(db)}`, (m) => m.saldoFinal),
            ["Saldo bruto da Carteira-Mestre na data-base", ...d.porTipo.map((t) => t.carteira), d.saldoCarteira],
            ["Diferença (saldo final − Carteira-Mestre)", ...d.porTipo.map((t) => t.mov.saldoFinal - t.carteira), d.difSaldoFinal],
            linhaRF("Memória: IRRF retido (resgates, cupons e come-cotas)", (m) => m.irrf),
            linhaRF("Memória: IOF retido", (m) => m.iof),
            linhaRF("Memória: resgates líquidos creditados em conta", (m) => m.resgatesLiquidos),
            [],
            [`Eventos do mês (${d.mov.eventos.length})`],
            ...d.mov.eventos.map((e) => {
              const valores: (number | null)[] = TIPOS_CONTRATO.map(() => null);
              valores[idxTipo(e.tipoContrato)] = sinalEvento(e) * e.bruto;
              return [`${fmtDate(e.data)} · ${e.tipo} · ${e.codigo} · ${e.produto} · ${e.contraparte}`, ...valores, sinalEvento(e) * e.bruto];
            }),
          ],
          notas: d.checagens.map((c, i) => `Checagem ${i + 1} – ${c.descricao}: ${c.ok ? "OK" : "Falha"} (${c.detalhe}).`),
        },
        {
          nome: "Checklist",
          titulo: `R12 – Checklist de fechamento (DU-1 a DU+3) – ${fmtMonthLong(db)}`,
          subtitulo: `${executadas} de ${d.checklist.length} etapas executadas · DU0 = último dia útil do mês (${fmtDate(d.du0)})`,
          colunas: [
            { titulo: "Dia", largura: 8 },
            { titulo: "Data", tipo: "data", largura: 12 },
            { titulo: "Etapa", largura: 90 },
            { titulo: "Transação SAP", largura: 14 },
            { titulo: "Responsável", largura: 16 },
            { titulo: "Status", largura: 14 },
            { titulo: "Observação", largura: 90 },
          ],
          linhas: d.checklist.map((e) => [rotuloDU(e.du), e.data, e.etapa, e.transacao ?? "", e.responsavel, e.status, e.nota ?? ""]),
        },
      ],
      db,
    );
  };

  // -------------------------------------------------------------------------
  // Colunas
  // -------------------------------------------------------------------------

  const somaLinhas = <T,>(rows: T[], fn: (l: T) => number) => rows.reduce((s, l) => s + fn(l), 0);

  const colGL: Column<LinhaGL>[] = [
    {
      key: "conta",
      header: "Conta contábil",
      minWidth: 250,
      value: (l) => l.conta.conta,
      render: (l) => (
        <div className="py-0.5">
          <div className="font-semibold tabular text-text">{l.conta.conta}</div>
          <div className="text-xs text-label leading-snug mt-0.5">{l.conta.descricao}</div>
        </div>
      ),
      total: (rows) => <span>Total · {plural(new Set(rows.map((l) => l.conta.conta)).size, "conta", "contas")}</span>,
    },
    { key: "tipo", header: "Tipo de contrato", minWidth: 130, value: (l) => l.tipo, render: (l) => <TagTipo tipo={l.tipo} /> },
    {
      key: "contratos",
      header: "Contratos",
      align: "right",
      minWidth: 80,
      value: (l) => l.contratos,
      render: (l) => l.contratos,
    },
    {
      key: "trm",
      header: "Saldo TRM (R$)",
      headerTitle: "Valor contábil da Carteira-Mestre",
      align: "right",
      minWidth: 140,
      value: (l) => l.saldoTRM,
      render: (l) => fmtValor(l.saldoTRM),
      total: (rows) => fmtValor(somaLinhas(rows, (l) => l.saldoTRM)),
    },
    {
      key: "gl",
      header: "Saldo FI-GL (R$)",
      align: "right",
      minWidth: 140,
      value: (l) => l.saldoGL,
      render: (l) => fmtValor(l.saldoGL),
      total: (rows) => fmtValor(somaLinhas(rows, (l) => l.saldoGL)),
    },
    {
      key: "dif",
      header: "Diferença (R$)",
      headerTitle: "FI-GL − TRM",
      align: "right",
      minWidth: 115,
      value: (l) => l.diferenca,
      render: (l) => <Diferenca valor={l.diferenca} status={l.status} />,
      total: (rows) => (
        <Diferenca
          valor={somaLinhas(rows, (l) => l.diferenca)}
          status={rows.some((l) => l.status === "Pendente") ? "Pendente" : rows.some((l) => l.status === "Diferença explicada") ? "Diferença explicada" : "Conciliado"}
          forte
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      minWidth: 170,
      value: (l) => ["Conciliado", "Diferença explicada", "Pendente"].indexOf(l.status),
      render: (l) => <ObjectStatus state={STATUS_STATE[l.status]}>{l.status}</ObjectStatus>,
    },
    {
      key: "motivo",
      header: "Justificativa",
      minWidth: 280,
      sortable: false,
      render: (l) => <Justificativa texto={l.motivo} status={l.status} />,
    },
  ];

  const colExt: Column<LinhaExtrato>[] = [
    {
      key: "contrato",
      header: "Contrato · fonte do extrato",
      minWidth: 250,
      value: (l) => l.c.codigo,
      render: (l) => (
        <div className="py-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-text tabular">{l.c.codigo}</span>
            <span className="text-[13px] text-text">{l.c.produto}</span>
          </div>
          <div className="text-xs text-label leading-snug mt-0.5">{l.fonte}</div>
        </div>
      ),
      total: (rows) => <span>Total · {plural(rows.length, "extrato", "extratos")}</span>,
    },
    {
      key: "base",
      header: "Tipo · base",
      minWidth: 150,
      value: (l) => l.c.tipo,
      render: (l) => (
        <div className="py-0.5">
          <TagTipo tipo={l.c.tipo} />
          <div className="text-xs text-label mt-1 whitespace-nowrap">{l.base}</div>
        </div>
      ),
    },
    {
      key: "trm",
      header: "Saldo TRM (R$)",
      align: "right",
      minWidth: 135,
      value: (l) => l.saldoTRM,
      render: (l) => fmtValor(l.saldoTRM),
      total: (rows) => fmtValor(somaLinhas(rows, (l) => l.saldoTRM)),
    },
    {
      key: "extrato",
      header: "Saldo extrato (R$)",
      align: "right",
      minWidth: 135,
      value: (l) => l.saldoExtrato,
      render: (l) => fmtValor(l.saldoExtrato),
      total: (rows) => fmtValor(somaLinhas(rows, (l) => l.saldoExtrato)),
    },
    {
      key: "dif",
      header: "Diferença (R$)",
      headerTitle: "Extrato − TRM",
      align: "right",
      minWidth: 110,
      value: (l) => l.diferenca,
      render: (l) => <Diferenca valor={l.diferenca} status={l.status} />,
      total: (rows) => (
        <Diferenca
          valor={somaLinhas(rows, (l) => l.diferenca)}
          status={rows.some((l) => l.status === "Pendente") ? "Pendente" : rows.some((l) => l.status === "Diferença explicada") ? "Diferença explicada" : "Conciliado"}
          forte
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      minWidth: 170,
      value: (l) => ["Conciliado", "Diferença explicada", "Pendente"].indexOf(l.status),
      render: (l) => <ObjectStatus state={STATUS_STATE[l.status]}>{l.status}</ObjectStatus>,
    },
    {
      key: "motivo",
      header: "Justificativa",
      minWidth: 280,
      sortable: false,
      render: (l) => <Justificativa texto={l.motivo} status={l.status} />,
    },
  ];

  const colEventos: Column<EventoMestre>[] = [
    { key: "data", header: "Data", minWidth: 95, value: (e) => e.data, render: (e) => <span className="tabular whitespace-nowrap">{fmtDate(e.data)}</span> },
    { key: "evento", header: "Evento", minWidth: 105, value: (e) => e.tipo, render: (e) => <Tag>{e.tipo}</Tag> },
    { key: "tipo", header: "Tipo de contrato", minWidth: 130, value: (e) => e.tipoContrato, render: (e) => <TagTipo tipo={e.tipoContrato} /> },
    {
      key: "contrato",
      header: "Contrato",
      minWidth: 220,
      value: (e) => e.codigo,
      render: (e) => (
        <div className="py-0.5">
          <div className="font-semibold tabular">{e.codigo}</div>
          <div className="text-xs text-label leading-snug">
            {e.produto} · {e.contraparte}
          </div>
        </div>
      ),
    },
    { key: "bruto", header: "Valor bruto (R$)", align: "right", minWidth: 130, value: (e) => e.bruto, render: (e) => fmtValor(e.bruto) },
    { key: "ir", header: "IR (R$)", align: "right", minWidth: 100, value: (e) => e.ir, render: (e) => (e.ir ? fmtValor(e.ir) : "–") },
    { key: "iof", header: "IOF (R$)", align: "right", minWidth: 90, value: (e) => e.iof, render: (e) => (e.iof ? fmtValor(e.iof) : "–") },
    { key: "liquido", header: "Líquido (R$)", align: "right", minWidth: 130, value: (e) => e.liquido, render: (e) => fmtValor(e.liquido) },
  ];

  // -------------------------------------------------------------------------
  // Resumos por tipo de contrato (cartões de filtro)
  // -------------------------------------------------------------------------

  const cartoesGL = TIPOS_CONTRATO.map((t) => {
    const ls = d.gl.filter((l) => l.tipo === t.tipo);
    return {
      tipo: t.tipo,
      rotulo: t.curto,
      cor: t.cor,
      sub: plural(ls.length, "linha contábil", "linhas contábeis"),
      valor: ls.reduce((s, l) => s + l.saldoTRM, 0),
      vazio: ls.length === 0,
      pendentes: ls.filter((l) => l.status === "Pendente").length,
      explicadas: ls.filter((l) => l.status === "Diferença explicada").length,
    };
  });

  const cartoesExt = TIPOS_CONTRATO.map((t) => {
    const ls = d.extratos.filter((l) => l.c.tipo === t.tipo);
    return {
      tipo: t.tipo,
      rotulo: t.curto,
      cor: t.cor,
      sub: `${FONTE_TIPO[t.tipo]} · ${ls.length}`,
      valor: ls.reduce((s, l) => s + l.saldoTRM, 0),
      vazio: ls.length === 0,
      pendentes: ls.filter((l) => l.status === "Pendente").length,
      explicadas: ls.filter((l) => l.status === "Diferença explicada").length,
    };
  });

  const titulos = d.extratos.filter((l) => l.detalhe?.tipo === "titulo" && (!tipoExt || tipoExt === "Tesouro Direto"));
  const fundos = d.extratos.filter((l) => l.detalhe?.tipo === "fundo" && (!tipoExt || tipoExt === "Fundo de investimento"));
  const timeDeposits = d.extratos.filter((l) => l.detalhe?.tipo === "td" && (!tipoExt || tipoExt === "Time deposit"));

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi
            label="Contas conciliadas"
            value={`${contasOk}/${d.contas.length}`}
            state={contasOk < d.contas.length ? "negative" : "positive"}
            sub={contasExp ? `${plural(contasExp, "com diferença explicada", "com diferenças explicadas")}` : "TRM × FI-GL"}
          />
          <HeaderKpi
            label="Diferença TRM × FI-GL"
            value={fmtDifBRL(difGL)}
            state={d.glPend.length ? "negative" : Math.abs(difGL) > TOLERANCIA ? "critical" : "positive"}
            sub="FI-GL − TRM (líquida)"
          />
          <HeaderKpi
            label="Diferenças pendentes"
            value={String(d.glPend.length + d.extPend.length)}
            state={d.glPend.length + d.extPend.length ? "negative" : "positive"}
            sub={d.glPend.length + d.extPend.length ? `${fmtDifBRL(difPendente)} a regularizar` : "nenhuma a regularizar"}
          />
          <HeaderKpi
            label="Extratos conciliados"
            value={`${extOk}/${d.extratos.length}`}
            state={d.extPend.length ? "negative" : "positive"}
            sub={d.extExp.length ? plural(d.extExp.length, "com diferença explicada", "com diferenças explicadas") : "TRM × extratos"}
          />
          <HeaderKpi
            label="Roll-forward"
            value={d.rollforwardOk ? "OK" : "Falha"}
            state={d.rollforwardOk ? "positive" : "negative"}
            sub={`diferença R$ ${fmtDec(Math.max(d.difIdentidade, Math.abs(d.difSaldoFinal)), 2)}`}
          />
          <HeaderKpi
            label="Etapas concluídas"
            value={`${executadas}/${d.checklist.length}`}
            state={aprovado ? "positive" : "critical"}
            sub={aprovado ? `aprovado · ${plural(ressalvas, "ressalva", "ressalvas")}` : `aprovação pendente · ${plural(ressalvas, "ressalva", "ressalvas")}`}
          />
        </>
      }
      headerExtra={
        <div className="border-b border-line-soft -mb-5">
          <TabBar
            value={aba}
            onChange={setAba}
            items={[
              { value: "gl", label: "TRM × FI-GL", count: d.gl.length },
              { value: "extratos", label: "TRM × extratos", count: d.extratos.length },
              { value: "rollforward", label: "Roll-forward" },
              { value: "checklist", label: "Checklist", count: d.checklist.length },
            ]}
          />
        </div>
      }
    >
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <FilterField label="Empresa">
            <Select
              value={escopo}
              onChange={(v) => {
                setEscopo(v);
                setTipoGL(null);
                setTipoExt(null);
              }}
              options={ESCOPOS}
            />
          </FilterField>
          <div className="sm:col-span-2 text-[13px] text-label sm:text-right leading-relaxed">
            Fechamento de <strong className="text-text">{fmtMonthLong(db)}</strong> ({fmtDate(inicioMes)} a {fmtDate(db)}) · tolerância de{" "}
            {TOLERANCIA_TXT} por linha · plano de contas do ambiente de teste
          </div>
        </div>
      </div>

      {/* Resumo das pendências */}
      {d.qtdPendencias === 0 ? (
        <MessageStrip design="positive">
          <strong>Fechamento de {fmtMonthLong(db)} sem pendências:</strong> {contasOk} de {plural(d.contas.length, "conta", "contas")} TRM × FI-GL e{" "}
          {extOk} de {plural(d.extratos.length, "extrato", "extratos")} conciliados
          {d.glExp.length + d.extExp.length > 0 &&
            ` (${plural(d.glExp.length + d.extExp.length, "diferença temporária ou de precificação explicada", "diferenças temporárias ou de precificação explicadas")})`}
          , roll-forward fechado com diferença de R$&nbsp;0,00 e {executadas} de {d.checklist.length} etapas do checklist executadas –{" "}
          {aprovado ? `período aprovado pela Controladoria em ${fmtDate(aprovacao.data)}` : "período pronto para aprovação"}.
        </MessageStrip>
      ) : (
        <Card
          title="Pendências do fechamento"
          subtitle={`${fmtMonthLong(db)} · diferenças sem explicação aceita bloqueiam a aprovação da Controladoria`}
          icon={<AlertTriangle className="w-5 h-5 text-critical-strong" aria-hidden />}
          status={
            <ObjectStatus state="negative" inverted>
              {plural(d.qtdPendencias, "pendência", "pendências")}
            </ObjectStatus>
          }
          bodyClassName="px-4 pb-3"
        >
          <ul className="border-t border-line-soft divide-y divide-line-soft text-[13px] text-text">
            {d.glPend.map((l) => (
              <li key={l.chave} className="flex items-start gap-2 py-2">
                <XCircle className="w-4 h-4 text-negative shrink-0 mt-0.5" aria-label="Pendente" />
                <span className="min-w-0 leading-relaxed">
                  Conta <strong className="tabular">{l.conta.conta}</strong> ({l.conta.descricao.toLowerCase()}): FI-GL{" "}
                  {fmtBRL(Math.abs(l.diferenca), true)} {l.diferenca < 0 ? "menor" : "maior"} que o TRM – apropriação da TPM44 não
                  contabilizada. <LinkAcao onClick={() => irPara("gl")}>Ver conciliação</LinkAcao>
                </span>
              </li>
            ))}
            {d.extPend.map((l) => (
              <li key={l.c.id} className="flex items-start gap-2 py-2">
                <XCircle className="w-4 h-4 text-negative shrink-0 mt-0.5" aria-label="Pendente" />
                <span className="min-w-0 leading-relaxed">
                  Extrato do <strong>{l.c.codigo}</strong> ({l.c.produto} {l.c.contraparte}): saldo {fmtBRL(Math.abs(l.diferenca), true)}{" "}
                  {l.diferenca < 0 ? "menor" : "maior"} que o TRM – taxa divergente. <LinkAcao onClick={() => irPara("extratos")}>Ver conciliação</LinkAcao>
                </span>
              </li>
            ))}
            {d.checagensFalha.map((c) => (
              <li key={c.id} className="flex items-start gap-2 py-2">
                <XCircle className="w-4 h-4 text-negative shrink-0 mt-0.5" aria-label="Falha" />
                <span className="min-w-0 leading-relaxed">
                  {c.descricao}: {c.detalhe}. <LinkAcao onClick={() => irPara("rollforward")}>Ver checagens</LinkAcao>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-label leading-relaxed border-t border-line-soft pt-2">
            {d.glExp.length + d.extExp.length > 0 &&
              `${plural(d.glExp.length + d.extExp.length, "diferença explicada (timing ou fonte de preço) não bloqueia", "diferenças explicadas (timing ou fonte de preço) não bloqueiam")} a aprovação. `}
            A aprovação da Controladoria ({rotuloDU(aprovacao.du)}, {fmtDate(aprovacao.data)}) aguarda a regularização.
          </p>
        </Card>
      )}

      {/* ------------------------------------------------------------------ TRM × FI-GL */}
      {aba === "gl" && (
        <>
          <CartoesTipo itens={cartoesGL} ativo={tipoGL} onSelect={setTipoGL} rotuloValor="valor contábil" />

          <Card
            title="Conciliação TRM × FI-GL por conta contábil e tipo de contrato"
            subtitle={`Saldos em R$ em ${fmtDate(db)} · TRM = valor contábil da Carteira-Mestre · diferença = FI-GL − TRM`}
            bodyClassName="px-0! pb-0!"
            className="min-w-0 overflow-hidden"
          >
            <BarraFiltro
              texto={
                <>
                  {linhasGL.length} de {plural(d.gl.length, "linha", "linhas")}
                  {tipoGL && (
                    <>
                      {" "}
                      · <strong className="text-text">{metaTipo(tipoGL).curto}</strong> ·{" "}
                      <button type="button" className="text-link font-semibold hover:underline" onClick={() => setTipoGL(null)}>
                        Limpar filtro
                      </button>
                    </>
                  )}
                </>
              }
              valor={filtroGL}
              onChange={setFiltroGL}
              itens={[
                { value: "todas", label: "Todas" },
                { value: "diferencas", label: `Com diferença (${glComDif})` },
              ]}
            />

            <div className="hidden lg:block border-t border-line-soft">
              <DataTable
                columns={colGL}
                rows={linhasGL}
                rowKey={(l) => l.chave}
                showTotals
                rowClassName={(l) => destaqueLinha(l.status)}
                emptyText="Nenhuma linha com diferença no filtro selecionado"
              />
            </div>

            <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
              {linhasGL.length === 0 && <li className="px-4 py-8 text-center text-sm text-label">Nenhuma linha com diferença no filtro selecionado</li>}
              {linhasGL.map((l) => (
                <li key={l.chave} className={clsx("px-4 py-3", destaquePopIn(l.status))}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-text tabular">{l.conta.conta}</span>
                        <TagTipo tipo={l.tipo} />
                      </div>
                      <div className="text-xs text-label leading-snug mt-0.5">
                        {l.conta.descricao} · {plural(l.contratos, "contrato", "contratos")}
                      </div>
                    </div>
                    <ObjectStatus state={STATUS_STATE[l.status]}>{l.status === "Diferença explicada" ? "Explicada" : l.status}</ObjectStatus>
                  </div>
                  <PopInValores rotulo="FI-GL (R$)" trm={l.saldoTRM} outro={l.saldoGL} dif={l.diferenca} status={l.status} />
                  {l.motivo && l.status !== "Conciliado" && <p className="text-xs text-text leading-snug mt-2">{l.motivo}</p>}
                </li>
              ))}
              {linhasGL.length > 0 && (
                <li className="px-4 py-3 bg-[#f5f6f7]">
                  <div className="text-sm font-bold text-text">Total · {plural(new Set(linhasGL.map((l) => l.conta.conta)).size, "conta", "contas")}</div>
                  <PopInValores
                    rotulo="FI-GL (R$)"
                    trm={somaLinhas(linhasGL, (l) => l.saldoTRM)}
                    outro={somaLinhas(linhasGL, (l) => l.saldoGL)}
                    dif={somaLinhas(linhasGL, (l) => l.diferenca)}
                    status={linhasGL.some((l) => l.status === "Pendente") ? "Pendente" : "Conciliado"}
                    forte
                  />
                </li>
              )}
            </ul>

            <ul className="text-xs text-label px-4 py-3 space-y-1 leading-relaxed border-t border-line-soft">
              <li>
                (i) Saldo TRM = valor contábil da Carteira-Mestre: curva nos contratos ao custo amortizado e mercado nos contratos a
                valor justo (CPC 48), com o ajuste a valor justo (mercado − curva) nas contas 1.1.2.09 e 1.2.1.09. O total (
                {fmtBRL(d.valorContabil, true)}) é o valor contábil da{" "}
                <Link to="/carteira-mestre" className="text-link hover:underline">
                  Carteira-Mestre
                </Link>
                .
              </li>
              <li>
                (ii) Saldo FI-GL = saldo das contas no razão (ambiente de teste) após TBB1, TPM44 e TPM1. Diferenças de até{" "}
                <strong className="text-text">{TOLERANCIA_TXT}</strong> por linha são arredondamento; diferença explicada (timing)
                não bloqueia a aprovação; pendente bloqueia.
              </li>
              <li>
                (iii) Contrapartidas no FI-GL: juros e variação cambial no resultado financeiro, MTM dos contratos VJORA no
                patrimônio líquido (ajuste de avaliação patrimonial), MTM dos VJPR no resultado e come-cotas em IRRF a compensar.
              </li>
            </ul>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <Card
              className="xl:col-span-2 min-w-0 overflow-hidden"
              title="Plano de contas e determinação de contas"
              subtitle="Plano de contas do ambiente de teste (fictício) · conta por tipo de contrato, circulante × não circulante e componente"
              bodyClassName="px-0! pb-0!"
            >
              <div className="overflow-x-auto fiori-scroll border-t border-line-soft">
                <table className="w-full text-[13px] min-w-[640px]">
                  <thead>
                    <tr className="text-left text-text">
                      <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd]">Conta</th>
                      <th className="font-semibold px-3 py-2 border-b border-[#a8b2bd]">Regra de determinação</th>
                      <th className="font-semibold px-3 py-2 border-b border-[#a8b2bd] text-right">Contratos</th>
                      <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd] text-right whitespace-nowrap">Saldo TRM (R$)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.planoResumo.map((x) => {
                      const semSaldo = x.contratos === 0;
                      return (
                        <tr key={x.conta.conta} className={clsx(semSaldo && "text-label")}>
                          <td className="px-4 py-2 border-b border-line-soft align-top">
                            <div className={clsx("font-semibold tabular", semSaldo ? "text-label" : "text-text")}>{x.conta.conta}</div>
                            <div className="text-xs text-label leading-snug">{x.conta.descricao}</div>
                          </td>
                          <td className="px-3 py-2 border-b border-line-soft align-top leading-snug">
                            {x.conta.regra}
                            {x.tipos.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {x.tipos.map((t) => (
                                  <TagTipo key={t} tipo={t} />
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 border-b border-line-soft align-top text-right tabular">{semSaldo ? "–" : x.contratos}</td>
                          <td className="px-4 py-2 border-b border-line-soft align-top text-right tabular whitespace-nowrap">
                            {semSaldo ? "sem saldo" : fmtValor(x.saldoTRM)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#f5f6f7] font-bold text-text">
                      <td className="px-4 py-2 border-t border-[#a8b2bd]" colSpan={2}>
                        Total do ativo – aplicações financeiras
                      </td>
                      <td className="px-3 py-2 border-t border-[#a8b2bd] text-right tabular">{d.contratos.length}</td>
                      <td className="px-4 py-2 border-t border-[#a8b2bd] text-right tabular whitespace-nowrap">{fmtValor(d.valorContabil)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-label px-4 py-3 leading-relaxed">
                Na determinação de contas do TRM, a referência de atribuição de conta separa o tipo de contrato e o prazo (circulante ×
                não circulante); o total de contratos conta cada contrato uma vez, embora os contratos a valor justo tenham também a
                linha de ajuste MTM.
              </p>
            </Card>

            <Card title="Natureza das diferenças" subtitle="TRM × FI-GL · FI-GL − TRM">
              <ul className="space-y-3 text-[13px]">
                {d.naturezas.map((n) => (
                  <li key={n.natureza} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <ObjectStatus state={n.natureza === "pendente" ? (n.qtd ? "negative" : "neutral") : n.qtd ? "critical" : "neutral"}>
                        {n.natureza === "pendente" ? "Pendente" : "Explicada (timing)"}
                      </ObjectStatus>
                      <div className="text-xs text-label mt-0.5">{n.qtd ? plural(n.qtd, "item", "itens") : "nenhum item"}</div>
                    </div>
                    <span className={clsx("tabular font-semibold whitespace-nowrap", n.natureza === "pendente" && n.qtd ? "text-negative" : "text-text")}>
                      {fmtDifBRL(n.valor)}
                    </span>
                  </li>
                ))}
                <li className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <ObjectStatus state="positive">Arredondamento</ObjectStatus>
                    <div className="text-xs text-label mt-0.5">centavos por contrato · dentro da tolerância</div>
                  </div>
                  <span className="tabular font-semibold whitespace-nowrap text-text">{fmtDifBRL(d.arredondamentoGL)}</span>
                </li>
                <li className="flex items-baseline justify-between gap-3 border-t border-line-soft pt-3">
                  <span className="font-bold text-text">Diferença total</span>
                  <span className={clsx("tabular font-bold whitespace-nowrap", d.glPend.length ? "text-negative" : "text-text")}>{fmtDifBRL(difGL)}</span>
                </li>
              </ul>
              <p className="text-xs text-label mt-4 leading-relaxed">
                Timing: lançamento em D+1 (variação cambial do último dia útil dos time deposits e come-cotas informado pelo
                administrador) – regulariza no mês seguinte. Pendente: erro de processamento que exige correção antes da aprovação.
              </p>
            </Card>
          </div>
        </>
      )}

      {/* ------------------------------------------------------------------ TRM × extratos */}
      {aba === "extratos" && (
        <>
          <CartoesTipo itens={cartoesExt} ativo={tipoExt} onSelect={setTipoExt} rotuloValor="saldo TRM" />

          <Card
            title="Conciliação TRM × extratos por contrato"
            subtitle="Saldo TRM na base do extrato: curva (renda fixa), mercado – PU ANBIMA (títulos), cota × quantidade (fundos) e ME × PTAX (time deposits) · diferença = extrato − TRM"
            bodyClassName="px-0! pb-0!"
            className="min-w-0 overflow-hidden"
          >
            <BarraFiltro
              texto={
                <>
                  {linhasExt.length} de {plural(d.extratos.length, "extrato", "extratos")}
                  {tipoExt && (
                    <>
                      {" "}
                      · <strong className="text-text">{metaTipo(tipoExt).curto}</strong> ·{" "}
                      <button type="button" className="text-link font-semibold hover:underline" onClick={() => setTipoExt(null)}>
                        Limpar filtro
                      </button>
                    </>
                  )}
                </>
              }
              valor={filtroExt}
              onChange={setFiltroExt}
              itens={[
                { value: "todos", label: "Todos" },
                { value: "diferencas", label: `Com diferença (${extComDif})` },
              ]}
            />

            <div className="hidden lg:block border-t border-line-soft">
              <DataTable
                columns={colExt}
                rows={linhasExt}
                rowKey={(l) => l.c.id}
                showTotals
                rowClassName={(l) => destaqueLinha(l.status)}
                emptyText="Nenhum extrato com diferença no filtro selecionado"
              />
            </div>

            <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
              {linhasExt.length === 0 && <li className="px-4 py-8 text-center text-sm text-label">Nenhum extrato com diferença no filtro selecionado</li>}
              {linhasExt.map((l) => (
                <li key={l.c.id} className={clsx("px-4 py-3", destaquePopIn(l.status))}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-text tabular">{l.c.codigo}</span>
                        <TagTipo tipo={l.c.tipo} />
                      </div>
                      <div className="text-xs text-label leading-snug mt-0.5">
                        {l.c.produto} · {l.fonte}
                      </div>
                    </div>
                    <ObjectStatus state={STATUS_STATE[l.status]}>{l.status === "Diferença explicada" ? "Explicada" : l.status}</ObjectStatus>
                  </div>
                  <PopInValores rotulo="Extrato (R$)" trm={l.saldoTRM} outro={l.saldoExtrato} dif={l.diferenca} status={l.status} />
                  {l.motivo && l.status !== "Conciliado" && <p className="text-xs text-text leading-snug mt-2">{l.motivo}</p>}
                </li>
              ))}
              {linhasExt.length > 0 && (
                <li className="px-4 py-3 bg-[#f5f6f7]">
                  <div className="text-sm font-bold text-text">Total · {plural(linhasExt.length, "extrato", "extratos")}</div>
                  <PopInValores
                    rotulo="Extrato (R$)"
                    trm={somaLinhas(linhasExt, (l) => l.saldoTRM)}
                    outro={somaLinhas(linhasExt, (l) => l.saldoExtrato)}
                    dif={somaLinhas(linhasExt, (l) => l.diferenca)}
                    status={linhasExt.some((l) => l.status === "Pendente") ? "Pendente" : "Conciliado"}
                    forte
                  />
                </li>
              )}
            </ul>

            <ul className="text-xs text-label px-4 py-3 space-y-1 leading-relaxed border-t border-line-soft">
              <li>
                (i) Fontes: banco emissor (CDB, LCI, LCA, LF e compromissadas) ou B3 (debêntures, CRI e CRA) na curva; B3/agente de
                custódia a mercado para os títulos públicos – inclusive os mantidos ao custo amortizado, cujo valor contábil segue na
                curva; administrador para as cotas; banco no exterior em moeda original para os time deposits.
              </li>
              <li>
                (ii) Diferenças de até <strong className="text-text">{TOLERANCIA_TXT}</strong> são arredondamento (fator truncado, PU
                e cota com casas limitadas). Saldos do TRM apurados com as séries importadas do SAP até a data-base (último dado
                disponível: {fmtDate(ultimoDadoNaDataBase(db))}); a conciliação não usa valores projetados.
              </li>
            </ul>
          </Card>

          {(titulos.length > 0 || fundos.length > 0) && (
            <div className={clsx("grid grid-cols-1 gap-5", titulos.length > 0 && fundos.length > 0 && "xl:grid-cols-2")}>
              {titulos.length > 0 && (
                <Card
                  title="Títulos públicos – PU ANBIMA × PU do custodiante"
                  subtitle={`Quantidade em custódia e PU de ${fmtDate(db)}`}
                  bodyClassName="px-0! pb-0!"
                  className="min-w-0 overflow-hidden"
                >
                  <TabelaDetalhe
                    cabecalho={["Título", "Quantidade", "Taxa ANBIMA", "PU TRM (ANBIMA)", "PU custodiante", "Dif. (R$)"]}
                    linhas={titulos.map((l) => {
                      const x = l.detalhe as DetalheTitulo;
                      return {
                        chave: l.c.id,
                        status: l.status,
                        celulas: [
                          <Rotulo key="t" codigo={l.c.codigo} texto={x.custodiante.replace("B3 · ", "")} />,
                          x.quantidade.toLocaleString("pt-BR"),
                          <span key="tx" title={x.taxaExtrato !== x.taxaTRM ? `Custodiante: ${fmtTaxa(x.taxaExtrato)}` : undefined}>
                            {fmtTaxa(x.taxaTRM)}
                          </span>,
                          fmtDec(x.puTRM, 6),
                          fmtDec(x.puExtrato, 6),
                          <Diferenca key="d" valor={l.diferenca} status={l.status} />,
                        ],
                      };
                    })}
                  />
                </Card>
              )}
              {fundos.length > 0 && (
                <Card
                  title="Fundos – cota do TRM × cota do administrador"
                  subtitle="Cotas de multimercado, ações e cambial divulgadas em D+1"
                  bodyClassName="px-0! pb-0!"
                  className="min-w-0 overflow-hidden"
                >
                  <TabelaDetalhe
                    cabecalho={["Fundo", "Quantidade de cotas", "Cota TRM", "Cota administrador", "Data da cota", "Dif. (R$)"]}
                    linhas={fundos.map((l) => {
                      const x = l.detalhe as DetalheFundo;
                      return {
                        chave: l.c.id,
                        status: l.status,
                        celulas: [
                          <Rotulo key="f" codigo={l.c.codigo} texto={l.c.produto} />,
                          fmtDec(x.quantidadeExtrato, 6),
                          fmtDec(x.cotaTRM, 8),
                          fmtDec(x.cotaExtrato, 8),
                          <span key="dc" className={clsx("whitespace-nowrap", x.d1 && "text-critical font-semibold")}>
                            {fmtDate(x.dataCota)}
                          </span>,
                          <Diferenca key="d" valor={l.diferenca} status={l.status} />,
                        ],
                      };
                    })}
                  />
                </Card>
              )}
            </div>
          )}

          {timeDeposits.length > 0 && (
            <Card
              title="Time deposits – conciliação em moeda estrangeira"
              subtitle={`Saldo em moeda (principal + juros ACT/360) × extrato do banco no exterior · conversão pela PTAX de fechamento de ${fmtDate(d.du0)}`}
              bodyClassName="px-0! pb-0!"
              className="min-w-0 overflow-hidden"
            >
              <TabelaDetalhe
                cabecalho={["Contrato", "Moeda", "Saldo TRM (ME)", "Extrato (ME)", "Data do extrato", "Dif. (ME)", "PTAX", "Dif. (R$)"]}
                linhas={timeDeposits.map((l) => {
                  const x = l.detalhe as DetalheTD;
                  return {
                    chave: l.c.id,
                    status: l.status,
                    celulas: [
                      <Rotulo key="c" codigo={l.c.codigo} texto={x.banco} />,
                      x.moeda,
                      fmtValor(x.saldoTRMME),
                      fmtValor(x.saldoExtratoME),
                      <span key="de" className={clsx("whitespace-nowrap", x.dataExtrato !== db && "text-critical font-semibold")}>
                        {fmtDate(x.dataExtrato)}
                      </span>,
                      <span key="dm" className="whitespace-nowrap">{fmtDif(x.saldoExtratoME - x.saldoTRMME)}</span>,
                      fmtDec(x.ptax, 4),
                      <Diferenca key="d" valor={l.diferenca} status={l.status} />,
                    ],
                  };
                })}
              />
              <p className="text-xs text-label px-4 py-3 leading-relaxed border-t border-line-soft">
                Rendimento no exterior sem IRRF (IRPJ/CSLL sobre o resultado). O extrato é emitido no último dia útil local do banco;
                quando a data-base cai em fim de semana, os juros dos dias corridos seguintes entram no extrato do mês seguinte.
              </p>
            </Card>
          )}
        </>
      )}

      {/* ------------------------------------------------------------------ Roll-forward */}
      {aba === "rollforward" && <AbaRollforward d={d} db={db} colEventos={colEventos} irPara={irPara} />}

      {/* ------------------------------------------------------------------ Checklist */}
      {aba === "checklist" && <AbaChecklist d={d} db={db} executadas={executadas} />}
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Aba Roll-forward
// ---------------------------------------------------------------------------

function AbaRollforward({
  d,
  db,
  colEventos,
  irPara,
}: {
  d: Conciliacao;
  db: string;
  colEventos: Column<EventoMestre>[];
  irPara: (a: Aba) => void;
}) {
  const movs = d.porTipo.map((t) => t.mov);
  const linhas: { rotulo: string; fn: (m: MovMestre) => number; forte?: boolean; memoria?: boolean }[] = [
    { rotulo: `Saldo inicial em ${fmtDate(d.inicio)}`, fn: (m) => m.saldoInicial, forte: true },
    { rotulo: "(+) Aplicações", fn: (m) => m.aplicacoes },
    { rotulo: "(+) Rendimentos", fn: (m) => m.rendimentos },
    { rotulo: "(−) Resgates brutos (resgates, cupons e vencimentos)", fn: (m) => -m.resgatesBrutos },
    { rotulo: "(−) Come-cotas (IR com redução de cotas)", fn: (m) => -m.comeCotas },
    { rotulo: `(=) Saldo final em ${fmtDate(db)}`, fn: (m) => m.saldoFinal, forte: true },
  ];
  const memoria: { rotulo: string; fn: (m: MovMestre) => number }[] = [
    { rotulo: "IRRF retido (resgates, cupons e come-cotas)", fn: (m) => m.irrf },
    { rotulo: "IOF retido", fn: (m) => m.iof },
    { rotulo: "Resgates líquidos creditados em conta", fn: (m) => m.resgatesLiquidos },
  ];

  const grafico = [
    { rubrica: "Aplicações", fn: (m: MovMestre) => m.aplicacoes },
    { rubrica: "Rendimentos", fn: (m: MovMestre) => m.rendimentos },
    { rubrica: "Resgates", fn: (m: MovMestre) => -m.resgatesBrutos },
    { rubrica: "Come-cotas", fn: (m: MovMestre) => -m.comeCotas },
  ].map((g) => ({ rubrica: g.rubrica, ...Object.fromEntries(d.porTipo.map((t) => [t.curto, g.fn(t.mov) / 1e6])) }));

  const checagensOk = d.checagens.filter((c) => c.ok).length;
  const somaEventos = (fn: (e: EventoMestre) => boolean) => d.mov.eventos.filter(fn).reduce((s, e) => s + e.bruto, 0);
  const evAplic = somaEventos((e) => e.tipo === "Aplicação");
  const evResg = somaEventos((e) => e.tipo === "Resgate" || e.tipo === "Vencimento" || e.tipo === "Cupom");
  const evCC = somaEventos((e) => e.tipo === "Come-cotas");
  const eventosBatem =
    Math.abs(evAplic - d.mov.total.aplicacoes) < 0.01 && Math.abs(evResg - d.mov.total.resgatesBrutos) < 0.01 && Math.abs(evCC - d.mov.total.comeCotas) < 0.01;

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card
          className="xl:col-span-2 min-w-0 overflow-hidden"
          title="Roll-forward do mês por tipo de contrato"
          subtitle={`Saldo bruto em R$ (curva, cota ou ME × PTAX) · ${fmtDate(addDays(d.inicio, 1))} a ${fmtDate(db)}`}
          bodyClassName="px-0! pb-0!"
        >
          <div className="overflow-x-auto fiori-scroll border-t border-line-soft">
            <table className="w-full text-[13px] min-w-[760px]">
              <thead>
                <tr className="text-text">
                  <th className="text-left font-semibold px-4 py-2.5 border-b border-[#a8b2bd]">Movimentação</th>
                  {d.porTipo.map((t) => (
                    <th key={t.tipo} className="text-right font-semibold px-3 py-2.5 border-b border-[#a8b2bd] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.cor }} />
                        {t.curto}
                      </span>
                    </th>
                  ))}
                  <th className="text-right font-semibold px-4 py-2.5 border-b border-[#a8b2bd]">Total</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.rotulo} className={clsx(l.forte && "bg-[#f5f6f7] font-bold")}>
                    <td className="px-4 py-2 border-b border-line-soft text-text">{l.rotulo}</td>
                    {movs.map((m, i) => (
                      <td key={i} className="px-3 py-2 border-b border-line-soft text-right tabular whitespace-nowrap">
                        {fmtValor(l.fn(m))}
                      </td>
                    ))}
                    <td className="px-4 py-2 border-b border-line-soft text-right tabular whitespace-nowrap font-semibold">{fmtValor(l.fn(d.mov.total))}</td>
                  </tr>
                ))}
                <tr>
                  <td className="px-4 py-2 border-b border-line-soft text-label">Saldo bruto da Carteira-Mestre em {fmtDate(db)}</td>
                  {d.porTipo.map((t) => (
                    <td key={t.tipo} className="px-3 py-2 border-b border-line-soft text-right tabular whitespace-nowrap text-label">
                      {fmtValor(t.carteira)}
                    </td>
                  ))}
                  <td className="px-4 py-2 border-b border-line-soft text-right tabular whitespace-nowrap text-label">{fmtValor(d.saldoCarteira)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border-b border-line-soft text-text font-semibold">Diferença (saldo final − Carteira-Mestre)</td>
                  {d.porTipo.map((t) => (
                    <td key={t.tipo} className="px-3 py-2 border-b border-line-soft text-right">
                      <Checado ok={Math.abs(t.mov.saldoFinal - t.carteira) < 0.005} valor={t.mov.saldoFinal - t.carteira} />
                    </td>
                  ))}
                  <td className="px-4 py-2 border-b border-line-soft text-right">
                    <Checado ok={Math.abs(d.difSaldoFinal) < 0.005} valor={d.difSaldoFinal} />
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border-b border-line-soft text-text font-semibold">
                    Identidade: SF − (SI + aplicações + rendimentos − resgates − come-cotas)
                  </td>
                  {d.porTipo.map((t) => (
                    <td key={t.tipo} className="px-3 py-2 border-b border-line-soft text-right">
                      <Checado ok={Math.abs(identidade(t.mov)) < 0.005} valor={identidade(t.mov)} />
                    </td>
                  ))}
                  <td className="px-4 py-2 border-b border-line-soft text-right">
                    <Checado ok={Math.abs(identidade(d.mov.total)) < 0.005} valor={identidade(d.mov.total)} />
                  </td>
                </tr>
                {memoria.map((l) => (
                  <tr key={l.rotulo} className="text-label">
                    <td className="px-4 py-1.5 border-b border-line-soft">
                      <span className="text-[11px] uppercase tracking-wide mr-1.5">Memória</span>
                      {l.rotulo}
                    </td>
                    {movs.map((m, i) => (
                      <td key={i} className="px-3 py-1.5 border-b border-line-soft text-right tabular whitespace-nowrap">
                        {fmtValor(l.fn(m))}
                      </td>
                    ))}
                    <td className="px-4 py-1.5 border-b border-line-soft text-right tabular whitespace-nowrap">{fmtValor(l.fn(d.mov.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-label px-4 py-3 leading-relaxed">
            Rendimentos = juros na curva (renda fixa e títulos), valorização da cota líquida de taxas (fundos) e juros + variação
            cambial (time deposits). O saldo inicial é o saldo do fechamento de {fmtDate(d.inicio)} ({fmtBRL(d.saldoAnterior, true)}).
          </p>
        </Card>

        <Card title="Movimentação do mês por tipo" subtitle="R$ milhões · saídas com sinal negativo" className="min-w-0">
          <div className="h-64 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="rubrica" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmtDec(v, 1)} />
                <ReferenceLine y={0} stroke="#556b82" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtCompact(v * 1e6), n]} />
                {d.porTipo.map((t) => (
                  <Bar key={t.tipo} dataKey={t.curto} stackId="mov" fill={t.cor} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-label">
            {d.porTipo.map((t) => (
              <li key={t.tipo} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: t.cor }} />
                {t.curto}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card
          className="xl:col-span-2 min-w-0"
          title="Checagens de integridade"
          subtitle={`${checagensOk} de ${d.checagens.length} checagens OK · Carteira-Mestre × relatórios de origem, MTM, PTAX e cotas`}
          bodyClassName="px-0! pb-0!"
        >
          <ol className="border-t border-line-soft divide-y divide-line-soft">
            {d.checagens.map((c, i) => {
              const link = LINK_CHECAGEM[c.id];
              return (
                <li key={c.id} className={clsx("flex items-start gap-3 px-4 py-3", !c.ok && "bg-[#fff6f9] shadow-[inset_4px_0_0_#f53232]")}>
                  {c.ok ? (
                    <CheckCircle2 className="w-5 h-5 text-positive shrink-0 mt-px" strokeWidth={2} aria-label="OK" />
                  ) : (
                    <XCircle className="w-5 h-5 text-negative shrink-0 mt-px" strokeWidth={2} aria-label="Falha" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text leading-snug">
                      <span className="text-label font-normal tabular mr-1">{i + 1}.</span>
                      {c.descricao}
                    </div>
                    <div className="text-[13px] text-label leading-snug mt-0.5">{c.detalhe}</div>
                    {link && (
                      <div className="mt-1 sm:hidden">
                        <LinkChecagem link={link} onAba={irPara} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <ObjectStatus inverted state={c.ok ? "positive" : "negative"}>
                      {c.ok ? "OK" : "Falha"}
                    </ObjectStatus>
                    {link && (
                      <span className="hidden sm:inline">
                        <LinkChecagem link={link} onAba={irPara} />
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card title="Do saldo bruto ao valor contábil" subtitle={`Carteira-Mestre em ${fmtDate(db)} · R$`} className="min-w-0">
          <dl className="text-[13px] space-y-2">
            <LinhaPonte rotulo="Saldo bruto (roll-forward)" valor={d.saldoCarteira} forte />
            <LinhaPonte rotulo="(+) Ajuste a valor justo – VJORA" valor={d.mtmVJORA} sub="contrapartida no patrimônio líquido" />
            <LinhaPonte rotulo="(+) Ajuste a valor justo – VJPR" valor={d.mtmVJPR} sub="contrapartida no resultado" />
            <div className="border-t border-line-soft pt-2">
              <LinhaPonte rotulo="(=) Valor contábil" valor={d.valorContabil} forte />
            </div>
            <LinhaPonte rotulo="Circulante" valor={d.circulante} recuo />
            <LinhaPonte rotulo="Não circulante" valor={d.valorContabil - d.circulante} recuo />
          </dl>
          <p className="text-xs text-label mt-3 leading-relaxed">
            O valor contábil é o total da aba{" "}
            <button type="button" className="text-link font-semibold hover:underline" onClick={() => irPara("gl")}>
              TRM × FI-GL
            </button>
            . O MTM de {fmtBRL(d.mtmCusto, true)} dos contratos ao custo amortizado não é contabilizado – só entra na divulgação do
            valor justo (CPC 40).
          </p>
        </Card>
      </div>

      <Card
        title="Eventos do mês"
        subtitle={`${plural(d.mov.eventos.length, "evento", "eventos")} da Carteira-Mestre entre ${fmtDate(addDays(d.inicio, 1))} e ${fmtDate(db)} · lançados pela TBB1`}
        bodyClassName="px-0! pb-0!"
        className="min-w-0 overflow-hidden"
      >
        <div className="border-t border-line-soft">
          <DataTable columns={colEventos} rows={d.mov.eventos} rowKey={(e) => `${e.data}|${e.tipo}|${e.codigo}`} emptyText="Nenhum evento no mês" />
        </div>
        <p className={clsx("flex items-start gap-2 text-xs px-4 py-3 leading-relaxed border-t border-line-soft", eventosBatem ? "text-label" : "text-negative")}>
          {eventosBatem ? <CheckCircle2 className="w-3.5 h-3.5 text-positive shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          <span>
            Σ aplicações {fmtBRL(evAplic, true)} · Σ resgates, cupons e vencimentos (bruto) {fmtBRL(evResg, true)} · Σ come-cotas{" "}
            {fmtBRL(evCC, true)} – {eventosBatem ? "iguais ao roll-forward" : "diferentes do roll-forward"}.
          </span>
        </p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Checklist
// ---------------------------------------------------------------------------

function AbaChecklist({ d, db, executadas }: { d: Conciliacao; db: string; executadas: number }) {
  const dias: { du: number; data: string; etapas: EtapaStatus[] }[] = [];
  for (const e of d.checklist) {
    let g = dias.find((x) => x.du === e.du);
    if (!g) {
      g = { du: e.du, data: e.data, etapas: [] };
      dias.push(g);
    }
    g.etapas.push(e);
  }
  const responsaveis = (["Tesouraria", "Contabilidade", "Controladoria"] as Responsavel[]).map((r) => {
    const etapas = d.checklist.filter((e) => e.responsavel === r);
    return {
      responsavel: r,
      total: etapas.length,
      executadas: etapas.filter((e) => e.status !== "Pendente").length,
      ressalvas: etapas.filter((e) => e.status === "Com ressalva").length,
    };
  });
  const completo = executadas === d.checklist.length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <Card
        className="xl:col-span-2 min-w-0"
        title={`Checklist de fechamento – ${fmtMonthLong(db)}`}
        subtitle={`DU0 = último dia útil do mês (${fmtDate(d.du0)}); DU-1 = dia útil anterior; DU+1 a DU+3 = dias úteis seguintes (feriados nacionais – ANBIMA)`}
      >
        <ol>
          {dias.map((g, gi) => {
            const ressalva = g.etapas.some((e) => e.status === "Com ressalva");
            const aberta = g.etapas.some((e) => e.status === "Pendente");
            const cor = aberta ? "#758ca4" : ressalva ? "#e76500" : "#30914c";
            const ultimo = gi === dias.length - 1;
            return (
              <li key={g.du} className="grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] sm:grid-cols-[6.5rem_2rem_minmax(0,1fr)]">
                <div className="text-right pt-2">
                  <div className="text-sm font-bold text-text">{rotuloDU(g.du)}</div>
                  <div className="text-xs text-label tabular">{fmtDate(g.data)}</div>
                  <div className="text-xs text-label hidden sm:block">{diaSemana(g.data)}</div>
                </div>
                <div className="relative flex justify-center" aria-hidden>
                  <span className={clsx("absolute w-0.5 bg-line", gi === 0 ? "top-3.5" : "top-0", ultimo ? "h-3.5" : "bottom-0")} />
                  <span className="relative mt-3 w-3.5 h-3.5 rounded-full border-[3px] bg-white" style={{ borderColor: cor }} />
                </div>
                <ul className={clsx("space-y-2 min-w-0", !ultimo && "pb-5")}>
                  {g.etapas.map((e) => (
                    <li
                      key={e.id}
                      className={clsx(
                        "rounded-lg border px-3 py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4",
                        e.status === "Com ressalva" ? "border-[#e76500]/50 bg-critical-bg/40" : "border-line-soft",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-text leading-snug">{e.etapa}</div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-label">
                          {e.transacao && (
                            <span className="inline-flex items-center gap-1">
                              Transação <Tag>{e.transacao}</Tag>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <UserRound className="w-3.5 h-3.5" />
                            {e.responsavel}
                          </span>
                        </div>
                        {e.nota && (
                          <p className={clsx("text-xs leading-snug mt-1.5", e.status === "Com ressalva" ? "text-text" : "text-label")}>
                            {e.id === "aprovacao" && e.status === "Concluída" ? (
                              <>
                                {e.nota}{" "}
                                <Link to="/r02-movimentacao" className="text-link font-semibold hover:underline whitespace-nowrap">
                                  Ver R02
                                </Link>
                              </>
                            ) : (
                              e.nota
                            )}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        <ObjectStatus inverted state={ETAPA_STATE[e.status]}>
                          {e.status}
                        </ObjectStatus>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="space-y-5 min-w-0">
        <Card title="Andamento do fechamento" subtitle={fmtMonthLong(db)}>
          <div className="flex items-baseline gap-1.5">
            <span className={clsx("text-[2.25rem] leading-none font-light tabular", completo ? "text-positive" : "text-critical")}>
              {executadas}/{d.checklist.length}
            </span>
            <span className="text-sm text-label">etapas executadas</span>
          </div>
          <MicroBar className="mt-3 h-2" value={executadas} max={d.checklist.length} color={completo ? "#30914c" : "#e76500"} />
          <div className="text-[13px] font-semibold text-text mt-5 mb-2">Por responsável</div>
          <ul className="space-y-2.5">
            {responsaveis.map((r) => (
              <li key={r.responsavel}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-text truncate">{r.responsavel}</span>
                  <span className="tabular text-label whitespace-nowrap">
                    <span className="text-text font-semibold">{r.executadas}</span> de {r.total}
                    {r.ressalvas > 0 && <span className="text-critical"> · {plural(r.ressalvas, "ressalva", "ressalvas")}</span>}
                  </span>
                </div>
                <MicroBar className="mt-1.5" value={r.executadas} max={r.total} color={r.executadas === r.total ? "#30914c" : "#e76500"} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Transações SAP do fechamento" subtitle="SAP S/4HANA Treasury and Risk Management">
          <ul className="space-y-3">
            {TRANSACOES_SAP.map((t) => (
              <li key={t.codigo} className="flex items-start gap-3 text-[13px]">
                <span className="w-14 shrink-0">
                  <Tag>{t.codigo}</Tag>
                </span>
                <span className="text-text leading-snug">{t.descricao}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-label mt-3 leading-relaxed">
            A apropriação (TPM44) e a avaliação (TPM1) usam as séries de CDI, IPCA, PTAX e taxas ANBIMA importadas do SAP até a
            data-base (último dado disponível: {fmtDate(ultimoDadoNaDataBase(db))}).
          </p>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componentes auxiliares
// ---------------------------------------------------------------------------

function TagTipo({ tipo }: { tipo: TipoContrato }) {
  const m = metaTipo(tipo);
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold border whitespace-nowrap"
      style={{ color: m.texto, borderColor: m.borda, backgroundColor: m.fundo }}
    >
      {m.curto}
    </span>
  );
}

interface CartaoTipo {
  tipo: TipoContrato;
  rotulo: string;
  cor: string;
  sub: string;
  valor: number;
  vazio: boolean;
  pendentes: number;
  explicadas: number;
}

/** Cartões de resumo por tipo de contrato (filtram a tabela) */
function CartoesTipo({
  itens,
  ativo,
  onSelect,
  rotuloValor,
}: {
  itens: CartaoTipo[];
  ativo: TipoContrato | null;
  onSelect: (t: TipoContrato | null) => void;
  rotuloValor: string;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 no-print">
      {itens.map((g) => {
        const sel = ativo === g.tipo;
        return (
          <button
            key={g.tipo}
            type="button"
            aria-pressed={sel}
            disabled={g.vazio}
            onClick={() => onSelect(sel ? null : g.tipo)}
            className={clsx(
              "text-left bg-white rounded-[var(--radius-card)] shadow-fiori px-3 sm:px-4 py-3 min-w-0 transition-shadow",
              g.vazio ? "opacity-60 cursor-default" : "hover:shadow-fiori-lg",
              sel && "shadow-[inset_0_0_0_2px_#0070f2]!",
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.cor }} />
              <span className="text-sm font-bold text-text truncate">{g.rotulo}</span>
            </div>
            <div className="text-xs text-label truncate mt-0.5" title={g.sub}>
              {g.sub}
            </div>
            <div className="text-lg sm:text-xl font-light text-text tabular mt-1.5 whitespace-nowrap" title={rotuloValor}>
              {g.vazio ? "—" : fmtCompact(g.valor)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mt-1">
              <span className="text-xs text-label">{rotuloValor}</span>
              {g.vazio ? (
                <ObjectStatus state="neutral">Sem saldo</ObjectStatus>
              ) : g.pendentes ? (
                <ObjectStatus state="negative">{plural(g.pendentes, "pendente", "pendentes")}</ObjectStatus>
              ) : g.explicadas ? (
                <ObjectStatus state="critical">{plural(g.explicadas, "explicada", "explicadas")}</ObjectStatus>
              ) : (
                <ObjectStatus state="positive">Conciliado</ObjectStatus>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function BarraFiltro<T extends string>({
  texto,
  valor,
  onChange,
  itens,
}: {
  texto: ReactNode;
  valor: T;
  onChange: (v: T) => void;
  itens: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
      <span className="text-[13px] text-label">{texto}</span>
      <SegmentedButton value={valor} onChange={onChange} items={itens} />
    </div>
  );
}

function Diferenca({ valor, status, forte }: { valor: number; status: StatusConc; forte?: boolean }) {
  const zero = Math.abs(valor) < 0.005;
  return (
    <span
      className={clsx(
        "tabular whitespace-nowrap",
        zero ? "text-label" : status === "Pendente" ? "text-negative font-bold" : status === "Diferença explicada" ? "text-critical font-semibold" : "text-text",
        forte && !zero && "font-bold",
      )}
    >
      {fmtDif(valor)}
    </span>
  );
}

function Justificativa({ texto, status }: { texto: string | null; status: StatusConc }) {
  if (!texto) return <span className="text-label">—</span>;
  return <span className={clsx("text-[13px] leading-snug block", status === "Conciliado" ? "text-label" : "text-text")}>{texto}</span>;
}

/** Pop-in da tabela responsiva: saldo TRM × saldo comparado × diferença */
function PopInValores({
  rotulo,
  trm,
  outro,
  dif,
  status,
  forte,
}: {
  rotulo: string;
  trm: number;
  outro: number;
  dif: number;
  status: StatusConc;
  forte?: boolean;
}) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-3 mt-2 text-[13px]">
      <div className="min-w-0">
        <dt className="text-xs text-label">TRM (R$)</dt>
        <dd className="text-text font-semibold tabular truncate">{fmtValor(trm)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-label">{rotulo}</dt>
        <dd className="text-text font-semibold tabular truncate">{fmtValor(outro)}</dd>
      </div>
      <div className="text-right">
        <dt className="text-xs text-label">Dif. (R$)</dt>
        <dd className="font-semibold">
          <Diferenca valor={dif} status={status} forte={forte} />
        </dd>
      </div>
    </dl>
  );
}

/** Tabela compacta dos detalhes do extrato (títulos, fundos, time deposits) */
function TabelaDetalhe({ cabecalho, linhas }: { cabecalho: string[]; linhas: { chave: string; status: StatusConc; celulas: ReactNode[] }[] }) {
  return (
    <div className="overflow-x-auto fiori-scroll border-t border-line-soft">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-text">
            {cabecalho.map((h, i) => (
              <th
                key={h}
                className={clsx(
                  "font-semibold py-2 border-b border-[#a8b2bd] whitespace-nowrap",
                  i === 0 ? "text-left pl-4 pr-3" : "text-right px-3",
                  i === cabecalho.length - 1 && "pr-4",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.chave} className={clsx(l.status === "Pendente" && "bg-[#fff6f9]")}>
              {l.celulas.map((c, i) => (
                <td
                  key={i}
                  className={clsx(
                    "py-2 border-b border-line-soft align-top",
                    i === 0 ? "text-left pl-4 pr-3" : "text-right px-3 tabular whitespace-nowrap",
                    i === l.celulas.length - 1 && "pr-4",
                    i === 0 && l.status === "Diferença explicada" && "shadow-[inset_4px_0_0_#e76500]",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rotulo({ codigo, texto }: { codigo: string; texto: string }) {
  return (
    <div className="min-w-[8rem]">
      <div className="font-semibold text-text tabular">{codigo}</div>
      <div className="text-xs text-label leading-snug">{texto}</div>
    </div>
  );
}

function Checado({ ok, valor }: { ok: boolean; valor: number }) {
  return (
    <span className={clsx("inline-flex items-center justify-end gap-1 tabular whitespace-nowrap font-semibold", ok ? "text-positive" : "text-negative")}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" aria-label="OK" /> : <XCircle className="w-3.5 h-3.5" aria-label="Falha" />}
      {fmtDif(valor)}
    </span>
  );
}

function LinhaPonte({ rotulo, valor, sub, forte, recuo }: { rotulo: string; valor: number; sub?: string; forte?: boolean; recuo?: boolean }) {
  return (
    <div className={clsx("flex items-baseline justify-between gap-3", recuo && "pl-4 text-label")}>
      <dt className="min-w-0">
        <span className={clsx(forte ? "font-bold text-text" : recuo ? "" : "text-text")}>{rotulo}</span>
        {sub && <span className="block text-xs text-label">{sub}</span>}
      </dt>
      <dd className={clsx("tabular whitespace-nowrap", forte && "font-bold text-text")}>{fmtValor(valor)}</dd>
    </div>
  );
}

function LinkAcao({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-link font-semibold hover:underline whitespace-nowrap">
      {children}
    </button>
  );
}

function LinkChecagem({ link, onAba }: { link: { rotulo: string; rota?: string; aba?: Aba }; onAba: (a: Aba) => void }) {
  const cls = "inline-flex items-center gap-1 text-xs text-link font-semibold hover:underline whitespace-nowrap";
  if (link.aba) {
    const aba = link.aba;
    return (
      <button type="button" className={cls} onClick={() => onAba(aba)}>
        {link.rotulo}
        <ArrowRight className="w-3 h-3" />
      </button>
    );
  }
  return (
    <Link to={link.rota ?? "/"} className={cls}>
      {link.rotulo}
      <ArrowRight className="w-3 h-3" />
    </Link>
  );
}
