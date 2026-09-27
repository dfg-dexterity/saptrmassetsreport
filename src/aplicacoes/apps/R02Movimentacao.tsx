import clsx from "clsx";
import { Copy } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "../../shared/components/fiori/Button";
import { Card } from "../../shared/components/fiori/Card";
import { TabBar } from "../../shared/components/fiori/Inputs";
import { HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { EMPRESA_CONTROLADORA, OPERACOES, type ClassificacaoCPC48 } from "../data/carteira";
import { TITULOS } from "../data/tesouro";
import { PARAMETROS_TIME_DEPOSIT, TIME_DEPOSITS } from "../data/timeDeposits";
import { ALIQUOTA_IRPJ_CSLL } from "../data/tributacao";
import { usePremissas } from "../../shared/context/MercadoContext";
import type { PremissasMercado } from "../../shared/data/mercado";
import { fmtDate, previousYearEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import {
  contratosMestre,
  movimentacaoMestre,
  somaMestre,
  TIPOS_CONTRATO,
  type ContratoMestre,
  type EventoMestre,
  type MovMestre,
  type TipoContrato,
} from "../lib/carteiraMestre";
import { posicaoTimeDeposit, resgateTimeDeposit } from "../lib/timeDeposit";
import { arredondarTabela, ratear } from "../../captacoes/lib/arredondamento";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct, plural } from "../../shared/lib/format";

const rel = relatorioPorId("r02");

type Aba = "mov" | "comp" | "cplp" | "nota";

// ---------------------------------------------------------------------------
// Tipos de aplicação da nota explicativa (Carteira-Mestre)
// ---------------------------------------------------------------------------

type GrupoNota = "cdb" | "letras" | "lf" | "comp" | "credito" | "tpf" | "fundos" | "exterior";

const GRUPOS: { id: GrupoNota; tipo: string; origem: string; rota: string }[] = [
  { id: "cdb", tipo: "Certificados de Depósito Bancário (CDB)", origem: "R01", rota: "/r01-composicao" },
  { id: "letras", tipo: "Letras de Crédito (LCI/LCA)", origem: "R01", rota: "/r01-composicao" },
  { id: "lf", tipo: "Letras Financeiras (LF)", origem: "R01", rota: "/r01-composicao" },
  { id: "comp", tipo: "Operações compromissadas", origem: "R01", rota: "/r01-composicao" },
  { id: "credito", tipo: "Debêntures, CRI e CRA (crédito privado)", origem: "R01", rota: "/r01-composicao" },
  { id: "tpf", tipo: "Títulos públicos federais (Tesouro Direto)", origem: "R08", rota: "/r08-tesouro" },
  { id: "fundos", tipo: "Cotas de fundos de investimento", origem: "R09", rota: "/r09-fundos" },
  { id: "exterior", tipo: "Aplicações no exterior – time deposits", origem: "R10", rota: "/r10-time-deposit" },
];

/** Produto da renda fixa bancária → linha da nota */
const GRUPO_PRODUTO_RF: Record<string, GrupoNota> = {
  CDB: "cdb",
  LCI: "letras",
  LCA: "letras",
  LF: "lf",
  Compromissada: "comp",
  "Debênture": "credito",
  CRI: "credito",
  CRA: "credito",
  "Fundo RF": "fundos",
  "Tesouro Selic": "tpf",
  "Tesouro Prefixado": "tpf",
};

function grupoNota(c: ContratoMestre): GrupoNota {
  if (c.tipo === "Tesouro Direto") return "tpf";
  if (c.tipo === "Fundo de investimento") return "fundos";
  if (c.tipo === "Time deposit") return "exterior";
  return GRUPO_PRODUTO_RF[c.produto] ?? "cdb";
}

const CLASSES_CPC48: { id: ClassificacaoCPC48; rotulo: string; curto: string }[] = [
  { id: "Custo Amortizado", rotulo: "Custo amortizado", curto: "CA" },
  { id: "VJ por ORA", rotulo: "Valor justo por ORA", curto: "VJORA" },
  { id: "VJ por Resultado", rotulo: "Valor justo por resultado", curto: "VJR" },
];

const OPS = new Map(OPERACOES.map((o) => [o.transacao, o]));
const TPF = new Map(TITULOS.map((t) => [t.transacao, t]));

const mil = (v: number) => v / 1000;
const somaPor = (cs: ContratoMestre[], g: GrupoNota, campo: "valorContabil" | "saldoCurva" = "valorContabil") =>
  cs.filter((c) => grupoNota(c) === g).reduce((s, c) => s + c[campo], 0);
const mtmDe = (cs: ContratoMestre[]) => cs.reduce((s, c) => s + c.valorContabil - c.saldoCurva, 0);

/** Variação cambial dos time deposits em (inicio, fim]: principal × (PTAX − PTAX da remessa) no fim − no início (+ realizada nos vencimentos) */
function variacaoCambialTD(inicio: string, fim: string, p: PremissasMercado, escopo: string): number {
  let vc = 0;
  for (const td of TIME_DEPOSITS) {
    if (escopo !== "todas" && td.empresa !== escopo) continue;
    vc += posicaoTimeDeposit(td, fim, p).variacaoCambial - posicaoTimeDeposit(td, inicio, p).variacaoCambial;
    if (td.vencimento > inicio && td.vencimento <= fim) vc += td.principal * (resgateTimeDeposit(td, p).ptax - td.ptaxAplicacao);
  }
  return vc;
}

/** Remuneração média ponderada pelo valor contábil, como exibida na nota */
function remuneracao(cs: ContratoMestre[]): string {
  if (!cs.length) return "";
  const grupos = new Map<string, { peso: number; taxa: number }>();
  const add = (k: string, peso: number, taxa: number) => {
    const g = grupos.get(k) ?? { peso: 0, taxa: 0 };
    g.peso += peso;
    g.taxa += taxa * peso;
    grupos.set(k, g);
  };
  if (cs[0].tipo === "Fundo de investimento") return `Variação das cotas (${plural(cs.length, "fundo", "fundos")})`;
  for (const c of cs) {
    if (c.tipo === "Renda fixa bancária") {
      const op = OPS.get(c.id);
      if (op) add(op.indexador, c.valorContabil, op.taxa);
    } else if (c.tipo === "Tesouro Direto") {
      const t = TPF.get(c.id);
      if (t) add(t.indexador === "Prefixado" ? "Pré" : t.indexador, c.valorContabil, t.taxaCompra);
    } else if (c.tipo === "Time deposit") add(c.moeda, c.valorContabil, c.taxaAA);
  }
  return [...grupos.entries()]
    .map(([idx, g]) => {
      const t = g.taxa / g.peso;
      if (idx === "CDI") return `${fmtDec(t * 100, 1)}% do CDI`;
      if (idx === "Pré") return `${fmtDec(t * 100, 2)}% a.a. (pré)`;
      if (idx === "USD" || idx === "EUR") return `${fmtDec(t * 100, 2)}% a.a. (${idx})`;
      return `${idx} ${t < 0 ? "−" : "+"} ${fmtDec(Math.abs(t) * 100, 2)}% a.a.`;
    })
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Movimentação em R$ mil com arredondamento controlado
// ---------------------------------------------------------------------------

interface MovNota {
  mv: MovMestre;
  vc: number;
  mtmIni: number;
  mtmFim: number;
  contabilIni: number;
  contabilFim: number;
  /** saldo contábil inicial + movimentação do saldo bruto + variação do MTM − Σ valor contábil da Carteira-Mestre no fim (R$) */
  difContabil: number;
  /** valores inteiros em R$ mil que fecham */
  k: {
    contabilIni: number;
    brutoIni: number;
    mtmIni: number;
    aplicacoes: number;
    rendimentos: number;
    vc: number;
    resgates: number;
    comeCotas: number;
    brutoFim: number;
    mtmFim: number;
    contabilFim: number;
    varMtm: number;
    resgatesLiquidos: number;
    irrfResgates: number;
    irrf: number;
    iof: number;
  };
}

function movNota(inicio: string, fim: string, p: PremissasMercado, escopo: string, c0: ContratoMestre[], c1: ContratoMestre[]): MovNota {
  const mv = movimentacaoMestre(inicio, fim, p, escopo).total;
  const vc = variacaoCambialTD(inicio, fim, p, escopo);
  const mtmIni = mtmDe(c0);
  const mtmFim = mtmDe(c1);
  const contabilIni = somaMestre(c0, "valorContabil");
  const contabilFim = somaMestre(c1, "valorContabil");
  const kCi = Math.round(mil(contabilIni));
  const kCf = Math.round(mil(contabilFim));
  // saldo bruto arredondado como no R05 e na Carteira-Mestre; o MTM absorve o arredondamento (desvio < R$ 1 mil)
  const brutoIni = Math.round(mil(mv.saldoInicial));
  const brutoFim = Math.round(mil(mv.saldoFinal));
  const kMi = kCi - brutoIni;
  const kMf = kCf - brutoFim;
  const [aplicacoes, rendimentos, kvc, resg, cc] = ratear(
    [mil(mv.aplicacoes), mil(mv.rendimentos - vc), mil(vc), -mil(mv.resgatesBrutos), -mil(mv.comeCotas)],
    brutoFim - brutoIni,
  );
  const [resgatesLiquidos, irrfResgates, iof] = ratear([mil(mv.resgatesLiquidos), mil(mv.irrf - mv.comeCotas), mil(mv.iof)], -resg);
  const difContabil = contabilIni + mv.aplicacoes + mv.rendimentos - mv.resgatesBrutos - mv.comeCotas + (mtmFim - mtmIni) - contabilFim;
  return {
    mv,
    vc,
    mtmIni,
    mtmFim,
    contabilIni,
    contabilFim,
    difContabil,
    k: {
      contabilIni: kCi,
      brutoIni,
      mtmIni: kMi,
      aplicacoes,
      rendimentos,
      vc: kvc,
      resgates: resg,
      comeCotas: cc,
      brutoFim,
      mtmFim: kMf,
      contabilFim: kCf,
      varMtm: kMf - kMi,
      resgatesLiquidos,
      irrfResgates,
      irrf: irrfResgates - cc,
      iof,
    },
  };
}

type EstiloLinha = "saldo" | "dosQuais" | "secao" | "info" | undefined;

interface LinhaNota {
  rotulo: ReactNode;
  valores: number[];
  estilo?: EstiloLinha;
  chave?: string;
}

export function R02Movimentacao() {
  const { premissas: p } = usePremissas();
  const [aba, setAba] = useState<Aba>("mov");
  const inicio = previousYearEnd(p.dataBase);

  const d = useMemo(() => {
    const c0Ctrl = contratosMestre(inicio, p, EMPRESA_CONTROLADORA);
    const c1Ctrl = contratosMestre(p.dataBase, p, EMPRESA_CONTROLADORA);
    const c0 = contratosMestre(inicio, p);
    const c1 = contratosMestre(p.dataBase, p);
    const ctrl = movNota(inicio, p.dataBase, p, EMPRESA_CONTROLADORA, c0Ctrl, c1Ctrl);
    const cons = movNota(inicio, p.dataBase, p, "todas", c0, c1);

    // 1A – composição por tipo (valor contábil), cada coluna fecha no saldo contábil da movimentação
    const colunas = [
      { cs: c1Ctrl, total: ctrl.k.contabilFim },
      { cs: c0Ctrl, total: ctrl.k.contabilIni },
      { cs: c1, total: cons.k.contabilFim },
      { cs: c0, total: cons.k.contabilIni },
    ].map((x) => ratear(GRUPOS.map((g) => mil(somaPor(x.cs, g.id))), x.total));
    const composicao = GRUPOS.map((g, i) => ({ ...g, valores: colunas.map((col) => col[i]), exatos: [c1Ctrl, c0Ctrl, c1, c0].map((cs) => somaPor(cs, g.id)) })).filter(
      (l) => l.exatos.some((v) => Math.abs(v) > 0.5),
    );
    const totaisComp = colunas.map((col) => col.reduce((s, v) => s + v, 0));

    // 1C – circulante × não circulante e CPC 48 (consolidado, data-base): linhas fecham na composição
    const gruposCons = GRUPOS.map((g, i) => ({ ...g, cs: c1.filter((c) => grupoNota(c) === g.id), alvo: colunas[2][i] })).filter((g) => g.cs.length);
    const circ = arredondarTabela(
      gruposCons.map((g) => [mil(g.cs.filter((c) => c.circulante).reduce((s, c) => s + c.valorContabil, 0)), mil(g.cs.filter((c) => !c.circulante).reduce((s, c) => s + c.valorContabil, 0))]),
      { linhas: gruposCons.map((g) => g.alvo), geral: cons.k.contabilFim },
    );
    const cpc = arredondarTabela(
      gruposCons.map((g) => CLASSES_CPC48.map((k) => mil(g.cs.filter((c) => c.cpc48 === k.id).reduce((s, c) => s + c.valorContabil, 0)))),
      { linhas: gruposCons.map((g) => g.alvo), geral: cons.k.contabilFim },
    );
    const cplp = gruposCons.map((g, i) => ({
      ...g,
      remuneracao: remuneracao(g.cs),
      circulante: circ.celulas[i][0],
      naoCirculante: circ.celulas[i][1],
      cpc48: cpc.celulas[i],
      total: g.alvo,
    }));

    // 1B – movimentação por tipo de contrato (consolidado), fechando nas linhas e na coluna consolidada
    const mvTipos = movimentacaoMestre(inicio, p.dataBase, p).porTipo;
    const tiposMov = TIPOS_CONTRATO.filter((t) => {
      const x = mvTipos[t.tipo];
      return Math.abs(x.saldoInicial) > 0.5 || Math.abs(x.saldoFinal) > 0.5 || Math.abs(x.aplicacoes) > 0.5;
    });
    const siT = ratear(tiposMov.map((t) => mil(mvTipos[t.tipo].saldoInicial)), cons.k.brutoIni);
    const sfT = ratear(tiposMov.map((t) => mil(mvTipos[t.tipo].saldoFinal)), cons.k.brutoFim);
    const vcTipo = (t: TipoContrato) => (t === "Time deposit" ? cons.vc : 0);
    const movT = arredondarTabela(
      tiposMov.map((t) => {
        const x = mvTipos[t.tipo];
        return [mil(x.aplicacoes), mil(x.rendimentos - vcTipo(t.tipo)), mil(vcTipo(t.tipo)), -mil(x.resgatesBrutos), -mil(x.comeCotas)];
      }),
      {
        linhas: tiposMov.map((_, i) => sfT[i] - siT[i]),
        colunas: [cons.k.aplicacoes, cons.k.rendimentos, cons.k.vc, cons.k.resgates, cons.k.comeCotas],
        geral: cons.k.brutoFim - cons.k.brutoIni,
      },
    );
    const porTipo = tiposMov.map((t, i) => ({ ...t, valores: [siT[i], ...movT.celulas[i], sfT[i]] }));

    // Remuneração média dos pós-fixados (renda fixa bancária indexada ao CDI)
    const cdi = c1.filter((c) => c.tipo === "Renda fixa bancária" && c.indexador === "CDI");
    const mediaCDI = cdi.reduce((s, c) => s + (OPS.get(c.id)?.taxa ?? 0) * c.valorContabil, 0) / Math.max(1, somaMestre(cdi, "valorContabil"));

    // MTM dos títulos públicos por classificação (texto da nota)
    const tpf = c1.filter((c) => c.tipo === "Tesouro Direto");
    const mtmTpf = (k: ClassificacaoCPC48) => mil(mtmDe(tpf.filter((c) => c.cpc48 === k)));

    const eventos = movimentacaoMestre(inicio, p.dataBase, p).eventos;
    return {
      ctrl,
      cons,
      composicao,
      totaisComp,
      cplp,
      circTotais: circ.colunas,
      cpcTotais: cpc.colunas,
      porTipo,
      mediaCDI,
      mtmTpfORA: mtmTpf("VJ por ORA"),
      mtmTpfVJR: mtmTpf("VJ por Resultado"),
      eventos,
      checagens: {
        brutoCons: Math.abs(cons.mv.saldoFinal - somaMestre(c1, "saldoCurva")),
        brutoCtrl: Math.abs(ctrl.mv.saldoFinal - somaMestre(c1Ctrl, "saldoCurva")),
        brutoIni: Math.abs(cons.mv.saldoInicial - somaMestre(c0, "saldoCurva")),
        contabil: Math.max(Math.abs(cons.difContabil), Math.abs(ctrl.difContabil)),
      },
    };
  }, [p, inicio]);

  const { ctrl, cons } = d;
  const grupoK = (id: GrupoNota) => d.composicao.find((l) => l.id === id)?.valores[2] ?? 0;
  const circ = d.circTotais[0] ?? 0;
  const naoCirc = d.circTotais[1] ?? 0;
  const difBruto = Math.max(d.checagens.brutoCons, d.checagens.brutoCtrl, d.checagens.brutoIni);
  const okBruto = difBruto < TOL_CHECAGEM;
  const okContabil = d.checagens.contabil < TOL_CHECAGEM;
  const okConc = okBruto && okContabil;

  const linhasMov = (x: MovNota): number[] => [
    x.k.contabilIni,
    x.k.brutoIni,
    x.k.mtmIni,
    x.k.aplicacoes,
    x.k.rendimentos,
    x.k.vc,
    x.k.resgates,
    x.k.comeCotas,
    x.k.varMtm,
    x.k.contabilFim,
    x.k.brutoFim,
    x.k.mtmFim,
    0,
    x.k.resgatesLiquidos,
    x.k.irrf,
    x.k.iof,
  ];
  const rotulosMov: { rotulo: string; estilo?: EstiloLinha }[] = [
    { rotulo: `Saldo em ${fmtDate(inicio)}`, estilo: "saldo" },
    { rotulo: "Saldo bruto (curva, cota e ME × PTAX)", estilo: "dosQuais" },
    { rotulo: "Ajuste a valor justo (MTM)", estilo: "dosQuais" },
    // convenção de nota explicativa: reduções entre parênteses no valor, sem (+)/(−) no rótulo
    { rotulo: "Aplicações" },
    { rotulo: "Rendimentos (juros, cupons e cotas)" },
    { rotulo: "Variação cambial – time deposits" },
    { rotulo: "Resgates, vencimentos e cupons (brutos)" },
    { rotulo: "Come-cotas (IRRF por redução de cotas)" },
    { rotulo: "Ajuste a valor justo (MTM) no período" },
    { rotulo: `Saldo em ${fmtDate(p.dataBase)}`, estilo: "saldo" },
    { rotulo: "Saldo bruto (curva, cota e ME × PTAX)", estilo: "dosQuais" },
    { rotulo: "Ajuste a valor justo (MTM)", estilo: "dosQuais" },
    { rotulo: "Informações complementares", estilo: "secao" },
    { rotulo: "Resgates líquidos recebidos em caixa", estilo: "info" },
    { rotulo: "IRRF retido na fonte (inclui come-cotas)", estilo: "info" },
    { rotulo: "IOF retido na fonte", estilo: "info" },
  ];
  const vCtrl = linhasMov(ctrl);
  const vCons = linhasMov(cons);
  const tabelaMov: LinhaNota[] = rotulosMov.map((l, i) => ({ rotulo: l.rotulo, estilo: l.estilo, chave: `m${i}`, valores: l.estilo === "secao" ? [] : [vCtrl[i], vCons[i]] }));

  const k = cons.k;
  const vcTxt = k.vc === 0 ? "sem efeito relevante" : `${k.vc > 0 ? "positiva" : "negativa"} em ${rsMil(Math.abs(k.vc))}`;
  const textoNota = [
    `Aplicações financeiras`,
    ``,
    `As aplicações financeiras da Companhia compreendem depósitos e títulos de renda fixa bancária (CDB, LCI/LCA, LF e operações compromissadas), crédito privado (debêntures, CRI e CRA), títulos públicos federais, cotas de fundos de investimento e depósitos a prazo no exterior (time deposits). São mensuradas ao custo amortizado, ao valor justo por meio de outros resultados abrangentes (VJORA) ou ao valor justo por meio do resultado (VJR), conforme o modelo de negócios e as características dos fluxos de caixa contratuais (CPC 48 / IFRS 9).`,
    ``,
    `Em ${fmtDate(p.dataBase)}, o saldo consolidado de aplicações financeiras era de ${rsMil(k.contabilFim)} (${rsMil(k.contabilIni)} em ${fmtDate(inicio)}), dos quais ${rsMil(ctrl.k.contabilFim)} na Controladora. No período, as novas aplicações somaram ${rsMil(k.aplicacoes)} e os resgates, vencimentos e cupons, ${rsMil(-k.resgates)} pelo valor bruto (${rsMil(k.resgatesLiquidos)} líquidos de ${rsMil(k.irrfResgates)} de IRRF e ${rsMil(k.iof)} de IOF retidos na fonte). Os rendimentos apropriados totalizaram ${rsMil(k.rendimentos + k.vc)}, incluída a variação cambial dos time deposits (${vcTxt}). O IRRF retido sobre os rendimentos das aplicações no país, inclusive o come-cotas, é antecipação do imposto de renda devido e é deduzido do IRPJ apurado no lucro real (Lei 8.981/1995, art. 76, I).`,
    ``,
    `As aplicações pós-fixadas em renda fixa bancária são remuneradas à média ponderada de ${fmtDec(d.mediaCDI * 100, 1)}% da variação do CDI.`,
    ``,
    `Os títulos públicos federais (Tesouro Selic, Prefixado e IPCA+), no montante de ${rsMil(grupoK("tpf"))}, são marcados a mercado pelas taxas indicativas divulgadas pela ANBIMA quando classificados a VJORA ou VJR; o ajuste a valor justo acumulado desses títulos era de ${rsMil(d.mtmTpfORA)} em outros resultados abrangentes (VJORA) e de ${rsMil(d.mtmTpfVJR)} no resultado (VJR). Os títulos classificados ao custo amortizado são apresentados pela curva de aquisição. O ajuste a valor justo total da carteira passou de ${rsMil(k.mtmIni)} para ${rsMil(k.mtmFim)} no período.`,
    ``,
    `As cotas de fundos de investimento (${rsMil(grupoK("fundos"))}) são mensuradas ao valor justo por meio do resultado pelo valor da cota divulgado pelo administrador. Nos fundos sujeitos ao come-cotas, o imposto de renda é antecipado em maio e novembro pela redução da quantidade de cotas, sem saída de caixa${-k.comeCotas > 0 ? `: ${rsMil(-k.comeCotas)} no período` : "; não houve recolhimento no período"}.`,
    ``,
    `As aplicações no exterior (time deposits em dólar e euro, ${rsMil(grupoK("exterior"))}) são convertidas pela PTAX de fechamento da data-base, com a variação cambial reconhecida no resultado conforme o CPC 02 (R2) / IAS 21, ${k.vc === 0 ? "sem efeito relevante no período" : `${k.vc > 0 ? "positiva" : "negativa"} em ${rsMil(Math.abs(k.vc))} no período`}. Nas remessas para investimento no exterior incidem IOF câmbio de ${fmtPct(PARAMETROS_TIME_DEPOSIT.iofCambio, 2)} (Decreto 6.306/2007, na redação do Decreto 12.499/2025) e tarifa bancária; os rendimentos auferidos no exterior não sofrem retenção na fonte e são tributados pelo IRPJ/CSLL (${fmtPct(ALIQUOTA_IRPJ_CSLL, 0)}) na apuração do lucro real (Lei 9.249/1995, art. 25).`,
    ``,
    `Do saldo consolidado, ${rsMil(circ)} estão classificados no ativo circulante e ${rsMil(naoCirc)} no não circulante.`,
    ``,
    `A exposição da Companhia a riscos de taxa de juros, de câmbio e de crédito e a análise de sensibilidade dos ativos financeiros estão divulgadas na nota explicativa de instrumentos financeiros, conforme o CPC 40 (R1).`,
  ].join("\n");

  const colunasMovTipo = ["Saldo bruto inicial", "Aplicações", "Rendimentos", "Variação cambial", "Resgates brutos", "Come-cotas", "Saldo bruto final"];

  const exportar = () =>
    exportarExcel(
      `R02_Nota_Aplicacoes_${p.dataBase}.xlsx`,
      [
        {
          nome: "1B - Movimentação",
          titulo: "RELATÓRIO 1B – Movimentação das Aplicações Financeiras (Carteira-Mestre)",
          subtitulo: `${fmtDate(inicio)} a ${fmtDate(p.dataBase)} · R$ mil · arredondamento controlado`,
          colunas: [{ titulo: "Movimentação", largura: 46 }, { titulo: "Controladora (R$ mil)", tipo: "inteiro", largura: 20 }, { titulo: "Consolidado (R$ mil)", tipo: "inteiro", largura: 20 }],
          linhas: rotulosMov.map((l, i) =>
            l.estilo === "secao" ? [l.rotulo.toUpperCase()] : [l.estilo === "dosQuais" ? `   dos quais: ${l.rotulo}` : l.rotulo, vCtrl[i], vCons[i]],
          ),
          notas: [
            "Movimentação pelo saldo bruto (curva na renda fixa e nos títulos, valor da cota nos fundos, saldo em moeda × PTAX nos time deposits); saldo contábil = saldo bruto + ajuste a valor justo dos contratos a VJORA/VJR (CPC 48).",
            "Resgates pelo valor bruto; IRRF e IOF retidos na fonte e resgates líquidos nas informações complementares. Come-cotas: IRRF antecipado pela redução da quantidade de cotas, sem saída de caixa.",
            "Variação cambial dos time deposits: principal × (PTAX da data − PTAX da remessa), no fim menos no início do período (CPC 02); os juros em moeda estão nos rendimentos.",
            `Nota: as aplicações pós-fixadas em renda fixa bancária são remuneradas à média de ${fmtDec(d.mediaCDI * 100, 1)}% do CDI.`,
          ],
        },
        {
          nome: "1B - Por tipo de contrato",
          titulo: "RELATÓRIO 1B – Movimentação por tipo de contrato (Consolidado) · R$ mil",
          colunas: [{ titulo: "Tipo de contrato", largura: 30 }, ...colunasMovTipo.map((t) => ({ titulo: t, tipo: "inteiro" as const, largura: 16 }))],
          linhas: d.porTipo.map((t) => [`${t.tipo} (${t.origem})`, ...t.valores]),
          total: ["Total", k.brutoIni, k.aplicacoes, k.rendimentos, k.vc, k.resgates, k.comeCotas, k.brutoFim],
        },
        {
          nome: "1A - Composição",
          titulo: "RELATÓRIO 1A – Aplicações: Controladora vs Consolidado · R$ mil (valor contábil)",
          colunas: [
            { titulo: "Tipo de aplicação", largura: 44 },
            { titulo: `Controladora ${fmtDate(p.dataBase)}`, tipo: "inteiro", largura: 18 },
            { titulo: `Controladora ${fmtDate(inicio)}`, tipo: "inteiro", largura: 18 },
            { titulo: `Consolidado ${fmtDate(p.dataBase)}`, tipo: "inteiro", largura: 18 },
            { titulo: `Consolidado ${fmtDate(inicio)}`, tipo: "inteiro", largura: 18 },
          ],
          linhas: d.composicao.map((l) => [`${l.tipo} (${l.origem})`, ...l.valores]),
          total: ["Total aplicações financeiras", ...d.totaisComp],
        },
        {
          nome: "1C - CP x LP",
          titulo: `RELATÓRIO 1C – Circulante vs Não Circulante + Remuneração (Consolidado, ${fmtDate(p.dataBase)}) · R$ mil`,
          colunas: [{ titulo: "Tipo de aplicação", largura: 44 }, { titulo: "Remuneração média", largura: 40 }, { titulo: "Circulante", tipo: "inteiro" }, { titulo: "Não circulante", tipo: "inteiro" }, { titulo: "Total", tipo: "inteiro" }],
          linhas: d.cplp.map((l) => [l.tipo, l.remuneracao, l.circulante, l.naoCirculante, l.total]),
          total: ["TOTAL", "", circ, naoCirc, circ + naoCirc],
        },
        {
          nome: "1C - CPC 48",
          titulo: `RELATÓRIO 1C – Classificação CPC 48 (Consolidado, ${fmtDate(p.dataBase)}) · R$ mil`,
          colunas: [{ titulo: "Tipo de aplicação", largura: 44 }, ...CLASSES_CPC48.map((c) => ({ titulo: c.rotulo, tipo: "inteiro" as const, largura: 20 })), { titulo: "Total", tipo: "inteiro" }],
          linhas: d.cplp.map((l) => [l.tipo, ...l.cpc48, l.total]),
          total: ["TOTAL", ...d.cpcTotais, k.contabilFim],
        },
        {
          nome: "Texto da nota",
          titulo: "Minuta do texto da nota explicativa",
          colunas: [{ titulo: "Texto", largura: 120 }],
          linhas: textoNota.split("\n").map((l) => [l]),
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
          <HeaderKpi label="Consolidado" value={fmtCompact(cons.contabilFim)} sub={`saldo contábil · ${fmtDate(p.dataBase)}`} />
          <HeaderKpi label="Controladora" value={fmtCompact(ctrl.contabilFim)} sub={`empresa ${EMPRESA_CONTROLADORA}`} />
          <HeaderKpi
            label="Rendimentos no exercício"
            value={fmtCompact(cons.mv.rendimentos)}
            state={cons.mv.rendimentos >= 0 ? "positive" : "negative"}
            sub={k.vc === 0 ? "consolidado" : `consolidado · inclui variação cambial de ${fmtCompact(cons.vc)}`}
          />
          <HeaderKpi label="Remuneração média" value={`${fmtDec(d.mediaCDI * 100, 1)}%`} sub="do CDI (pós-fixados)" />
        </>
      }
      headerExtra={
        <div className="border-b border-line-soft -mb-5">
          <TabBar
            value={aba}
            onChange={setAba}
            items={[
              { value: "mov", label: "1B · Movimentação" },
              { value: "comp", label: "1A · Controladora × Consolidado" },
              { value: "cplp", label: "1C · Circulante × NC · CPC 48" },
              { value: "nota", label: "Texto da nota" },
            ]}
          />
        </div>
      }
    >
      {aba === "mov" && (
        <>
          <MessageStrip design={okConc ? "positive" : "critical"}>
            <ul className="space-y-0.5">
              <Checagem ok={okBruto}>
                {okBruto ? (
                  <>
                    Saldo bruto igual ao Σ saldo da Carteira-Mestre (curva, cota, ME × PTAX) e ao saldo final do R05: <strong>{rsMil(k.brutoFim)}</strong>
                  </>
                ) : (
                  <>
                    Saldo bruto diverge do Σ saldo da Carteira-Mestre (curva, cota, ME × PTAX): diferença de <strong>{fmtBRL(difBruto, true)}</strong>
                  </>
                )}
              </Checagem>
              <Checagem ok={okContabil}>
                {okContabil ? (
                  <>
                    Saldo contábil inicial + movimentação + ajuste a valor justo igual ao Σ valor contábil da Carteira-Mestre: <strong>{rsMil(k.contabilFim)}</strong>
                  </>
                ) : (
                  <>
                    Saldo contábil da movimentação diverge do Σ valor contábil da Carteira-Mestre: diferença de <strong>{fmtBRL(d.checagens.contabil, true)}</strong>
                  </>
                )}
              </Checagem>
            </ul>
          </MessageStrip>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
            <Card
              className="xl:col-span-3"
              title="Movimentação das aplicações financeiras"
              subtitle="Saldo contábil inicial → movimentação do saldo bruto → ajuste a valor justo (MTM) → saldo contábil final"
            >
              <NotaTabela cabecalho={["Controladora", "Consolidado"]} linhas={tabelaMov} />
              <p className="text-[13px] text-text mt-4">
                <strong>Nota:</strong> as aplicações pós-fixadas em renda fixa bancária são remuneradas à média de {fmtDec(d.mediaCDI * 100, 1)}% do
                CDI e mantidas para atender compromissos de investimentos. A movimentação usa o saldo bruto; o ajuste a valor justo (CPC 48)
                concilia o saldo bruto com o saldo contábil no início e no fim do período.
              </p>
            </Card>
            <Card className="xl:col-span-2" title="Aplicações, resgates e come-cotas do exercício" subtitle={`Consolidado · ${fmtDate(inicio)} a ${fmtDate(p.dataBase)}`}>
              <div className="max-h-[560px] overflow-y-auto fiori-scroll pr-1">
                <ListaEventos titulo="Novas aplicações" eventos={d.eventos.filter((e) => e.tipo === "Aplicação")} />
                <div className="h-4" />
                <ListaEventos titulo="Resgates, vencimentos e cupons (líquidos)" eventos={d.eventos.filter((e) => e.tipo === "Resgate" || e.tipo === "Vencimento" || e.tipo === "Cupom")} />
                <div className="h-4" />
                <ListaEventos titulo="Come-cotas (IRRF por redução de cotas)" eventos={d.eventos.filter((e) => e.tipo === "Come-cotas")} />
              </div>
            </Card>
          </div>
          <Card title="Movimentação por tipo de contrato" subtitle="Consolidado · saldo bruto · R$ mil · as colunas somam a movimentação consolidada">
            <div className="hidden lg:block overflow-x-auto fiori-scroll">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="text-[13px]">
                    <th className="text-left py-2 border-b-2 border-brand">Tipo de contrato</th>
                    {colunasMovTipo.map((c) => (
                      <th key={c} className="text-right py-2 pl-4 border-b-2 border-brand whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.porTipo.map((t) => (
                    <tr key={t.tipo}>
                      <td className="py-2 border-b border-line-soft whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                          {t.tipo}
                          <Link to={t.rota} className="text-link hover:underline text-xs">
                            {t.origem}
                          </Link>
                        </span>
                      </td>
                      {t.valores.map((v, i) => (
                        <td key={i} className={clsx("py-2 pl-4 border-b border-line-soft text-right tabular", (i === 0 || i === 6) && "font-semibold")}>
                          {fmtK(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="font-bold bg-surface-3">
                    <td className="py-2.5 pl-2 border-y border-line">Total</td>
                    {[k.brutoIni, k.aplicacoes, k.rendimentos, k.vc, k.resgates, k.comeCotas, k.brutoFim].map((v, i) => (
                      <td key={i} className="py-2.5 pl-4 pr-2 border-y border-line text-right tabular">
                        {fmtK(v)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          <ListaCartoes
            itens={[
              ...d.porTipo.map((t) => ({
                chave: t.tipo,
                titulo: (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                    {t.tipo}
                    <Link to={t.rota} className="text-link hover:underline text-xs font-normal">
                      {t.origem}
                    </Link>
                  </span>
                ),
                rotuloValor: "Saldo bruto final",
                valor: fmtK(t.valores[6]),
                campos: colunasMovTipo.slice(0, 6).map((c, i) => ({ rotulo: c, valor: fmtK(t.valores[i]) })),
              })),
              {
                chave: "total",
                titulo: "Total",
                total: true,
                rotuloValor: "Saldo bruto final",
                valor: fmtK(k.brutoFim),
                campos: colunasMovTipo.slice(0, 6).map((c, i) => ({ rotulo: c, valor: fmtK([k.brutoIni, k.aplicacoes, k.rendimentos, k.vc, k.resgates, k.comeCotas][i]) })),
              },
            ]}
          />
          </Card>
        </>
      )}

      {aba === "comp" && (
        <Card title="Aplicações: Controladora vs Consolidado" subtitle="Composição por tipo de aplicação (modelo ITR/DFP) · valor contábil">
          <NotaTabela
            grupos={["Controladora", "Consolidado"]}
            cabecalho={[fmtDate(p.dataBase), fmtDate(inicio), fmtDate(p.dataBase), fmtDate(inicio)]}
            linhas={[
              ...d.composicao.map((l) => ({ chave: l.id, rotulo: <RotuloOrigem tipo={l.tipo} origem={l.origem} rota={l.rota} />, valores: l.valores })),
              { chave: "total", rotulo: "Total aplicações financeiras", estilo: "saldo" as const, valores: d.totaisComp },
            ]}
          />
          <ul className="text-xs text-label mt-4 space-y-1">
            <li>(i) Valor contábil: curva de aquisição nos contratos ao custo amortizado; valor de mercado nos classificados a VJORA e VJR (CPC 48).</li>
            <li>(ii) Títulos públicos marcados pelas taxas indicativas da ANBIMA; fundos pelo valor da cota; time deposits pela PTAX de fechamento (CPC 02).</li>
            <li>(iii) Os totais conferem com o saldo final da movimentação (aba 1B) e com o valor contábil da Carteira-Mestre.</li>
          </ul>
        </Card>
      )}

      {aba === "cplp" && (
        <>
          <Card title="Aplicações: Circulante vs Não Circulante + Remuneração" subtitle={`Consolidado · ${fmtDate(p.dataBase)} · remuneração média ponderada contratada`}>
            <div className="hidden lg:block overflow-x-auto fiori-scroll">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="text-[13px]">
                    <th className="text-left py-2 border-b-2 border-brand">Tipo de aplicação</th>
                    <th className="text-left py-2 pl-4 border-b-2 border-brand">Remuneração média</th>
                    <th className="text-right py-2 pl-4 border-b-2 border-brand">Circulante</th>
                    <th className="text-right py-2 pl-4 border-b-2 border-brand whitespace-nowrap">Não circulante</th>
                    <th className="text-right py-2 pl-4 border-b-2 border-brand">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.cplp.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 border-b border-line-soft">{l.tipo}</td>
                      <td className="py-2.5 pl-4 border-b border-line-soft text-label">{l.remuneracao}</td>
                      <td className="py-2.5 pl-4 border-b border-line-soft text-right tabular">{fmtK(l.circulante)}</td>
                      <td className="py-2.5 pl-4 border-b border-line-soft text-right tabular">{fmtK(l.naoCirculante)}</td>
                      <td className="py-2.5 pl-4 border-b border-line-soft text-right tabular font-semibold">{fmtK(l.total)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold bg-surface-3">
                    <td className="py-2.5 pl-2">Total</td>
                    <td />
                    <td className="py-2.5 pl-4 text-right tabular">{fmtK(circ)}</td>
                    <td className="py-2.5 pl-4 text-right tabular">{fmtK(naoCirc)}</td>
                    <td className="py-2.5 pl-4 pr-2 text-right tabular">{fmtK(circ + naoCirc)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ListaCartoes
              itens={[
                ...d.cplp.map((l) => ({
                  chave: l.id,
                  titulo: l.tipo,
                  sub: l.remuneracao,
                  valor: fmtK(l.total),
                  campos: [
                    { rotulo: "Circulante", valor: fmtK(l.circulante) },
                    { rotulo: "Não circulante", valor: fmtK(l.naoCirculante) },
                  ],
                })),
                {
                  chave: "total",
                  titulo: "Total",
                  total: true,
                  valor: fmtK(circ + naoCirc),
                  campos: [
                    { rotulo: "Circulante", valor: fmtK(circ) },
                    { rotulo: "Não circulante", valor: fmtK(naoCirc) },
                  ],
                },
              ]}
            />
            <ul className="text-xs text-label mt-4 space-y-1">
              <li>(i) Circulante: vencimento em até 12 meses, cotas de fundos (resgatáveis a qualquer tempo) e renda fixa bancária a VJR; títulos públicos e time deposits classificados pelo vencimento.</li>
              <li>(ii) Time deposits: taxa em moeda estrangeira (ACT/360), sem variação cambial; fundos remunerados pela variação das cotas.</li>
              <li>(iii) A análise de exposição a riscos de taxas de juros e de câmbio é divulgada na nota de instrumentos financeiros.</li>
            </ul>
          </Card>

          <Card title="Classificação e mensuração (CPC 48)" subtitle={`Consolidado · ${fmtDate(p.dataBase)} · valor contábil por categoria`}>
            <div className="hidden lg:block overflow-x-auto fiori-scroll">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-[13px]">
                    <th className="text-left py-2 border-b-2 border-brand">Tipo de aplicação</th>
                    {CLASSES_CPC48.map((c) => (
                      <th key={c.id} className="text-right py-2 pl-4 border-b-2 border-brand whitespace-nowrap">
                        {c.rotulo}
                      </th>
                    ))}
                    <th className="text-right py-2 pl-4 border-b-2 border-brand">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.cplp.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 border-b border-line-soft">{l.tipo}</td>
                      {l.cpc48.map((v, i) => (
                        <td key={i} className="py-2.5 pl-4 border-b border-line-soft text-right tabular">
                          {fmtK(v)}
                        </td>
                      ))}
                      <td className="py-2.5 pl-4 border-b border-line-soft text-right tabular font-semibold">{fmtK(l.total)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold bg-surface-3">
                    <td className="py-2.5 pl-2">Total</td>
                    {d.cpcTotais.map((v, i) => (
                      <td key={i} className="py-2.5 pl-4 text-right tabular">
                        {fmtK(v)}
                      </td>
                    ))}
                    <td className="py-2.5 pl-4 pr-2 text-right tabular">{fmtK(k.contabilFim)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ListaCartoes
              itens={[
                ...d.cplp.map((l) => ({ chave: l.id, titulo: l.tipo, valor: fmtK(l.total), campos: CLASSES_CPC48.map((c, i) => ({ rotulo: c.rotulo, valor: fmtK(l.cpc48[i]) })) })),
                { chave: "total", titulo: "Total", total: true, valor: fmtK(k.contabilFim), campos: CLASSES_CPC48.map((c, i) => ({ rotulo: c.rotulo, valor: fmtK(d.cpcTotais[i]) })) },
              ]}
            />
            <ul className="text-xs text-label mt-4 space-y-1">
              <li>(i) Custo amortizado: modelo de negócios de manter para receber fluxos contratuais de principal e juros (teste SPPI).</li>
              <li>(ii) VJORA: manter para receber e vender – ajuste a valor justo em outros resultados abrangentes, reciclado no resultado na baixa.</li>
              <li>(iii) VJR: fundos de investimento e títulos geridos a valor justo – ajuste reconhecido diretamente no resultado.</li>
            </ul>
          </Card>
        </>
      )}

      {aba === "nota" && (
        <Card
          title="Minuta do texto da nota explicativa"
          subtitle="Gerada automaticamente com os números da data-base – revise antes de publicar"
          actions={
            <Button
              icon={<Copy className="w-4 h-4" />}
              onClick={() => {
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
              }}
            >
              Copiar
            </Button>
          }
        >
          <article id="texto-nota" className="max-w-3xl text-[15px] leading-relaxed text-text space-y-3">
            {textoNota.split("\n\n").map((par, i) => (i === 0 ? <h3 key={i} className="text-lg font-bold">{par}</h3> : <p key={i}>{par}</p>))}
          </article>
        </Card>
      )}

      <MessageStrip>
        Valores em R$ mil, com arredondamento controlado (linhas e colunas fecham). Período do exercício: {fmtDate(inicio)} a{" "}
        {fmtDate(p.dataBase)}. Movimentação pelo saldo bruto da Carteira-Mestre (renda fixa, títulos públicos, fundos e time
        deposits), conciliada ao saldo contábil pelo ajuste a valor justo; resgates pelo valor bruto, com IRRF e IOF retidos nas
        informações complementares; come-cotas em linha própria. Normas: CPC 02 (R2), CPC 40 (R1) e CPC 48.
      </MessageStrip>
    </ReportPage>
  );
}

/** Valor já arredondado em R$ mil (inteiro): negativos entre parênteses, zero como "–" */
function fmtK(v: number): string {
  return fmtNum(v, { parens: true, dash: true });
}

/** Valor em R$ mil para o texto da nota: "R$ 1.234 mil" / "−R$ 1.234 mil" (sinal colado, sem parênteses) */
function rsMil(v: number): string {
  const r = Math.round(v) || 0;
  return `${r < 0 ? "\u2212" : ""}R$ ${fmtNum(Math.abs(r))} mil`;
}

/** Tolerância das checagens de conferência (R$) */
const TOL_CHECAGEM = 1;

/** Item de checagem dentro da MessageStrip (o ícone é o da própria faixa): o texto já diz se confere ou diverge */
function Checagem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <li className={ok ? undefined : "text-negative"}>{children}</li>;
}

/** Lista em cartões para o celular (as tabelas largas ficam em lg+): valores em R$ mil já formatados */
function ListaCartoes({
  itens,
}: {
  itens: { chave: string; titulo: ReactNode; sub?: string; rotuloValor?: string; valor: string; total?: boolean; campos: { rotulo: string; valor: string }[] }[];
}) {
  return (
    <ul className="lg:hidden border-t border-line divide-y divide-line-soft -mx-4">
      {itens.map((it) => (
        <li key={it.chave} className={clsx("px-4 py-3", it.total && "bg-surface-3")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={clsx("text-sm text-text", it.total ? "font-bold" : "font-semibold")}>{it.titulo}</div>
              {it.sub && <div className="text-xs text-label leading-snug mt-0.5">{it.sub}</div>}
            </div>
            <div className="text-right shrink-0">
              {it.rotuloValor && <div className="text-xs text-label">{it.rotuloValor}</div>}
              <div className="text-sm font-bold tabular text-text whitespace-nowrap">{it.valor}</div>
            </div>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mt-2.5 text-[13px]">
            {it.campos.map((c) => (
              <div key={c.rotulo} className="min-w-0">
                <dt className="text-xs text-label">{c.rotulo}</dt>
                <dd className="text-text font-semibold tabular">{c.valor}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function RotuloOrigem({ tipo, origem, rota }: { tipo: string; origem: string; rota: string }) {
  return (
    <span>
      {tipo}{" "}
      <Link to={rota} className="text-link hover:underline text-xs">
        {origem}
      </Link>
    </span>
  );
}

function NotaTabela({ cabecalho, grupos, linhas }: { cabecalho: string[]; grupos?: string[]; linhas: LinhaNota[] }) {
  return (
    <div className="overflow-x-auto fiori-scroll">
      <table className={clsx("w-full text-sm", cabecalho.length <= 2 ? "min-w-[300px] sm:min-w-[520px]" : "min-w-[600px]")}>
        <thead>
          {grupos && (
            <tr className="text-[13px]">
              <th />
              {grupos.map((g) => (
                <th key={g} colSpan={cabecalho.length / grupos.length} className="text-center py-1.5 border-b border-line-soft">
                  {g}
                </th>
              ))}
            </tr>
          )}
          <tr className="text-[13px]">
            <th className="text-left py-2 border-b-2 border-brand">R$ mil</th>
            {cabecalho.map((c, i) => (
              <th key={i} className="text-right py-2 pl-4 border-b-2 border-brand whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, n) => {
            if (l.estilo === "secao")
              return (
                <tr key={l.chave ?? n}>
                  <td colSpan={cabecalho.length + 1} className="pt-4 pb-1.5 pl-2 text-[11px] font-bold uppercase tracking-wide text-label border-b border-line-soft">
                    {l.rotulo}
                  </td>
                </tr>
              );
            const saldo = l.estilo === "saldo";
            const dos = l.estilo === "dosQuais";
            return (
              <tr key={l.chave ?? n} className={saldo ? "font-bold bg-surface-3" : ""}>
                <td
                  className={clsx(
                    saldo ? "py-2.5 pl-2 border-y border-line" : "border-b border-line-soft",
                    dos ? "py-1.5 pl-6 text-[13px] italic text-label" : !saldo && "py-2 pl-2",
                    l.estilo === "info" && "text-label",
                  )}
                >
                  {dos ? <>dos quais: {l.rotulo}</> : l.rotulo}
                </td>
                {l.valores.map((v, i) => (
                  <td
                    key={i}
                    className={clsx(
                      "text-right tabular pl-4 pr-2",
                      saldo ? "py-2.5 border-y border-line" : "border-b border-line-soft",
                      dos ? "py-1.5 text-[13px] text-label" : !saldo && "py-2",
                      l.estilo === "info" && "text-label",
                    )}
                  >
                    {fmtK(v)}
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

function ListaEventos({ titulo, eventos }: { titulo: string; eventos: EventoMestre[] }) {
  const cor = (t: TipoContrato) => TIPOS_CONTRATO.find((x) => x.tipo === t)?.cor ?? "#908c85";
  return (
    <div>
      <div className="text-[13px] font-bold text-text mb-1">
        {titulo} <span className="text-label font-normal">({eventos.length})</span>
      </div>
      {eventos.length === 0 ? (
        <p className="text-sm text-label">Nenhum no período.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {eventos.map((e) => (
            <li key={`${e.codigo}-${e.data}-${e.tipo}`} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
              <span className="min-w-0 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cor(e.tipoContrato) }} />
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-text">{e.tipo === "Cupom" || e.tipo === "Vencimento" ? `${e.tipo} ${e.produto}` : e.produto}</span>{" "}
                  <span className="text-label">
                    · {e.contraparte} · {e.empresa} · {fmtDate(e.data)}
                  </span>
                </span>
              </span>
              <span className="tabular text-text whitespace-nowrap">{fmtCompact(e.tipo === "Come-cotas" ? e.ir : e.tipo === "Aplicação" ? e.bruto : e.liquido)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
