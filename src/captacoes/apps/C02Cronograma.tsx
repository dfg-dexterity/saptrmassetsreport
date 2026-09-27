import clsx from "clsx";
import { CheckCircle2, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { IMPORTACAO_SAP } from "../../shared/data/mercado";
import { addDays, addMonths, diffDays, fmtDate, fmtMonthLong, fmtMonthShort, monthOf, yearOf } from "../../shared/lib/dates";
import { exportarExcel, type ColunaExport } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct, fmtX } from "../../shared/lib/format";
import { ESCOPOS, useCovenants, useDivida, type Escopo } from "../context/useDivida";
import { relatorioCaptacao } from "../data/catalogo";
import { EMPRESAS_DIVIDA, GRUPO_MODALIDADE, type ContratoDivida } from "../data/contratos";
import { cronograma, perfilAmortizacao, posicoesDivida, prazoMedioCarteira, totalDivida, type PosicaoDivida } from "../lib/divida";

const rel = relatorioCaptacao("c02");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };
const legendStyle = { fontSize: 12, fontFamily: "72, Arial" };

/** Tolerância de fechamento (R$) entre o perfil de amortização e o principal atualizado */
const TOLERANCIA = 1;
/** A partir do 6º ano do não circulante os anos são agrupados em "AAAA em diante" */
const ANOS_INDIVIDUAIS = 5;

/** Grupos de modalidade na ordem e com as cores do Launchpad (composição por saldo) */
const GRUPOS: { id: string; cor: string }[] = [
  { id: "Debêntures", cor: "#168eff" },
  { id: "BNDES", cor: "#c87b00" },
  { id: "CRA", cor: "#75980b" },
  { id: "CCB", cor: "#df1278" },
  { id: "CRI", cor: "#8b47d7" },
];
const ORDEM_GRUPO = new Map(GRUPOS.map((g, i) => [g.id, i]));
const COR_PRINCIPAL = "#5d36ff";
const COR_JUROS = "#049f9a";
const COR_CP = "#e26300";
const COR_NC = "#0070f2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const grupoDe = (c: ContratoDivida) => GRUPO_MODALIDADE[c.modalidade];
const corDe = (c: ContratoDivida) => GRUPOS.find((g) => g.id === grupoDe(c))?.cor ?? "#758ca4";
const soma = <T,>(xs: T[], fn: (x: T) => number) => xs.reduce((s, x) => s + fn(x), 0);
const mesCurto = (mes: string) => fmtMonthShort(`${mes}-01`);
const mesLongo = (mes: string) => fmtMonthLong(`${mes}-01`);
const nomeMes = (iso: string) => fmtMonthShort(iso).split("/")[0];
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const mi = (v: number) => v / 1e6;

/** Custos de transação como redutora (negativo entre parênteses) */
const fmtRedutora = (v: number) => fmtNum(-v, { parens: true, dash: true });
const fmtValor = (v: number) => fmtNum(v, { dash: true });

/** Rótulo do primeiro ano do não circulante (parcial quando começa depois de janeiro) */
function rotuloAno(ano: number, inicioNC: string): string {
  if (ano !== yearOf(inicioNC) || monthOf(inicioNC) === 1) return String(ano);
  const ini = nomeMes(inicioNC);
  return ini === "dez" ? `${ano} (dez)` : `${ano} (${ini}–dez)`;
}

/** Último dado de mercado disponível na data-base (a importação pode ter dados posteriores a ela) */
function ultimoDadoNaDataBase(dataBase: string): string {
  return dataBase < IMPORTACAO_SAP.ultimoDadoDisponivel ? dataBase : IMPORTACAO_SAP.ultimoDadoDisponivel;
}

/**
 * Custos de transação a apropriar nos 12 meses seguintes (apropriação linear), antes do limite ao circulante do
 * contrato aplicado pelo motor – usado só para explicar o excedente mantido no não circulante.
 */
function custosDozeMeses(x: PosicaoDivida, dataBase: string): number {
  if (x.reclassificado) return x.custosAApropriar;
  const prazo = Math.max(1, diffDays(x.c.dataCaptacao, x.c.vencimento));
  const restantes = Math.max(0, diffDays(dataBase, x.c.vencimento));
  return Math.min(x.custosAApropriar, (x.c.custosTransacao / prazo) * Math.min(365, restantes));
}

function listaIds(ids: string[]): string {
  if (ids.length <= 1) return ids.join("");
  return `${ids.slice(0, -1).join(", ")} e ${ids[ids.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface LinhaComposicao {
  pos: PosicaoDivida;
  /** principal com vencimento contratual em até 12 meses */
  principalContratual: number;
  /** principal de longo prazo levado ao circulante (CPC 26.74) */
  principalReclassificado: number;
  principalCirculante: number;
  juros: number;
  /** custos a apropriar deduzidos do circulante (efetivos, após o limite do circulante do contrato) */
  custosCirculante: number;
  /** excedente dos custos de 12 meses mantido no não circulante (circulante do contrato não fica negativo) */
  excedenteCustos: number;
  circulante: number;
  principalNC: number;
  custosNC: number;
  naoCirculante: number;
  saldo: number;
  /** não circulante pelo cronograma contratual (antes da reclassificação) */
  ncContratual: number;
}

interface Faixa {
  key: string;
  rotulo: string;
  anos: number[];
}

interface LinhaPerfil {
  pos: PosicaoDivida;
  circulante: number;
  porAno: Map<number, number>;
  total: number;
  diferenca: number;
}

interface EventoContrato {
  c: ContratoDivida;
  data: string;
  principal: number;
  juros: number;
}

interface MesFluxo {
  mes: string; // AAAA-MM
  principal: number;
  juros: number;
  total: number;
  eventos: EventoContrato[];
}

interface AnoFluxo {
  ano: number;
  rotulo: string;
  principal: number;
  juros: number;
  total: number;
  contratos: string[];
}

interface LinhaGrupo {
  id: string;
  cor: string;
  contratos: number;
  circulante: number;
  naoCirculante: number;
  total: number;
  share: number;
  prazo: number;
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function C02Cronograma() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, contratos, posicoes } = useDivida(escopo);
  const covenants = useCovenants();
  const [mesEscolhido, setMesEscolhido] = useState<string | null>(null);
  const db = p.dataBase;

  const d = useMemo(() => {
    const limite = addDays(db, 365);
    const inicioNC = addDays(limite, 1);
    const anoNC = yearOf(inicioNC);
    const ordenadas = [...posicoes].sort(
      (a, b) =>
        (ORDEM_GRUPO.get(grupoDe(a.c)) ?? 9) - (ORDEM_GRUPO.get(grupoDe(b.c)) ?? 9) ||
        a.c.vencimento.localeCompare(b.c.vencimento) ||
        a.c.id.localeCompare(b.c.id),
    );

    // Posições sem a reclassificação do CPC 26 (cronograma contratual)
    const contratuais = new Map(posicoesDivida(contratos, db, p).map((x) => [x.c.id, x]));

    // Composição circulante × não circulante
    const composicao: LinhaComposicao[] = ordenadas.map((x) => {
      const contratual = contratuais.get(x.c.id) ?? x;
      const principalContratual = contratual.principalCirculante;
      const custosCirculante = x.principalCirculante + x.jurosAPagar - x.circulante;
      return {
        pos: x,
        principalContratual,
        principalReclassificado: x.principalCirculante - principalContratual,
        principalCirculante: x.principalCirculante,
        juros: x.jurosAPagar,
        custosCirculante,
        excedenteCustos: Math.max(0, custosDozeMeses(x, db) - custosCirculante),
        circulante: x.circulante,
        principalNC: x.principalAtualizado - x.principalCirculante,
        custosNC: x.custosAApropriar - custosCirculante,
        naoCirculante: x.naoCirculante,
        saldo: x.saldoContabil,
        ncContratual: contratual.naoCirculante,
      };
    });
    const tot = <K extends keyof LinhaComposicao>(k: K) => soma(composicao, (l) => l[k] as number);
    const total = totalDivida(posicoes);
    const circulante = tot("circulante");
    const naoCirculante = tot("naoCirculante");
    const principalAtualizado = soma(posicoes, (x) => x.principalAtualizado);
    const custosAApropriar = soma(posicoes, (x) => x.custosAApropriar);
    const reclassificadas = composicao.filter((l) => l.pos.reclassificado);
    const comExcedente = composicao.filter((l) => l.excedenteCustos > 0.5);

    // Perfil de amortização do principal (valor contábil na data-base)
    const perfil: LinhaPerfil[] = ordenadas.map((x) => {
      const pf = perfilAmortizacao(x, db);
      const t = pf.circulante + soma([...pf.porAno.values()], (v) => v);
      return { pos: x, circulante: pf.circulante, porAno: pf.porAno, total: t, diferenca: t - x.principalAtualizado };
    });
    const anosPerfil = perfil.flatMap((l) => [...l.porAno.keys()]);
    const anoMax = anosPerfil.length ? Math.max(...anosPerfil) : anoNC - 1;
    const anos: number[] = [];
    for (let a = anoNC; a <= anoMax; a++) anos.push(a);
    const agrupar = anos.length > ANOS_INDIVIDUAIS + 1;
    const faixas: Faixa[] = agrupar
      ? [
          ...anos.slice(0, ANOS_INDIVIDUAIS).map((a) => ({ key: String(a), rotulo: rotuloAno(a, inicioNC), anos: [a] })),
          { key: "resto", rotulo: `${anos[ANOS_INDIVIDUAIS]} em diante`, anos: anos.slice(ANOS_INDIVIDUAIS) },
        ]
      : anos.map((a) => ({ key: String(a), rotulo: rotuloAno(a, inicioNC), anos: [a] }));
    const divergentes = perfil.filter((l) => Math.abs(l.diferenca) > TOLERANCIA);

    // Gráfico: 12 meses + cada ano do não circulante, empilhado por grupo de modalidade
    const grafico = [
      { rotulo: "12m", rotuloLongo: `Circulante – vencimentos até ${fmtDate(limite)}`, ...Object.fromEntries(GRUPOS.map((g) => [g.id, 0])) } as Record<string, number | string>,
      ...anos.map((a) => ({ rotulo: String(a), rotuloLongo: rotuloAno(a, inicioNC), ...Object.fromEntries(GRUPOS.map((g) => [g.id, 0])) }) as Record<string, number | string>),
    ];
    for (const l of perfil) {
      const g = grupoDe(l.pos.c);
      grafico[0][g] = (grafico[0][g] as number) + mi(l.circulante);
      for (const [a, v] of l.porAno) {
        const linha = grafico[a - anoNC + 1];
        if (linha) linha[g] = (linha[g] as number) + mi(v);
      }
    }
    const gruposPresentes = GRUPOS.filter((g) => posicoes.some((x) => grupoDe(x.c) === g.id));

    // Resumo por grupo de modalidade (principal)
    const grupos: LinhaGrupo[] = gruposPresentes.map((g) => {
      const ls = perfil.filter((l) => grupoDe(l.pos.c) === g.id);
      const circ = soma(ls, (l) => l.circulante);
      const t = soma(ls, (l) => l.pos.principalAtualizado);
      return {
        id: g.id,
        cor: g.cor,
        contratos: ls.length,
        circulante: circ,
        naoCirculante: t - circ,
        total: t,
        share: principalAtualizado > 0 ? t / principalAtualizado : 0,
        prazo: prazoMedioCarteira(ls.map((l) => l.pos)),
      };
    });

    // Fluxos projetados (principal e juros) com o último dado disponível
    const eventos: EventoContrato[] = cronograma(contratos, db, p)
      .flatMap((l) => l.eventos.map((e) => ({ c: l.c, ...e })))
      .sort((a, b) => a.data.localeCompare(b.data) || a.c.id.localeCompare(b.c.id));
    const mesBase = `${db.slice(0, 7)}-01`;
    const meses: MesFluxo[] = Array.from({ length: 12 }, (_, i) => ({
      mes: addMonths(mesBase, i + 1).slice(0, 7),
      principal: 0,
      juros: 0,
      total: 0,
      eventos: [] as EventoContrato[],
    }));
    const porAnoFluxo = new Map<number, AnoFluxo>();
    for (const e of eventos) {
      if (e.data <= limite) {
        const m = meses.find((x) => x.mes === e.data.slice(0, 7));
        if (!m) continue;
        m.principal += e.principal;
        m.juros += e.juros;
        m.total += e.principal + e.juros;
        m.eventos.push(e);
      } else {
        const a = yearOf(e.data);
        const linha = porAnoFluxo.get(a) ?? { ano: a, rotulo: rotuloAno(a, inicioNC), principal: 0, juros: 0, total: 0, contratos: [] };
        linha.principal += e.principal;
        linha.juros += e.juros;
        linha.total += e.principal + e.juros;
        if (!linha.contratos.includes(e.c.id)) linha.contratos.push(e.c.id);
        porAnoFluxo.set(a, linha);
      }
    }
    const anosFluxo = [...porAnoFluxo.values()].sort((a, b) => a.ano - b.ano);
    const fluxo12 = {
      principal: soma(meses, (m) => m.principal),
      juros: soma(meses, (m) => m.juros),
      total: soma(meses, (m) => m.total),
    };
    const fluxoApos = {
      principal: soma(anosFluxo, (a) => a.principal),
      juros: soma(anosFluxo, (a) => a.juros),
      total: soma(anosFluxo, (a) => a.total),
    };

    // Próximo pagamento (todos os contratos com evento na primeira data futura)
    const primeiro = eventos[0];
    const proximo = primeiro
      ? (() => {
          const doDia = eventos.filter((e) => e.data === primeiro.data);
          return {
            data: primeiro.data,
            principal: soma(doDia, (e) => e.principal),
            juros: soma(doDia, (e) => e.juros),
            ids: [...new Set(doDia.map((e) => e.c.id))],
          };
        })()
      : null;

    const principalContratual12m = tot("principalContratual");

    return {
      limite,
      inicioNC,
      total,
      circulante,
      naoCirculante,
      principalAtualizado,
      custosAApropriar,
      jurosAPagar: tot("juros"),
      principalContratual12m,
      principalReclassificado: tot("principalReclassificado"),
      custosCirculante: tot("custosCirculante"),
      principalNC: tot("principalNC"),
      custosNC: tot("custosNC"),
      composicao,
      reclassificadas,
      comExcedente,
      excedente: tot("excedenteCustos"),
      perfil,
      anos,
      faixas,
      divergentes,
      grafico,
      gruposPresentes,
      grupos,
      eventos,
      meses,
      anosFluxo,
      fluxo12,
      fluxoApos,
      proximo,
      prazoMedio: prazoMedioCarteira(posicoes),
      difComposicao: circulante + naoCirculante - total,
    };
  }, [posicoes, contratos, p, db]);

  const mesSel = d.meses.find((m) => m.mes === mesEscolhido) ?? d.meses.find((m) => m.eventos.length > 0) ?? d.meses[0];
  const pctCirculante = d.total > 0 ? d.circulante / d.total : 0;
  const haReclassificacao = d.reclassificadas.length > 0;
  const idsEscopo = new Set(posicoes.map((x) => x.c.id));
  const covReclassifica = covenants.filter((a) => a.reclassifica && a.cov.contratos.some((id) => idsEscopo.has(id)));
  const covWaiver = covenants.filter(
    (a) => a.status === "excedido" && a.waiverVigente && a.cov.contratos.some((id) => idsEscopo.has(id)),
  );
  const ultimoDado = ultimoDadoNaDataBase(db);
  const textoPremissas = `CDI ${fmtPct(p.cdi)} a.a., IPCA ${fmtPct(p.ipca12m)} em 12 meses, TJLP ${fmtPct(p.tjlp)} a.a. e TLP ${fmtPct(p.tlpReal)} a.a. real`;
  const escopoLabel = ESCOPOS.find((e) => e.value === escopo)?.label ?? "";
  const difPrincipal12m = d.fluxo12.principal - d.principalContratual12m;

  // -------------------------------------------------------------------------
  // Exportação
  // -------------------------------------------------------------------------

  const exportar = () => {
    const moeda = (titulo: string, largura = 16): ColunaExport => ({ titulo, tipo: "moeda", largura });
    const c = d.composicao;
    const s = (fn: (l: LinhaComposicao) => number) => soma(c, fn);
    exportarExcel(
      `C02_Vencimentos_CP_LP_${db}.xlsx`,
      [
        {
          nome: "CP x LP por contrato",
          titulo: "C02 – Composição circulante × não circulante (CPC 26)",
          subtitulo: `${escopoLabel} · saldo pelo custo amortizado`,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Instrumento", largura: 48 },
            { titulo: "Grupo", largura: 12 },
            { titulo: "Empresa", largura: 22 },
            moeda("Principal circulante"),
            moeda("Juros a pagar"),
            moeda("(−) Custos circulante"),
            moeda("Circulante"),
            moeda("Principal não circulante"),
            moeda("(−) Custos não circulante"),
            moeda("Não circulante"),
            moeda("Saldo contábil"),
            { titulo: "Reclassificado (CPC 26.74)", largura: 14 },
          ],
          linhas: c.map((l) => [
            l.pos.c.id,
            l.pos.c.instrumento,
            grupoDe(l.pos.c),
            `${l.pos.c.empresa} – ${EMPRESAS_DIVIDA[l.pos.c.empresa] ?? ""}`,
            l.principalCirculante,
            l.juros,
            -l.custosCirculante,
            l.circulante,
            l.principalNC,
            -l.custosNC,
            l.naoCirculante,
            l.saldo,
            l.pos.reclassificado ? "Sim" : "Não",
          ]),
          total: [
            "Total",
            "",
            "",
            "",
            s((l) => l.principalCirculante),
            s((l) => l.juros),
            -s((l) => l.custosCirculante),
            s((l) => l.circulante),
            s((l) => l.principalNC),
            -s((l) => l.custosNC),
            s((l) => l.naoCirculante),
            s((l) => l.saldo),
            "",
          ],
          notas: [
            "Circulante = principal com vencimento em até 12 meses + juros a pagar − custos de transação a apropriar nos próximos 12 meses (CPC 26).",
            "Não circulante = demais parcelas do principal − custos de transação restantes.",
            ...(d.excedente > 0.5
              ? [
                  `Custos dos próximos 12 meses acima do circulante do contrato (${listaIds(d.comExcedente.map((l) => l.pos.c.id))}): o excedente de ${fmtBRL(d.excedente)} permanece no não circulante.`,
                ]
              : []),
            ...(haReclassificacao
              ? [
                  `Contratos reclassificados para o circulante (covenant descumprido sem waiver na data do balanço – CPC 26, item 74): ${listaIds(d.reclassificadas.map((l) => l.pos.c.id))}.`,
                ]
              : []),
          ],
        },
        {
          nome: "Perfil de amortização",
          titulo: "C02 – Perfil de amortização do principal",
          subtitulo: `${escopoLabel} · principal atualizado pelo valor contábil da data-base`,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Grupo", largura: 12 },
            { titulo: "Vencimento", tipo: "data", largura: 12 },
            moeda("Circulante (12 meses)"),
            ...d.anos.map((a) => moeda(rotuloAno(a, d.inicioNC), 14)),
            moeda("Total"),
            moeda("Principal atualizado"),
            moeda("Diferença", 12),
          ],
          linhas: d.perfil.map((l) => [
            l.pos.c.id,
            grupoDe(l.pos.c),
            l.pos.c.vencimento,
            l.circulante,
            ...d.anos.map((a) => l.porAno.get(a) ?? 0),
            l.total,
            l.pos.principalAtualizado,
            l.diferenca,
          ]),
          total: [
            "Total",
            "",
            "",
            soma(d.perfil, (l) => l.circulante),
            ...d.anos.map((a) => soma(d.perfil, (l) => l.porAno.get(a) ?? 0)),
            soma(d.perfil, (l) => l.total),
            d.principalAtualizado,
            soma(d.perfil, (l) => l.diferenca),
          ],
          notas: [
            `Circulante: parcelas com vencimento até ${fmtDate(d.limite)}${haReclassificacao ? " e todo o principal dos contratos reclassificados (CPC 26, item 74)" : ""}.`,
            "Principal pelo valor contábil na data-base (fator de atualização monetária da data-base, sem projeção).",
          ],
        },
        {
          nome: "Fluxos 12 meses",
          titulo: "C02 – Fluxos projetados nos próximos 12 meses",
          subtitulo: `${escopoLabel} · pagamentos de principal e juros por mês`,
          colunas: [{ titulo: "Mês", largura: 12 }, moeda("Principal"), moeda("Juros"), moeda("Total"), { titulo: "Contratos", largura: 40 }],
          linhas: d.meses.map((m) => [mesCurto(m.mes), m.principal, m.juros, m.total, [...new Set(m.eventos.map((e) => e.c.id))].join(", ")]),
          total: ["Total 12 meses", d.fluxo12.principal, d.fluxo12.juros, d.fluxo12.total, ""],
          notas: [
            `Juros e atualização monetária projetados com o último dado disponível importado do SAP (${fmtDate(ultimoDado)}): ${textoPremissas}.`,
          ],
        },
        {
          nome: "Fluxos por ano",
          titulo: "C02 – Fluxos projetados após 12 meses",
          subtitulo: `${escopoLabel} · pagamentos de principal e juros por ano`,
          colunas: [{ titulo: "Período", largura: 16 }, moeda("Principal"), moeda("Juros"), moeda("Total"), { titulo: "Contratos", largura: 40 }],
          linhas: d.anosFluxo.map((a) => [a.rotulo, a.principal, a.juros, a.total, a.contratos.join(", ")]),
          total: ["Total após 12 meses", d.fluxoApos.principal, d.fluxoApos.juros, d.fluxoApos.total, ""],
          notas: [
            `Juros e atualização monetária projetados com o último dado disponível importado do SAP (${fmtDate(ultimoDado)}): ${textoPremissas}.`,
          ],
        },
        {
          nome: "Fluxos por contrato",
          titulo: "C02 – Cronograma de pagamentos por contrato",
          subtitulo: `${escopoLabel} · todos os eventos futuros`,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Instrumento", largura: 48 },
            { titulo: "Data", tipo: "data", largura: 12 },
            moeda("Principal"),
            moeda("Juros"),
            moeda("Total"),
          ],
          linhas: d.eventos.map((e) => [e.c.id, e.c.instrumento, e.data, e.principal, e.juros, e.principal + e.juros]),
          total: ["Total", "", "", d.fluxo12.principal + d.fluxoApos.principal, d.fluxo12.juros + d.fluxoApos.juros, d.fluxo12.total + d.fluxoApos.total],
          notas: [`Valores projetados com o último dado disponível importado do SAP (${textoPremissas}).`],
        },
      ],
      db,
    );
  };

  // -------------------------------------------------------------------------
  // Colunas
  // -------------------------------------------------------------------------

  const colContrato = <T extends { pos: PosicaoDivida }>(sub: (x: T) => ReactNode): Column<T> => ({
    key: "contrato",
    header: "Contrato",
    sticky: true,
    minWidth: 130,
    value: (x) => x.pos.c.id,
    render: (x) => (
      <div className="min-w-0 py-0.5">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: corDe(x.pos.c) }} />
          <span className="font-semibold text-text whitespace-nowrap">{x.pos.c.id}</span>
          {x.pos.reclassificado && (
            <ObjectStatus state="negative" inverted icon={false}>
              CPC 26.74
            </ObjectStatus>
          )}
        </div>
        <div className="hidden sm:block text-xs text-label mt-0.5 pl-[18px] whitespace-nowrap">{sub(x)}</div>
      </div>
    ),
  });

  const num = <T,>(key: string, header: string, fn: (x: T) => number, opts: { redutora?: boolean; bold?: boolean; minWidth?: number; headerTitle?: string } = {}): Column<T> => ({
    key,
    header,
    align: "right",
    minWidth: opts.minWidth ?? 116,
    headerTitle: opts.headerTitle,
    value: fn,
    render: (x) => <span className={clsx(opts.bold && "font-semibold")}>{opts.redutora ? fmtRedutora(fn(x)) : fmtValor(fn(x))}</span>,
    total: (rows) => (opts.redutora ? fmtRedutora(soma(rows, fn)) : fmtValor(soma(rows, fn))),
  });

  const colComposicao: Column<LinhaComposicao>[] = [
    colContrato<LinhaComposicao>((x) => `${x.pos.c.modalidade} · venc. ${fmtDate(x.pos.c.vencimento)}`),
    num("pc", "Principal circ.", (x) => x.principalCirculante, { headerTitle: "Principal com vencimento em até 12 meses (ou todo o principal, se reclassificado)" }),
    num("juros", "Juros a pagar", (x) => x.juros),
    num("cc", "(−) Custos circ.", (x) => x.custosCirculante, { redutora: true, headerTitle: "Custos de transação a apropriar nos próximos 12 meses" }),
    num("circ", "Circulante", (x) => x.circulante, { bold: true }),
    num("pnc", "Principal não circ.", (x) => x.principalNC, { minWidth: 130 }),
    num("cnc", "(−) Custos não circ.", (x) => x.custosNC, { redutora: true, minWidth: 130, headerTitle: "Custos de transação a apropriar após 12 meses" }),
    num("nc", "Não circulante", (x) => x.naoCirculante, { bold: true, minWidth: 124 }),
    num("saldo", "Saldo contábil", (x) => x.saldo, { bold: true, minWidth: 124 }),
  ];

  const colPerfil: Column<LinhaPerfil>[] = [
    colContrato<LinhaPerfil>((x) => `${x.pos.c.descricaoAmortizacao}`),
    num("circ", "Circulante (12 meses)", (x) => x.circulante, { bold: true, minWidth: 150 }),
    ...d.faixas.map((f) =>
      num<LinhaPerfil>(f.key, f.rotulo, (x) => soma(f.anos, (a) => x.porAno.get(a) ?? 0), {
        minWidth: f.anos.length > 1 || f.rotulo.length > 6 ? 128 : 104,
        headerTitle: f.anos.length > 1 ? `${f.anos[0]} a ${f.anos[f.anos.length - 1]}` : undefined,
      }),
    ),
    {
      key: "total",
      header: "Total",
      align: "right",
      minWidth: 140,
      value: (x) => x.total,
      render: (x) => {
        const ok = Math.abs(x.diferenca) <= TOLERANCIA;
        return (
          <span
            className="inline-flex items-center gap-1.5 font-semibold"
            title={ok ? "Confere com o principal atualizado" : `Diferença de ${fmtBRL(x.diferenca, true)} em relação ao principal atualizado`}
          >
            {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-positive shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-negative shrink-0" />}
            {fmtValor(x.total)}
          </span>
        );
      },
      total: (rows) => fmtValor(soma(rows, (x) => x.total)),
    },
  ];

  const colAnos: Column<AnoFluxo>[] = [
    {
      key: "periodo",
      header: "Período",
      minWidth: 120,
      value: (x) => x.ano,
      render: (x) => <span className="font-semibold text-text whitespace-nowrap">{x.rotulo}</span>,
    },
    {
      key: "contratos",
      header: "Contratos",
      align: "right",
      minWidth: 90,
      headerTitle: "Contratos com pagamento no período",
      value: (x) => x.contratos.length,
      render: (x) => <span title={x.contratos.join(", ")}>{x.contratos.length}</span>,
    },
    num("principal", "Principal", (x) => x.principal),
    num("juros", "Juros", (x) => x.juros),
    num("total", "Total", (x) => x.total, { bold: true }),
    {
      key: "part",
      header: "Participação",
      align: "right",
      minWidth: 130,
      value: (x) => x.total,
      render: (x) => {
        const share = d.fluxoApos.total > 0 ? x.total / d.fluxoApos.total : 0;
        return (
          <div className="flex items-center justify-end gap-2">
            <MicroBar className="w-14" value={share} max={Math.max(...d.anosFluxo.map((a) => a.total / d.fluxoApos.total))} color={COR_PRINCIPAL} />
            <span className="tabular w-12 text-right">{fmtPct(share, 1)}</span>
          </div>
        );
      },
      total: () => fmtPct(1, 1),
    },
  ];

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const graficoMeses = d.meses.map((m) => ({ mes: m.mes, principal: mi(m.principal), juros: mi(m.juros) }));
  const graficoAnos = d.anosFluxo.map((a) => ({ ano: String(a.ano), rotulo: a.rotulo, principal: mi(a.principal), juros: mi(a.juros) }));

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi
            label="Circulante"
            value={fmtCompact(d.circulante)}
            state={haReclassificacao ? "negative" : "neutral"}
            sub={haReclassificacao ? "inclui CPC 26.74" : "até 12 meses"}
          />
          <HeaderKpi label="Não circulante" value={fmtCompact(d.naoCirculante)} sub="após 12 meses" />
          <HeaderKpi
            label="% circulante"
            value={fmtPct(pctCirculante, 1)}
            state={haReclassificacao ? "negative" : pctCirculante > 0.25 ? "critical" : "neutral"}
            sub={`de ${fmtCompact(d.total)}`}
          />
          <HeaderKpi
            label="Principal a vencer 12m"
            value={fmtCompact(d.principalContratual12m)}
            sub="cronograma contratual"
          />
          <HeaderKpi
            label="Próximo pagamento"
            value={d.proximo ? fmtCompact(d.proximo.principal + d.proximo.juros) : "—"}
            state="information"
            sub={d.proximo ? `${fmtDate(d.proximo.data)} · ${d.proximo.ids.join(", ")}` : "Sem pagamentos futuros"}
          />
          <HeaderKpi label="Prazo médio" value={fmtDec(d.prazoMedio, 1)} unit="anos" sub="amortização do principal" />
        </>
      }
    >
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <FilterField label="Empresa">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <div className="sm:col-span-2 text-[13px] text-label sm:text-right">
            {plural(posicoes.length, "contrato ativo", "contratos ativos")} · circulante: vencimentos até {fmtDate(d.limite)} · valores em R$
          </div>
        </div>
      </div>

      {covReclassifica.map((a) => {
        const ls = d.reclassificadas.filter((l) => a.cov.contratos.includes(l.pos.c.id));
        return (
          <MessageStrip key={a.cov.id} design="negative">
            <strong>Reclassificação para o circulante (CPC 26, item 74).</strong> O covenant {a.cov.indicador} foi descumprido na
            data do balanço: {fmtX(a.valor)} apurado em {fmtDate(a.dataApuracao)} contra o mínimo de {fmtX(a.cov.limite)}, sem
            waiver obtido até essa data
            {a.waiver ? ` (a anuência do ${a.waiver.credor} só foi formalizada em ${fmtDate(a.waiver.obtidoEm)})` : ""}. Por isso,
            todo o saldo de {listaIds(ls.map((l) => l.pos.c.id))} — <strong>{fmtBRL(soma(ls, (l) => l.saldo))}</strong> — está
            classificado no circulante, dos quais {fmtBRL(soma(ls, (l) => l.ncContratual))} seriam não circulante pelo cronograma
            contratual.{" "}
            <Link to="/c04-covenants" className="text-link hover:underline whitespace-nowrap">
              Ver covenants (C04)
            </Link>
          </MessageStrip>
        );
      })}
      {!haReclassificacao &&
        covWaiver.map((a) => (
          <MessageStrip key={a.cov.id} design="information">
            O covenant {a.cov.indicador} ficou abaixo do limite em {fmtDate(a.dataApuracao)} ({fmtX(a.valor)} contra o mínimo de{" "}
            {fmtX(a.cov.limite)}), mas o waiver do {a.waiver?.credor} foi obtido em {fmtDate(a.waiver?.obtidoEm)}, antes desta
            data-base: {listaIds(a.cov.contratos.filter((id) => idsEscopo.has(id)))} seguem classificados pelo cronograma
            contratual.{" "}
            <Link to="/c04-covenants" className="text-link hover:underline whitespace-nowrap">
              Ver covenants (C04)
            </Link>
          </MessageStrip>
        ))}

      {/* Composição CP × LP */}
      <Card
        title="Composição circulante × não circulante"
        subtitle="CPC 26 – saldo pelo custo amortizado na data-base, classificado pelo cronograma contratual de amortização"
        status={<Tag>CPC 26</Tag>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <BlocoComposicao
            titulo="Passivo circulante"
            cor={COR_CP}
            share={pctCirculante}
            linhas={[
              { rotulo: "Principal com vencimento em até 12 meses", valor: d.principalContratual12m },
              ...(haReclassificacao
                ? [{ rotulo: "Principal de longo prazo reclassificado (CPC 26.74)", valor: d.principalReclassificado, negativo: true }]
                : []),
              { rotulo: "(+) Juros a pagar", valor: d.jurosAPagar },
              { rotulo: `(−) Custos de transação a apropriar em 12 meses${d.excedente > 0.5 ? " ¹" : ""}`, valor: -d.custosCirculante },
            ]}
            total={{ rotulo: "Circulante", valor: d.circulante }}
          />
          <BlocoComposicao
            titulo="Passivo não circulante"
            cor={COR_NC}
            share={1 - pctCirculante}
            linhas={[
              { rotulo: "Principal com vencimento após 12 meses", valor: d.principalNC },
              { rotulo: `(−) Custos de transação a apropriar após 12 meses${d.excedente > 0.5 ? " ¹" : ""}`, valor: -d.custosNC },
            ]}
            total={{ rotulo: "Não circulante", valor: d.naoCirculante }}
          />
          <div className="rounded-lg border border-line-soft p-3.5 flex flex-col">
            <div className="text-[13px] font-semibold text-text">Saldo pelo custo amortizado</div>
            <div className="text-[1.625rem] leading-tight font-light tabular text-text mt-1">{fmtBRL(d.total)}</div>
            <div className="flex h-3 rounded-full overflow-hidden bg-[#eff1f2] mt-3" aria-hidden>
              <div style={{ width: `${pctCirculante * 100}%`, backgroundColor: COR_CP }} />
              <div style={{ width: `${(1 - pctCirculante) * 100}%`, backgroundColor: COR_NC }} />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-label mt-1.5">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COR_CP }} />
                Circulante {fmtPct(pctCirculante, 1)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COR_NC }} />
                Não circulante {fmtPct(1 - pctCirculante, 1)}
              </span>
            </div>
            <dl className="mt-3 space-y-1 text-[13px]">
              <LinhaValor rotulo="Principal atualizado" valor={d.principalAtualizado} />
              <LinhaValor rotulo="(+) Juros a pagar" valor={d.jurosAPagar} />
              <LinhaValor rotulo="(−) Custos de transação a apropriar" valor={-d.custosAApropriar} />
            </dl>
            <div className="mt-auto pt-3">
              {Math.abs(d.difComposicao) <= TOLERANCIA ? (
                <Conferencia ok>
                  Circulante + não circulante = saldo da carteira (<Link to="/c00-carteira" className="text-link hover:underline">C00</Link>)
                </Conferencia>
              ) : (
                <Conferencia ok={false}>Diferença de {fmtBRL(d.difComposicao, true)} em relação ao saldo da carteira (C00)</Conferencia>
              )}
            </div>
          </div>
        </div>
        {d.excedente > 0.5 && (
          <p className="text-xs text-label mt-3 leading-relaxed">
            ¹ Em {listaIds(d.comExcedente.map((l) => l.pos.c.id))}, não há principal no curto prazo e os custos de transação dos
            próximos 12 meses superam os juros a pagar; o excedente ({fmtBRL(d.excedente)}) permanece no não circulante para
            que o circulante do contrato não fique negativo.
          </p>
        )}
        <div className="mt-4 -mx-4 border-t border-line-soft">
          <DataTable columns={colComposicao} rows={d.composicao} rowKey={(x) => x.pos.c.id} showTotals />
        </div>
      </Card>

      {/* Perfil por ano × grupo */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card
          className="xl:col-span-2 flex flex-col"
          bodyClassName="flex-1 flex flex-col"
          title="Vencimentos do principal por ano"
          subtitle={`R$ milhões por grupo de modalidade · 12 meses (circulante) e anos do não circulante${d.anos.length && monthOf(d.inicioNC) !== 1 ? ` (${d.anos[0]}: ${nomeMes(d.inicioNC)}–dez)` : ""}`}
        >
          <div className="h-72 sm:h-80 xl:h-auto xl:flex-1 xl:min-h-[320px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.grafico} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="rotulo" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => fmtDec(v, 0)} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "#eaecee", fillOpacity: 0.6 }}
                  labelFormatter={(_: unknown, pl: ReadonlyArray<{ payload?: { rotuloLongo?: string } }>) => pl?.[0]?.payload?.rotuloLongo ?? ""}
                  formatter={(v: number, n: string) => [`R$ ${fmtDec(v, 2)} mi`, n]}
                />
                <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
                {d.gruposPresentes.map((g) => (
                  <Bar key={g.id} dataKey={g.id} name={g.id} stackId="p" fill={g.cor} maxBarSize={56} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Por grupo de modalidade" subtitle="Principal atualizado: 12 meses × não circulante e prazo médio">
          <ul className="divide-y divide-line-soft -mt-1">
            {d.grupos.map((g) => (
              <li key={g.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="inline-flex items-center gap-2 font-semibold text-text">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.cor }} />
                    {g.id}
                    <span className="text-label font-normal">({g.contratos})</span>
                  </span>
                  <span className="tabular font-semibold text-text whitespace-nowrap">{fmtCompact(g.total)}</span>
                </div>
                <MicroBar className="mt-1.5" value={g.share} color={g.cor} />
                <div className="flex items-center justify-between gap-3 text-xs text-label mt-1.5 tabular">
                  <span className="whitespace-nowrap">
                    12 meses <span className="text-text font-semibold">{fmtCompact(g.circulante)}</span>
                  </span>
                  <span className="whitespace-nowrap">
                    Não circ. <span className="text-text font-semibold">{fmtCompact(g.naoCirculante)}</span>
                  </span>
                  <span className="whitespace-nowrap" title="Prazo médio do principal">
                    <span className="text-text font-semibold">{fmtDec(g.prazo, 1)}</span> anos
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-1 pt-2 border-t border-line-soft flex items-center justify-between gap-3 text-xs">
            <span className="text-label">Principal atualizado ({plural(posicoes.length, "contrato", "contratos")})</span>
            <span className="font-semibold text-text tabular whitespace-nowrap">{fmtCompact(d.principalAtualizado)}</span>
          </div>
        </Card>
      </div>

      <Card
        title="Perfil de amortização do principal"
        subtitle={`Principal atualizado pelo valor contábil da data-base, por contrato · circulante = vencimentos até ${fmtDate(d.limite)} · valores em R$`}
        bodyClassName="px-0 pb-0"
      >
        <div className="px-4 pb-3">
          {d.divergentes.length === 0 ? (
            <MessageStrip design="positive">
              Perfil conferido: a soma das parcelas fecha com o principal atualizado de todos os{" "}
              {plural(d.perfil.length, "contrato", "contratos")} ({fmtBRL(d.principalAtualizado)}).
            </MessageStrip>
          ) : (
            <MessageStrip design="negative">
              O perfil não fecha com o principal atualizado em {listaIds(d.divergentes.map((l) => l.pos.c.id))}: diferença de{" "}
              {fmtBRL(soma(d.divergentes, (l) => l.diferenca), true)}.
            </MessageStrip>
          )}
        </div>
        <div className="border-t border-line-soft">
          <DataTable columns={colPerfil} rows={d.perfil} rowKey={(x) => x.pos.c.id} showTotals />
        </div>
        {haReclassificacao && (
          <p className="text-xs text-label px-4 py-3 leading-relaxed border-t border-line-soft">
            Contratos marcados com <strong className="text-negative">CPC 26.74</strong> têm todo o principal no circulante por
            descumprimento de covenant sem waiver na data do balanço; o cronograma contratual segue nos fluxos projetados abaixo.
          </p>
        )}
      </Card>

      {/* Fluxos projetados */}
      <Card
        title="Fluxos projetados"
        subtitle="Pagamentos futuros de principal e juros pelo cronograma contratual · clique em um mês para ver os pagamentos"
      >
        <MessageStrip design="information" className="mb-4">
          Juros projetados com o último dado disponível importado do SAP ({fmtDate(ultimoDado)}): <strong>{textoPremissas}</strong>,
          mantidos constantes após a data-base. O principal dos contratos IPCA e TLP inclui a atualização monetária projetada
          até cada pagamento.{" "}
          <Link to="/premissas" className="text-link hover:underline whitespace-nowrap">
            Ver premissas
          </Link>
        </MessageStrip>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <div className="xl:col-span-3 min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
              <h4 className="text-sm font-bold text-text">Próximos 12 meses</h4>
              <span className="text-xs text-label">R$ milhões por mês</span>
            </div>
            <div className="h-72 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={graficoMeses}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  barCategoryGap="22%"
                  onClick={(s: { activeLabel?: string | number } | null) => s?.activeLabel && setMesEscolhido(String(s.activeLabel))}
                  className="cursor-pointer"
                >
                  <CartesianGrid vertical={false} stroke="#e5e5e5" />
                  <XAxis dataKey="mes" tickFormatter={mesCurto} tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                  <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => fmtDec(v, 0)} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "#eaecee", fillOpacity: 0.6 }}
                    labelFormatter={(m: string) => mesLongo(m)}
                    formatter={(v: number, n: string) => [`R$ ${fmtDec(v, 2)} mi`, n]}
                  />
                  <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
                  <ReferenceArea x1={mesSel.mes} x2={mesSel.mes} fill="#0070f2" fillOpacity={0.08} stroke="#0070f2" strokeOpacity={0.35} strokeDasharray="3 3" />
                  <Bar dataKey="principal" name="Principal" stackId="f" fill={COR_PRINCIPAL} maxBarSize={44} isAnimationActive={false} />
                  <Bar dataKey="juros" name="Juros" stackId="f" fill={COR_JUROS} maxBarSize={44} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Mini rotulo="Principal" valor={fmtCompact(d.fluxo12.principal)} />
              <Mini rotulo="Juros" valor={fmtCompact(d.fluxo12.juros)} />
              <Mini rotulo="Total" valor={fmtCompact(d.fluxo12.total)} />
            </div>
            <p className="text-xs text-label mt-2 leading-relaxed">
              Principal projetado em 12 meses ({fmtBRL(d.fluxo12.principal)}) × principal a vencer pelo valor contábil da
              data-base ({fmtBRL(d.principalContratual12m)}): diferença de {fmtBRL(difPrincipal12m)}
              {Math.abs(difPrincipal12m) > TOLERANCIA ? ", correspondente à atualização monetária futura (IPCA/TLP) até as datas de pagamento" : ""}.
            </p>
          </div>

          <div className="xl:col-span-2 xl:row-span-2 min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
              <h4 className="text-sm font-bold text-text">Quadro mensal</h4>
              <span className="text-xs text-label">valores em R$</span>
            </div>
            <div className="overflow-x-auto fiori-scroll -mx-4 xl:mx-0">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="text-left pl-4 xl:pl-3 pr-2 sm:pr-3 py-2.5 font-semibold text-[13px] border-b border-[#a8b2bd] whitespace-nowrap">Mês</th>
                    <th className="text-right px-2 sm:px-3 py-2.5 font-semibold text-[13px] border-b border-[#a8b2bd] whitespace-nowrap">Principal</th>
                    <th className="text-right px-2 sm:px-3 py-2.5 font-semibold text-[13px] border-b border-[#a8b2bd] whitespace-nowrap">Juros</th>
                    <th className="text-right pl-2 sm:pl-3 pr-4 xl:pr-3 py-2.5 font-semibold text-[13px] border-b border-[#a8b2bd] whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.meses.map((m) => {
                    const sel = m.mes === mesSel.mes;
                    return (
                      <tr
                        key={m.mes}
                        onClick={() => setMesEscolhido(m.mes)}
                        className={clsx("cursor-pointer", sel ? "bg-selected" : "hover:bg-[#f2f4f6]")}
                      >
                        <td
                          className={clsx(
                            "pl-4 xl:pl-3 pr-2 sm:pr-3 py-2 text-[13px] border-b border-line-soft whitespace-nowrap",
                            sel && "shadow-[inset_3px_0_0_#0064d9] font-semibold",
                          )}
                        >
                          {mesCurto(m.mes)}
                          <span className="text-label font-normal ml-1.5">({m.eventos.length})</span>
                        </td>
                        <td className="px-2 sm:px-3 py-2 text-right tabular text-[13px] border-b border-line-soft whitespace-nowrap">{fmtValor(m.principal)}</td>
                        <td className="px-2 sm:px-3 py-2 text-right tabular text-[13px] border-b border-line-soft whitespace-nowrap">{fmtValor(m.juros)}</td>
                        <td className="pl-2 sm:pl-3 pr-4 xl:pr-3 py-2 text-right tabular text-[13px] border-b border-line-soft whitespace-nowrap font-semibold">
                          {fmtValor(m.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[#f5f6f7] font-bold">
                    <td className="pl-4 xl:pl-3 pr-2 sm:pr-3 py-2.5 text-[13px] border-t border-[#a8b2bd] whitespace-nowrap">Total 12 meses</td>
                    <td className="px-2 sm:px-3 py-2.5 text-right tabular text-[13px] border-t border-[#a8b2bd] whitespace-nowrap">{fmtValor(d.fluxo12.principal)}</td>
                    <td className="px-2 sm:px-3 py-2.5 text-right tabular text-[13px] border-t border-[#a8b2bd] whitespace-nowrap">{fmtValor(d.fluxo12.juros)}</td>
                    <td className="pl-2 sm:pl-3 pr-4 xl:pr-3 py-2.5 text-right tabular text-[13px] border-t border-[#a8b2bd] whitespace-nowrap">{fmtValor(d.fluxo12.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="xl:col-span-3 min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
              <h4 className="text-sm font-bold text-text">Pagamentos em {mesLongo(mesSel.mes)}</h4>
              <span className="text-xs text-label tabular">{fmtBRL(mesSel.total)}</span>
            </div>
            {mesSel.eventos.length === 0 ? (
              <p className="text-sm text-label py-3">Sem pagamentos no mês.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {mesSel.eventos.map((e) => (
                  <li key={`${e.c.id}-${e.data}`} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-text">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: corDe(e.c) }} />
                        <span className="truncate">
                          {e.c.id} · {e.c.credor}
                        </span>
                      </div>
                      <div className="text-xs text-label pl-4 truncate">
                        {fmtDate(e.data)} · {e.principal > 0 && e.juros > 0 ? "principal e juros" : e.principal > 0 ? "principal" : "juros"}
                        {e.data === e.c.vencimento ? " · vencimento final" : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="tabular font-semibold text-text whitespace-nowrap">{fmtBRL(e.principal + e.juros)}</div>
                      {e.principal > 0 && e.juros > 0 && (
                        <div className="text-xs text-label tabular whitespace-nowrap">
                          {fmtCompact(e.principal)} + {fmtCompact(e.juros)}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 mt-6">
          <div className="xl:col-span-2 min-w-0 flex flex-col">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
              <h4 className="text-sm font-bold text-text">Anos seguintes</h4>
              <span className="text-xs text-label">R$ milhões por ano</span>
            </div>
            <div className="h-72 xl:h-auto xl:flex-1 xl:min-h-[300px] -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={graficoAnos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="#e5e5e5" />
                  <XAxis dataKey="ano" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                  <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => fmtDec(v, 0)} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "#eaecee", fillOpacity: 0.6 }}
                    labelFormatter={(_: unknown, pl: ReadonlyArray<{ payload?: { rotulo?: string } }>) => pl?.[0]?.payload?.rotulo ?? ""}
                    formatter={(v: number, n: string) => [`R$ ${fmtDec(v, 2)} mi`, n]}
                  />
                  <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
                  <Bar dataKey="principal" name="Principal" stackId="a" fill={COR_PRINCIPAL} maxBarSize={44} isAnimationActive={false} />
                  <Bar dataKey="juros" name="Juros" stackId="a" fill={COR_JUROS} maxBarSize={44} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="xl:col-span-3 min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
              <h4 className="text-sm font-bold text-text">Pagamentos após {fmtDate(d.limite)}</h4>
              <span className="text-xs text-label">valores em R$</span>
            </div>
            <div className="-mx-4 xl:mx-0">
              <DataTable columns={colAnos} rows={d.anosFluxo} rowKey={(x) => String(x.ano)} showTotals totalLabel="Total após 12 meses" emptyText="Sem pagamentos após 12 meses" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] mt-3 px-0.5">
              <span className="text-label">Total dos fluxos futuros ({plural(d.eventos.length, "pagamento", "pagamentos")})</span>
              <span className="tabular font-bold text-text whitespace-nowrap">{fmtBRL(d.fluxo12.total + d.fluxoApos.total)}</span>
            </div>
          </div>
        </div>
      </Card>
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Componentes locais
// ---------------------------------------------------------------------------

function BlocoComposicao({
  titulo,
  cor,
  share,
  linhas,
  total,
}: {
  titulo: string;
  cor: string;
  share: number;
  linhas: { rotulo: string; valor: number; negativo?: boolean }[];
  total: { rotulo: string; valor: number };
}) {
  return (
    <div className="rounded-lg border border-line-soft p-3.5 flex flex-col">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-text">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cor }} />
          {titulo}
        </span>
        <span className="text-xs text-label tabular whitespace-nowrap">{fmtPct(share, 1)} do saldo</span>
      </div>
      <dl className="mt-2.5 space-y-1.5 text-[13px] flex-1">
        {linhas.map((l) => (
          <LinhaValor key={l.rotulo} rotulo={l.rotulo} valor={l.valor} negativo={l.negativo} />
        ))}
      </dl>
      <div className="flex items-baseline justify-between gap-3 border-t border-[#a8b2bd] mt-2.5 pt-2">
        <span className="text-sm font-bold text-text">= {total.rotulo}</span>
        <span className="text-base font-bold tabular text-text whitespace-nowrap">{fmtBRL(total.valor)}</span>
      </div>
    </div>
  );
}

function LinhaValor({ rotulo, valor, negativo }: { rotulo: string; valor: number; negativo?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={clsx("min-w-0", negativo ? "text-negative font-semibold" : "text-label")}>{rotulo}</dt>
      <dd className={clsx("tabular whitespace-nowrap", negativo ? "text-negative font-semibold" : "text-text")}>
        {valor < 0 ? `(${fmtBRL(-valor)})` : fmtBRL(valor)}
      </dd>
    </div>
  );
}

function Conferencia({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icone = ok ? CheckCircle2 : XCircle;
  return (
    <div className={clsx("flex items-start gap-1.5 text-[13px] font-semibold leading-snug", ok ? "text-positive" : "text-negative")}>
      <Icone className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={2.25} />
      <span>{children}</span>
    </div>
  );
}

function Mini({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="rounded-lg bg-[#f5f6f7] px-3 py-2 min-w-0">
      <div className="text-xs text-label leading-tight truncate">{rotulo}</div>
      <div className="text-sm sm:text-base font-bold tabular text-text whitespace-nowrap mt-0.5">{valor}</div>
    </div>
  );
}
