import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { AXIS_STYLE, CHART_SEMANTIC, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, semaforoState, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { premissasNaDataBase } from "../../shared/data/mercado";
import { endOfMonth, fmtDate, fmtQuarter } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct, fmtX } from "../../shared/lib/format";
import type { Semaforo } from "../../shared/lib/semaforo";
import { useCovenants, useDivida } from "../context/useDivida";
import { relatorioCaptacao } from "../data/catalogo";
import type { ContratoDivida } from "../data/contratos";
import { COVENANTS_DIVIDA, type CovenantDivida, type CovenantId } from "../data/covenants";
import {
  icsdDoAno,
  indicadoresEm,
  reclassificadosEm,
  statusCovenant,
  trimestresAte,
  type ApuracaoCovenant,
  type ICSDAno,
  type IndicadoresCorporativos,
} from "../lib/covenants";
import { posicoesDivida, type PosicaoDivida } from "../lib/divida";

const rel = relatorioCaptacao("c04");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_TEXTO: Record<Semaforo, string> = { ok: "Cumprido", atencao: "Em atenção", excedido: "Descumprido" };
const COR_STATUS: Record<Semaforo, string> = { ok: CHART_SEMANTIC.good, atencao: CHART_SEMANTIC.critical, excedido: CHART_SEMANTIC.bad };
/** Faixa de atenção e zona de descumprimento nos gráficos */
const COR_FAIXA = { atencao: "#f0ab00", atencaoOpacidade: 0.24, zona: CHART_SEMANTIC.bad, zonaOpacidade: 0.08 };
const COR_ESTADO: Record<ValueState, string> = {
  positive: "#256f3a",
  critical: "#b44f00",
  negative: "#aa0808",
  information: "#0070f2",
  neutral: "#1d2d3e",
};

/** Nomes curtos (tags e listas compactas) */
const SIGLA: Record<CovenantId, string> = {
  dlEbitda: "DL/EBITDA",
  icsd: "ICSD",
  capitalizacao: "Capitalização",
  ebitdaDespFin: "EBITDA/DF",
  dlImoveisPl: "(DL + imóveis)/PL",
};

/** Valor apurado: índice de capitalização em %, demais em múltiplos */
function fmtValor(cov: CovenantDivida, v: number): string {
  return cov.formato === "pct" ? fmtPct(v, 1) : fmtX(v);
}

/** Limites e faixas de referência */
function fmtRef(cov: CovenantDivida, v: number): string {
  return cov.formato === "pct" ? fmtPct(v, 0) : fmtX(v);
}

function fmtLimite(cov: CovenantDivida): string {
  return `${cov.tipo === "max" ? "≤" : "≥"} ${fmtRef(cov, cov.limite)}`;
}

function fmtFolga(cov: CovenantDivida, folga: number): string {
  const sinal = folga < 0 ? "−" : "";
  return cov.formato === "pct" ? `${sinal}${fmtDec(Math.abs(folga) * 100, 1)} p.p.` : `${sinal}${fmtX(Math.abs(folga))}`;
}

function faixaAtencao(cov: CovenantDivida): string {
  return cov.tipo === "max" ? `atenção a partir de ${fmtRef(cov, cov.alerta)}` : `atenção até ${fmtRef(cov, cov.alerta)}`;
}

/** Próxima data de apuração após a data-base */
function proximaApuracao(cov: CovenantDivida, dataBase: string): string {
  let ano = Number(dataBase.slice(0, 4));
  if (cov.periodicidade === "Anual") return dataBase < `${ano}-12-31` ? `${ano}-12-31` : `${ano + 1}-12-31`;
  let mes = Math.ceil(Number(dataBase.slice(5, 7)) / 3) * 3;
  let data = endOfMonth(ano, mes);
  if (data <= dataBase) {
    mes += 3;
    if (mes > 12) {
      mes = 3;
      ano += 1;
    }
    data = endOfMonth(ano, mes);
  }
  return data;
}

/** "BND-01 e BND-02" / "A, B e C" */
function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** Estado visual: descumprido sem waiver = negativo; com waiver ou em atenção = crítico (mesmo critério do Launchpad) */
function estadoCovenant(a: ApuracaoCovenant): ValueState {
  if (!a.dataApuracao) return "neutral";
  if (a.status === "excedido") return a.reclassifica ? "negative" : "critical";
  if (a.status === "atencao") return "critical";
  return "positive";
}

/** Eixo Y "redondo" a partir de zero */
function eixo(alvo: number): { max: number; ticks: number[]; casas: number } {
  const passos = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
  const passo = passos.find((s) => alvo / s <= 5) ?? 100;
  const n = Math.max(1, Math.ceil(alvo / passo - 1e-9));
  const ticks = Array.from({ length: n + 1 }, (_, i) => Math.round(i * passo * 1000) / 1000);
  const casas = passo >= 1 ? 0 : passo >= 0.1 && Math.round(passo * 10) === passo * 10 ? 1 : 2;
  return { max: ticks[ticks.length - 1], ticks, casas };
}

function valorIndicador(id: Exclude<CovenantId, "icsd">, i: IndicadoresCorporativos): number {
  switch (id) {
    case "dlEbitda":
      return i.dlEbitda;
    case "ebitdaDespFin":
      return i.ebitdaDespFin;
    case "capitalizacao":
      return i.capitalizacao;
    case "dlImoveisPl":
      return i.dlImoveisPl;
  }
}

// ---------------------------------------------------------------------------
// Base de cálculo
// ---------------------------------------------------------------------------

interface LinhaBase {
  rotulo: string;
  sub?: string;
  v: (i: IndicadoresCorporativos) => number;
  destaque?: boolean;
}

const LINHAS_BASE: LinhaBase[] = [
  { rotulo: "Dívida bruta", sub: "custo amortizado (C00)", v: (i) => i.dividaBruta },
  { rotulo: "(−) Caixa", sub: "disponibilidades", v: (i) => i.caixa },
  { rotulo: "(−) Aplicações financeiras", sub: "carteira de aplicações na data", v: (i) => i.aplicacoes },
  { rotulo: "Dívida líquida", v: (i) => i.dividaLiquida, destaque: true },
  { rotulo: "EBITDA (últimos 12 meses)", v: (i) => i.ebitdaLTM },
  { rotulo: "Encargos da dívida (últimos 12 meses)", sub: "juros + correção + custos (C03)", v: (i) => i.encargosLTM },
  { rotulo: "Patrimônio líquido", v: (i) => i.patrimonioLiquido },
  { rotulo: "Ativo total", v: (i) => i.ativoTotal },
  { rotulo: "Imóveis a pagar", sub: "obrigações por aquisição de imóveis", v: (i) => i.imoveisAPagar },
];

const COVENANTS_TRIMESTRE = COVENANTS_DIVIDA.filter((c): c is CovenantDivida & { id: Exclude<CovenantId, "icsd"> } => c.id !== "icsd");

// ---------------------------------------------------------------------------
// Classificação dos contratos (CPC 26)
// ---------------------------------------------------------------------------

interface LinhaClassificacao {
  pos: PosicaoDivida;
  apuracoes: ApuracaoCovenant[];
  circulanteCronograma: number;
  reclassificado: number;
}

/** Não circulante reclassificado para o circulante: posições com `reclassificado = true` × mesma posição pelo cronograma contratual */
function reclassificacaoEm(contratos: ContratoDivida[], data: string, reclassificados: Set<string>) {
  const p = premissasNaDataBase(data);
  const comReclass = posicoesDivida(contratos, data, p, reclassificados).filter((x) => x.reclassificado);
  const contratuais = posicoesDivida(
    comReclass.map((x) => x.c),
    data,
    p,
  );
  const porContrato = comReclass.map((x) => {
    const cont = contratuais.find((y) => y.c.id === x.c.id);
    return { id: x.c.id, saldo: x.saldoContabil, valor: x.circulante - (cont?.circulante ?? x.circulante) };
  });
  return { porContrato, total: porContrato.reduce((s, x) => s + x.valor, 0) };
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function C04Covenants() {
  const { premissas: p, contratos, posicoes } = useDivida();
  const apuracoes = useCovenants();
  const db = p.dataBase;

  const d = useMemo(() => {
    const ativos = new Set(posicoes.map((x) => x.c.id));

    // Reclassificação na data-base (posições do useDivida já com CPC 26)
    const reclassPos = posicoes.filter((x) => x.reclassificado);
    const contratuais = posicoesDivida(
      reclassPos.map((x) => x.c),
      db,
      p,
    );
    const circCronograma = (x: PosicaoDivida) => (x.reclassificado ? (contratuais.find((y) => y.c.id === x.c.id)?.circulante ?? x.circulante) : x.circulante);

    const classificacao: LinhaClassificacao[] = posicoes
      .map((pos) => {
        const aps = apuracoes.filter((a) => a.cov.contratos.includes(pos.c.id));
        const cc = circCronograma(pos);
        return { pos, apuracoes: aps, circulanteCronograma: cc, reclassificado: pos.circulante - cc };
      })
      .filter((x) => x.apuracoes.length > 0)
      .sort((a, b) => b.reclassificado - a.reclassificado || b.pos.saldoContabil - a.pos.saldoContabil);

    const totalReclassificado = classificacao.reduce((s, x) => s + x.reclassificado, 0);
    const idsReclassificados = reclassPos.map((x) => x.c.id).sort();

    // Caso de waiver/descumprimento a destacar
    const caso = apuracoes.find((a) => a.reclassifica) ?? apuracoes.find((a) => a.waiver) ?? apuracoes.find((a) => a.status === "excedido") ?? null;

    // Balanço do descumprimento (comparativo), quando a data-base já é posterior ao waiver
    const comparativo =
      caso?.waiver && caso.waiverVigente && caso.dataApuracao && caso.dataApuracao < db
        ? { data: caso.dataApuracao, ...reclassificacaoEm(contratos, caso.dataApuracao, reclassificadosEm(caso.dataApuracao)) }
        : null;

    // Base de cálculo
    const trimestres = trimestresAte(db);
    const serie = trimestres.map((t) => indicadoresEm(t));
    const icsd: ICSDAno[] = trimestres.filter((t) => t.endsWith("-12-31")).map((t) => icsdDoAno(Number(t.slice(0, 4))));

    return { ativos, classificacao, totalReclassificado, idsReclassificados, caso, comparativo, serie, icsd };
  }, [posicoes, apuracoes, contratos, db, p]);

  // KPIs
  const n = apuracoes.length;
  const cumpridos = apuracoes.filter((a) => a.dataApuracao && a.status !== "excedido").length;
  const emAtencao = apuracoes.filter((a) => a.status === "atencao");
  const descumpridos = apuracoes.filter((a) => a.status === "excedido");
  const comWaiver = apuracoes.filter((a) => a.waiver);
  const semWaiver = descumpridos.filter((a) => a.reclassifica);
  const proximaTri = proximaApuracao(COVENANTS_DIVIDA.find((c) => c.periodicidade === "Trimestral")!, db);
  const proximaAnual = proximaApuracao(COVENANTS_DIVIDA.find((c) => c.periodicidade === "Anual")!, db);

  const exportar = () => {
    const escala = (c: CovenantDivida) => (c.formato === "pct" ? 100 : 1);
    exportarExcel(
      `C04_Covenants_${db}.xlsx`,
      [
        {
          nome: "Covenants",
          titulo: "C04 – Covenants: apuração na data-base",
          subtitulo: "Consolidado · última apuração de cada covenant até a data-base",
          colunas: [
            { titulo: "Indicador", largura: 36 },
            { titulo: "Fórmula", largura: 62 },
            { titulo: "Unidade", largura: 9 },
            { titulo: "Tipo de limite", largura: 13 },
            { titulo: "Limite", tipo: "decimal", largura: 10 },
            { titulo: "Início da faixa de atenção", tipo: "decimal", largura: 14 },
            { titulo: "Periodicidade", largura: 13 },
            { titulo: "Última apuração", tipo: "data", largura: 14 },
            { titulo: "Valor apurado", tipo: "decimal", largura: 13 },
            { titulo: "Folga", tipo: "decimal", largura: 10 },
            { titulo: "Status", largura: 14 },
            { titulo: "Waiver – credor", largura: 14 },
            { titulo: "Waiver – obtido em", tipo: "data", largura: 14 },
            { titulo: "Waiver vigente na data-base", largura: 14 },
            { titulo: "Contratos afetados", largura: 26 },
            { titulo: "Reclassifica para o circulante (CPC 26)", largura: 18 },
            { titulo: "Próxima apuração", tipo: "data", largura: 14 },
            { titulo: "Fonte", largura: 56 },
          ],
          linhas: apuracoes.map((a) => [
            a.cov.indicador,
            a.cov.formula,
            a.cov.formato === "pct" ? "%" : "x",
            a.cov.tipo === "max" ? "Máximo" : "Mínimo",
            a.cov.limite * escala(a.cov),
            a.cov.alerta * escala(a.cov),
            a.cov.periodicidade,
            a.dataApuracao,
            a.valor * escala(a.cov),
            a.folga * escala(a.cov),
            STATUS_TEXTO[a.status],
            a.waiver?.credor,
            a.waiver?.obtidoEm,
            a.waiver ? (a.waiverVigente ? "Sim" : "Não – obtido após a data-base") : "",
            a.cov.contratos.join(", "),
            a.reclassifica ? "Sim" : "Não",
            proximaApuracao(a.cov, db),
            a.cov.fonte,
          ]),
          notas: [
            "Índice de capitalização em % (folga em pontos percentuais); demais indicadores em múltiplos (x). Folga positiva = dentro do limite.",
            "CPC 26, item 74: descumprimento na data do balanço sem waiver obtido até essa data – passivo do contrato classificado integralmente no circulante.",
            "CPC 26, item 76 / CPC 24: waiver obtido após a data do balanço é evento subsequente que não origina ajuste; apenas divulgação.",
          ],
        },
        {
          nome: "Histórico",
          titulo: "C04 – Série histórica das apurações",
          colunas: [
            { titulo: "Indicador", largura: 36 },
            { titulo: "Data de apuração", tipo: "data", largura: 14 },
            { titulo: "Unidade", largura: 9 },
            { titulo: "Valor apurado", tipo: "decimal", largura: 13 },
            { titulo: "Limite", tipo: "decimal", largura: 10 },
            { titulo: "Status", largura: 14 },
          ],
          linhas: apuracoes.flatMap((a) =>
            a.historico.map((h) => [
              a.cov.indicador,
              h.data,
              a.cov.formato === "pct" ? "%" : "x",
              h.valor * escala(a.cov),
              a.cov.limite * escala(a.cov),
              STATUS_TEXTO[statusCovenant(a.cov, h.valor)],
            ]),
          ),
        },
        {
          nome: "Classificação CPC 26",
          titulo: "C04 – Classificação dos contratos sujeitos a covenants (CPC 26, itens 74–76)",
          subtitulo: d.idsReclassificados.length
            ? `Não circulante de ${listar(d.idsReclassificados)} reclassificado para o circulante`
            : "Classificação pelo cronograma contratual",
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Instrumento", largura: 52 },
            { titulo: "Credor", largura: 18 },
            { titulo: "Covenants", largura: 28 },
            { titulo: "Saldo contábil", tipo: "moeda", largura: 18 },
            { titulo: "Circulante – cronograma contratual", tipo: "moeda", largura: 18 },
            { titulo: "Reclassificado para o circulante", tipo: "moeda", largura: 18 },
            { titulo: "Circulante no balanço", tipo: "moeda", largura: 18 },
            { titulo: "Não circulante no balanço", tipo: "moeda", largura: 18 },
          ],
          linhas: d.classificacao.map((x) => [
            x.pos.c.id,
            x.pos.c.instrumento,
            x.pos.c.credor,
            x.apuracoes.map((a) => SIGLA[a.cov.id]).join(", "),
            x.pos.saldoContabil,
            x.circulanteCronograma,
            x.reclassificado,
            x.pos.circulante,
            x.pos.naoCirculante,
          ]),
          total: [
            "Total",
            "",
            "",
            "",
            d.classificacao.reduce((s, x) => s + x.pos.saldoContabil, 0),
            d.classificacao.reduce((s, x) => s + x.circulanteCronograma, 0),
            d.totalReclassificado,
            d.classificacao.reduce((s, x) => s + x.pos.circulante, 0),
            d.classificacao.reduce((s, x) => s + x.pos.naoCirculante, 0),
          ],
          notas: textoCaso(d.caso, db, d.idsReclassificados, d.totalReclassificado, d.comparativo),
        },
        {
          nome: "Base de cálculo",
          titulo: "C04 – Base de cálculo dos covenants por trimestre",
          subtitulo: "Valores em R$; indicadores em múltiplos (x) e capitalização em %",
          colunas: [{ titulo: "Item", largura: 44 }, ...d.serie.map((i) => ({ titulo: `${fmtQuarter(i.data)} (${fmtDate(i.data)})`, tipo: "decimal" as const, largura: 20 }))],
          linhas: [
            ...LINHAS_BASE.map((l) => [l.rotulo, ...d.serie.map((i) => l.v(i))]),
            ...COVENANTS_TRIMESTRE.map((c) => [
              `${c.indicador} (${c.formato === "pct" ? "%" : "x"})`,
              ...d.serie.map((i) => valorIndicador(c.id, i) * (c.formato === "pct" ? 100 : 1)),
            ]),
          ],
          notas: [
            "Dívida bruta pelo custo amortizado (C00) e encargos dos últimos 12 meses (C03), calculados com as premissas importadas do SAP em cada data.",
            "Caixa, EBITDA, patrimônio líquido, ativo total e imóveis a pagar: dados corporativos fictícios do ambiente de teste.",
          ],
        },
        {
          nome: "ICSD",
          titulo: "C04 – ICSD: índice de cobertura do serviço da dívida (BNDES)",
          colunas: [
            { titulo: "Exercício", tipo: "inteiro", largura: 10 },
            { titulo: "Geração de caixa (R$)", tipo: "moeda", largura: 20 },
            { titulo: "Serviço da dívida (R$)", tipo: "moeda", largura: 20 },
            { titulo: "ICSD (x)", tipo: "decimal", largura: 10 },
            { titulo: "Mínimo (x)", tipo: "decimal", largura: 10 },
            { titulo: "Status", largura: 14 },
          ],
          linhas: d.icsd.map((x) => {
            const cov = COVENANTS_DIVIDA.find((c) => c.id === "icsd")!;
            return [x.ano, x.geracaoCaixa, x.servicoDivida, x.icsd, cov.limite, STATUS_TEXTO[statusCovenant(cov, x.icsd)]];
          }),
          notas: [
            "Serviço da dívida = principal + juros pagos no exercício por todos os contratos (movimentação C01).",
            "Geração de caixa do exercício: dado corporativo fictício do ambiente de teste.",
          ],
        },
      ],
      db,
    );
  };

  // Faixa de mensagem com a situação na data-base
  const faixa = (() => {
    const c = d.caso;
    if (!c || !c.dataApuracao) return null;
    const ano = c.dataApuracao.slice(0, 4);
    if (c.reclassifica) {
      return (
        <MessageStrip design="negative">
          <strong>{c.cov.indicador}</strong> {c.cov.periodicidade === "Anual" ? `de ${ano}` : `de ${fmtQuarter(c.dataApuracao)}`} apurado em{" "}
          <strong>{fmtValor(c.cov, c.valor)}</strong> ({c.cov.tipo === "max" ? "máximo" : "mínimo"} {fmtRef(c.cov, c.cov.limite)}) sem waiver até a data
          do balanço: o não circulante de {listar(d.idsReclassificados)} (<strong>{fmtCompact(d.totalReclassificado)}</strong>) foi reclassificado para o
          circulante (CPC 26, item 74).
          {c.waiver && ` O waiver do ${c.waiver.credor}, obtido em ${fmtDate(c.waiver.obtidoEm)}, é evento subsequente que não origina ajuste (CPC 24).`}
        </MessageStrip>
      );
    }
    if (c.status === "excedido" && c.waiverVigente && c.waiver) {
      return (
        <MessageStrip design="information">
          {c.cov.indicador} de {ano} ({fmtValor(c.cov, c.valor)}) abaixo do {c.cov.tipo === "max" ? "máximo" : "mínimo"} de {fmtRef(c.cov, c.cov.limite)}, com{" "}
          <strong>
            waiver do {c.waiver.credor} obtido em {fmtDate(c.waiver.obtidoEm)}
          </strong>
          : sem vencimento antecipado, {listar(c.cov.contratos)} seguem o cronograma contratual na data-base.
        </MessageStrip>
      );
    }
    if (emAtencao.length) {
      return (
        <MessageStrip design="critical">
          {listar(emAtencao.map((a) => a.cov.indicador))} na faixa de atenção: folga reduzida em relação ao limite contratual.
        </MessageStrip>
      );
    }
    return null;
  })();

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi
            label="Covenants cumpridos"
            value={`${cumpridos}/${n}`}
            state={cumpridos === n ? "positive" : semWaiver.length ? "negative" : "critical"}
            sub="na última apuração"
          />
          <HeaderKpi
            label="Em atenção"
            value={String(emAtencao.length)}
            state={emAtencao.length ? "critical" : "neutral"}
            sub={emAtencao.length ? listar(emAtencao.map((a) => SIGLA[a.cov.id])) : "nenhum próximo do limite"}
          />
          <HeaderKpi
            label="Descumpridos"
            value={String(descumpridos.length)}
            state={semWaiver.length ? "negative" : descumpridos.length ? "critical" : "neutral"}
            sub={
              descumpridos.length
                ? semWaiver.length
                  ? `${listar(semWaiver.map((a) => SIGLA[a.cov.id]))} sem waiver na data-base`
                  : `${listar(descumpridos.map((a) => SIGLA[a.cov.id]))} com waiver vigente`
                : "nenhum"
            }
          />
          <HeaderKpi
            label="Waivers"
            value={String(comWaiver.length)}
            state={comWaiver.length ? (comWaiver.every((a) => a.waiverVigente) ? "positive" : "critical") : "neutral"}
            sub={
              comWaiver.length
                ? comWaiver.map((a) => `${a.waiver!.credor} · ${fmtDate(a.waiver!.obtidoEm)}${a.waiverVigente ? "" : " (após a data-base)"}`).join("; ")
                : "nenhum necessário"
            }
          />
          <HeaderKpi
            label="Reclassificado para o circulante"
            value={fmtCompact(d.totalReclassificado)}
            state={d.totalReclassificado > 0 ? "negative" : "neutral"}
            sub={d.idsReclassificados.length ? `${listar(d.idsReclassificados)} · CPC 26, item 74` : "classificação contratual"}
          />
        </>
      }
    >
      {faixa}

      <TabelaCovenants apuracoes={apuracoes} dataBase={db} ativos={d.ativos} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {apuracoes.map((a) => (
          <CardGrafico key={a.cov.id} a={a} />
        ))}
        <CardLeitura proximaTri={proximaTri} proximaAnual={proximaAnual} />
      </div>

      <CardWaiver
        caso={d.caso}
        dataBase={db}
        apuracoes={apuracoes}
        classificacao={d.classificacao}
        idsReclassificados={d.idsReclassificados}
        totalReclassificado={d.totalReclassificado}
        comparativo={d.comparativo}
      />

      <CardBaseCalculo serie={d.serie} icsd={d.icsd} />
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Tabela de apuração
// ---------------------------------------------------------------------------

function CelulaWaiver({ a }: { a: ApuracaoCovenant }) {
  if (!a.waiver) return <span className="text-label">—</span>;
  return (
    <div className="leading-snug">
      <div className="font-semibold text-text">{a.waiver.credor}</div>
      <div className="text-xs text-label tabular">{fmtDate(a.waiver.obtidoEm)}</div>
      <div className={`text-xs ${a.waiverVigente ? "text-positive" : "text-critical"}`}>{a.waiverVigente ? "vigente" : "após o balanço"}</div>
    </div>
  );
}

function CelulaCPC26({ a }: { a: ApuracaoCovenant }) {
  if (a.reclassifica)
    return (
      <div className="leading-snug">
        <ObjectStatus state="negative">Reclassifica</ObjectStatus>
        <div className="text-xs text-label">NC → circulante</div>
      </div>
    );
  return (
    <div className="leading-snug">
      <div className="text-[13px] text-text">Não reclassifica</div>
      {a.status === "excedido" && a.waiverVigente && <div className="text-xs text-label">waiver vigente</div>}
    </div>
  );
}

function TagsContratos({ ids, ativos }: { ids: string[]; ativos: Set<string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) =>
        ativos.has(id) ? (
          <Tag key={id}>{id}</Tag>
        ) : (
          <span key={id} className="opacity-50" title="Contrato não ativo na data-base">
            <Tag>{id}</Tag>
          </span>
        ),
      )}
    </div>
  );
}

function TabelaCovenants({ apuracoes, dataBase, ativos }: { apuracoes: ApuracaoCovenant[]; dataBase: string; ativos: Set<string> }) {
  const colunas: Column<ApuracaoCovenant>[] = [
    {
      key: "indicador",
      header: "Indicador",
      minWidth: 140,
      value: (a) => a.cov.indicador,
      render: (a) => (
        <span className="block font-semibold text-text leading-snug py-0.5" title={a.cov.fonte}>
          {a.cov.indicador}
        </span>
      ),
    },
    {
      key: "formula",
      header: "Fórmula",
      minWidth: 165,
      render: (a) => <span className="text-[13px] text-label leading-snug block">{a.cov.formula}</span>,
    },
    {
      key: "limite",
      header: "Limite",
      align: "right",
      value: (a) => a.cov.limite,
      render: (a) => (
        <div>
          <div className="font-semibold">{fmtLimite(a.cov)}</div>
          <div className="text-xs text-label">atenção {a.cov.tipo === "max" ? "≥" : "≤"} {fmtRef(a.cov, a.cov.alerta)}</div>
        </div>
      ),
    },
    {
      key: "periodicidade",
      header: "Periodicidade",
      value: (a) => a.cov.periodicidade,
      render: (a) => (
        <div className="leading-snug whitespace-nowrap">
          <div>{a.cov.periodicidade}</div>
          <div className="text-xs text-label">próx. {fmtDate(proximaApuracao(a.cov, dataBase))}</div>
        </div>
      ),
    },
    { key: "apuracao", header: "Última apuração", align: "right", value: (a) => a.dataApuracao, render: (a) => fmtDate(a.dataApuracao) },
    {
      key: "valor",
      header: "Valor apurado",
      align: "right",
      value: (a) => a.valor,
      render: (a) => (
        <span className="font-bold" style={{ color: a.status === "ok" ? undefined : COR_ESTADO[semaforoState(a.status)] }}>
          {fmtValor(a.cov, a.valor)}
        </span>
      ),
    },
    {
      key: "folga",
      header: "Folga",
      align: "right",
      value: (a) => a.folga / a.cov.limite,
      render: (a) => (
        <div>
          <div className={`font-semibold ${a.folga >= 0 ? "text-positive" : "text-negative"}`}>{fmtFolga(a.cov, a.folga)}</div>
          <div className="text-xs text-label">{fmtPct(a.folga / a.cov.limite, 1)} do limite</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      value: (a) => (a.status === "ok" ? 0 : a.status === "atencao" ? 1 : 2),
      render: (a) => <ObjectStatus state={semaforoState(a.status)}>{STATUS_TEXTO[a.status]}</ObjectStatus>,
    },
    { key: "waiver", header: "Waiver", value: (a) => a.waiver?.obtidoEm ?? "", render: (a) => <CelulaWaiver a={a} /> },
    { key: "contratos", header: "Contratos afetados", render: (a) => <TagsContratos ids={a.cov.contratos} ativos={ativos} /> },
    {
      key: "cpc26",
      header: "Efeito CPC 26",
      headerTitle: "Efeito CPC 26: descumprimento sem waiver até a data do balanço reclassifica o não circulante para o circulante",
      value: (a) => (a.reclassifica ? 1 : 0),
      render: (a) => <CelulaCPC26 a={a} />,
    },
  ];

  return (
    <Card
      title="Apuração dos covenants"
      subtitle={`Última apuração de cada covenant até a data-base ${fmtDate(dataBase)} · folga positiva = dentro do limite`}
      bodyClassName="px-0 pb-0"
    >
      <div className="hidden min-[1420px]:block">
        <DataTable columns={colunas} rows={apuracoes} rowKey={(a) => a.cov.id} />
      </div>
      {/* Pop-in (sap.m.Table responsiva): em telas estreitas as colunas descem para baixo do indicador */}
      <ul className="min-[1420px]:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
        {apuracoes.map((a) => (
          <li key={a.cov.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text">{a.cov.indicador}</div>
                <div className="text-xs text-label leading-snug mt-0.5">{a.cov.formula}</div>
              </div>
              <div className="shrink-0">
                <ObjectStatus state={semaforoState(a.status)}>{STATUS_TEXTO[a.status]}</ObjectStatus>
              </div>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-2.5 text-[13px]">
              <PopIn rotulo="Valor apurado" valor={fmtValor(a.cov, a.valor)} />
              <PopIn rotulo="Limite" valor={fmtLimite(a.cov)} />
              <PopIn
                rotulo="Folga"
                valor={<span className={a.folga >= 0 ? "text-positive" : "text-negative"}>{fmtFolga(a.cov, a.folga)}</span>}
              />
              <PopIn rotulo={`Apuração ${a.cov.periodicidade.toLowerCase()}`} valor={fmtDate(a.dataApuracao)} />
            </dl>
            <div className="text-xs text-label leading-snug mt-2">
              <span className="text-text">Waiver:</span>{" "}
              {a.waiver ? `${a.waiver.credor} em ${fmtDate(a.waiver.obtidoEm)}${a.waiverVigente ? " (vigente)" : " (após o balanço)"}` : "—"}
              {" · "}
              <span className="text-text">Reclassifica (CPC 26):</span>{" "}
              <span className={a.reclassifica ? "text-negative font-semibold" : undefined}>{a.reclassifica ? "sim – circulante" : "não"}</span>
            </div>
            <div className="mt-2">
              <TagsContratos ids={a.cov.contratos} ativos={ativos} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Gráficos
// ---------------------------------------------------------------------------

interface PontoGrafico {
  data: string;
  rotulo: string;
  valor: number;
  status: Semaforo;
}

function CardGrafico({ a }: { a: ApuracaoCovenant }) {
  const { cov } = a;
  const anual = cov.periodicidade === "Anual";
  const escala = cov.formato === "pct" ? 100 : 1;
  const dados: PontoGrafico[] = a.historico.map((h) => ({
    data: h.data,
    rotulo: anual ? h.data.slice(0, 4) : fmtQuarter(h.data),
    valor: h.valor * escala,
    status: statusCovenant(cov, h.valor),
  }));
  const limite = cov.limite * escala;
  const alerta = cov.alerta * escala;
  const { max, ticks, casas } = eixo(Math.max(limite, alerta, ...dados.map((x) => x.valor)) * 1.15);
  const fmtEixo = (v: number) => (v === 0 ? "0" : cov.formato === "pct" ? `${fmtDec(v, 0)}%` : `${fmtDec(v, casas)}x`);
  const fmtPonto = (v: number) => fmtValor(cov, v / escala);
  const faixa: [number, number] = cov.tipo === "max" ? [alerta, limite] : [limite, alerta];
  const zona: [number, number] = cov.tipo === "max" ? [limite, max] : [0, limite];
  const estado = semaforoState(a.status);
  const ultimo = dados.length - 1;

  const referencias = [
    <ReferenceArea key="zona" y1={zona[0]} y2={zona[1]} fill={COR_FAIXA.zona} fillOpacity={COR_FAIXA.zonaOpacidade} stroke="none" ifOverflow="hidden" />,
    <ReferenceArea key="faixa" y1={faixa[0]} y2={faixa[1]} fill={COR_FAIXA.atencao} fillOpacity={COR_FAIXA.atencaoOpacidade} stroke="none" ifOverflow="hidden" />,
    <ReferenceLine
      key="limite"
      y={limite}
      stroke={CHART_SEMANTIC.bad}
      strokeDasharray="4 3"
      strokeWidth={1.5}
      label={{ value: fmtRef(cov, cov.limite), position: "right", fill: "#aa0808", fontSize: 11, fontWeight: 700 }}
    />,
  ];
  const eixos = [
    <CartesianGrid key="grid" vertical={false} stroke="#e5e5e5" />,
    <XAxis key="x" dataKey="rotulo" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} padding={anual ? undefined : { left: 14, right: 14 }} />,
    <YAxis key="y" domain={[0, max]} ticks={ticks} tickFormatter={fmtEixo} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />,
    <Tooltip
      key="tt"
      contentStyle={tooltipStyle}
      cursor={anual ? { fill: "#f2f4f6" } : { stroke: "#a8b2bd" }}
      labelFormatter={(l: string) => (anual ? `Exercício de ${l}` : `Trimestre ${l}`)}
      formatter={(v: number) => [fmtPonto(v), "Apurado"]}
    />,
  ];

  return (
    <Card
      title={cov.indicador}
      subtitle={`${fmtLimite(cov)} · ${faixaAtencao(cov)} · ${cov.periodicidade.toLowerCase()}`}
      status={
        <ObjectStatus state={semaforoState(a.status)} inverted>
          {STATUS_TEXTO[a.status]}
        </ObjectStatus>
      }
      className="flex flex-col"
      bodyClassName="flex-1 flex flex-col"
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-label">Apurado em {fmtDate(a.dataApuracao)}</div>
          <div className="text-[1.75rem] leading-tight font-light tabular" style={{ color: COR_ESTADO[estado] }}>
            {fmtValor(cov, a.valor)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-label">Folga</div>
          <div className={`text-sm font-bold tabular ${a.folga >= 0 ? "text-positive" : "text-negative"}`}>{fmtFolga(cov, a.folga)}</div>
        </div>
      </div>
      <div className="h-48 mt-2 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          {anual ? (
            <BarChart data={dados} margin={{ top: 18, right: 44, left: 0, bottom: 0 }}>
              {eixos}
              {referencias}
              <Bar dataKey="valor" maxBarSize={52} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {dados.map((x) => (
                  <Cell key={x.data} fill={COR_STATUS[x.status]} />
                ))}
                <LabelList dataKey="valor" position="insideTop" offset={7} formatter={(v: number) => fmtPonto(v)} fontSize={11} fontWeight={700} fill="#ffffff" />
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={dados} margin={{ top: 18, right: 44, left: 0, bottom: 0 }}>
              {eixos}
              {referencias}
              <Line
                dataKey="valor"
                stroke="#5b738b"
                strokeWidth={2}
                isAnimationActive={false}
                activeDot={{ r: 5 }}
                dot={(pt: { cx?: number; cy?: number; index?: number; payload?: PontoGrafico }) => (
                  <circle
                    key={`p-${pt.index}`}
                    cx={pt.cx}
                    cy={pt.cy}
                    r={4}
                    fill={COR_STATUS[pt.payload?.status ?? "ok"]}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                )}
              >
                <LabelList
                  dataKey="valor"
                  content={(pt) =>
                    pt.index === ultimo ? (
                      <text x={Number(pt.x)} y={Number(pt.y) - 9} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1d2d3e">
                        {fmtPonto(Number(pt.value))}
                      </text>
                    ) : null
                  }
                />
              </Line>
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="mt-auto pt-2 text-xs text-label leading-snug">
        {a.waiver ? (
          <span className={a.waiverVigente ? undefined : "text-critical"}>
            Waiver do {a.waiver.credor} obtido em {fmtDate(a.waiver.obtidoEm)}
            {a.waiverVigente ? " – vigente na data-base" : " – após a data do balanço"}
          </span>
        ) : (
          <>Contratos: {listar(cov.contratos)}</>
        )}
      </div>
    </Card>
  );
}

function CardLeitura({ proximaTri, proximaAnual }: { proximaTri: string; proximaAnual: string }) {
  return (
    <Card title="Como ler os gráficos" subtitle="Série histórica das apurações até a data-base">
      <ul className="space-y-3 text-[13px] text-text">
        <li className="flex items-center gap-3">
          <svg width="28" height="10" className="shrink-0" aria-hidden>
            <line x1="0" y1="5" x2="28" y2="5" stroke={CHART_SEMANTIC.bad} strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          Limite contratual (valor à direita do gráfico)
        </li>
        <li className="flex items-center gap-3">
          <span className="w-7 h-3 rounded-sm shrink-0" style={{ backgroundColor: COR_FAIXA.atencao, opacity: COR_FAIXA.atencaoOpacidade + 0.1 }} />
          Faixa de atenção – folga reduzida
        </li>
        <li className="flex items-center gap-3">
          <span className="w-7 h-3 rounded-sm shrink-0" style={{ backgroundColor: COR_FAIXA.zona, opacity: COR_FAIXA.zonaOpacidade + 0.06 }} />
          Zona de descumprimento
        </li>
        <li className="flex items-center gap-3">
          <span className="inline-flex gap-1 w-7 shrink-0">
            {(["ok", "atencao", "excedido"] as Semaforo[]).map((s) => (
              <span key={s} className="w-2 h-2 rounded-full" style={{ backgroundColor: COR_STATUS[s] }} />
            ))}
          </span>
          Apuração cumprida · em atenção · descumprida
        </li>
      </ul>
      <dl className="mt-4 pt-3 border-t border-line-soft grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <dt className="text-xs text-label">Trimestrais (ITR / DFP)</dt>
          <dd className="font-semibold text-text">Próxima: {fmtDate(proximaTri)}</dd>
          <dd className="text-xs text-label mt-0.5">DL/EBITDA, EBITDA/DF e (DL + imóveis)/PL</dd>
        </div>
        <div>
          <dt className="text-xs text-label">Anuais (DFP)</dt>
          <dd className="font-semibold text-text">Próxima: {fmtDate(proximaAnual)}</dd>
          <dd className="text-xs text-label mt-0.5">ICSD e índice de capitalização (BNDES)</dd>
        </div>
      </dl>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Waiver e classificação (CPC 26, itens 74–76)
// ---------------------------------------------------------------------------

interface Comparativo {
  data: string;
  porContrato: { id: string; saldo: number; valor: number }[];
  total: number;
}

/** Texto explicativo adaptado à data-base (também vai para as notas do Excel) */
function textoCaso(
  caso: ApuracaoCovenant | null,
  dataBase: string,
  idsReclassificados: string[],
  totalReclassificado: number,
  comparativo: Comparativo | null,
): string[] {
  if (!caso || !caso.dataApuracao || caso.status !== "excedido") {
    return [
      `Na data-base de ${fmtDate(dataBase)}, a última apuração de cada covenant está dentro dos limites contratuais: não há direito de vencimento antecipado e os contratos seguem a classificação do cronograma contratual (circulante = parcelas dos próximos 12 meses).`,
      "Um descumprimento na data do balanço sem waiver obtido até essa data levaria todo o passivo do contrato para o circulante (CPC 26, item 74); o waiver obtido depois da data do balanço seria evento subsequente sem ajuste (CPC 24), apenas divulgado.",
    ];
  }
  const cov = caso.cov;
  const periodo = cov.periodicidade === "Anual" ? `do exercício de ${caso.dataApuracao.slice(0, 4)}` : `de ${fmtQuarter(caso.dataApuracao)}`;
  const limite = `${cov.tipo === "max" ? "máximo" : "mínimo"} contratual de ${fmtRef(cov, cov.limite)}`;
  const w = caso.waiver;
  if (caso.reclassifica) {
    return [
      `Na data-base de ${fmtDate(dataBase)}, o ${cov.indicador} ${periodo} foi apurado em ${fmtValor(cov, caso.valor)}, ${cov.tipo === "max" ? "acima" : "abaixo"} do ${limite}. Como o waiver não havia sido obtido até a data do balanço, o credor tinha o direito de exigir o vencimento antecipado: o não circulante de ${listar(idsReclassificados)} (${fmtBRL(totalReclassificado)}) foi reclassificado para o circulante (CPC 26, item 74).`,
      w
        ? `O waiver do ${w.credor} foi obtido em ${fmtDate(w.obtidoEm)}, após a data do balanço. É evento subsequente que não origina ajuste (CPC 24): a reclassificação é mantida e o waiver é apenas divulgado em nota explicativa (CPC 26, item 76).`
        : "Até a data-base não houve anuência do credor. Se o waiver for obtido após a data do balanço, será evento subsequente sem ajuste (CPC 24), apenas divulgado.",
    ];
  }
  const out = [
    `O ${cov.indicador} ${periodo} (${fmtValor(cov, caso.valor)}) ficou ${cov.tipo === "max" ? "acima" : "abaixo"} do ${limite}${w ? `, mas o waiver do ${w.credor} foi obtido em ${fmtDate(w.obtidoEm)} e está vigente na data-base de ${fmtDate(dataBase)}` : ""}. Sem direito de vencimento antecipado, a classificação de ${listar(cov.contratos)} volta ao cronograma contratual (circulante = parcelas dos próximos 12 meses).`,
  ];
  if (comparativo) {
    out.push(
      `No balanço de ${fmtDate(comparativo.data)}, apresentado como comparativo, a reclassificação de ${fmtBRL(comparativo.total)} para o circulante é mantida: o waiver obtido após aquela data do balanço não o reapresenta (CPC 24) e foi divulgado em nota (CPC 26, item 76).`,
    );
  }
  return out;
}

interface EventoLinha {
  data: string;
  titulo: string;
  texto: string;
  estado: ValueState;
  tag?: string;
}

function CardWaiver({
  caso,
  dataBase,
  apuracoes,
  classificacao,
  idsReclassificados,
  totalReclassificado,
  comparativo,
}: {
  caso: ApuracaoCovenant | null;
  dataBase: string;
  apuracoes: ApuracaoCovenant[];
  classificacao: LinhaClassificacao[];
  idsReclassificados: string[];
  totalReclassificado: number;
  comparativo: Comparativo | null;
}) {
  const temCaso = !!caso && !!caso.dataApuracao && caso.status === "excedido";
  const paragrafos = textoCaso(caso, dataBase, idsReclassificados, totalReclassificado, comparativo);

  const statusCard = !temCaso ? (
    <ObjectStatus state="positive" inverted>
      Sem descumprimento
    </ObjectStatus>
  ) : caso!.reclassifica ? (
    <ObjectStatus state="negative" inverted>
      Reclassificação aplicada
    </ObjectStatus>
  ) : (
    <ObjectStatus state="positive" inverted>
      Waiver vigente
    </ObjectStatus>
  );

  // Linha do tempo do caso (somente eventos conhecidos até a emissão das demonstrações da data-base)
  const eventos: EventoLinha[] = [];
  if (temCaso && caso) {
    const cov = caso.cov;
    const ap = caso.dataApuracao!;
    const valorBalanco = caso.reclassifica ? totalReclassificado : (comparativo?.total ?? 0);
    const ids = caso.reclassifica ? idsReclassificados : (comparativo?.porContrato.map((x) => x.id) ?? cov.contratos);
    eventos.push({
      data: ap,
      titulo: `Data do balanço – ${cov.indicador.split(" – ")[0]} ${cov.periodicidade === "Anual" ? ap.slice(0, 4) : fmtQuarter(ap)}`,
      texto: `Apurado em ${fmtValor(cov, caso.valor)} (${fmtLimite(cov)}): descumprido. Sem waiver até essa data → não circulante de ${listar(ids)}${valorBalanco > 0 ? ` (${fmtCompact(valorBalanco)})` : ""} reclassificado para o circulante (CPC 26, item 74).`,
      estado: "negative",
      tag: ap === dataBase ? "Data-base" : "Comparativo",
    });
    if (caso.waiver) {
      eventos.push({
        data: caso.waiver.obtidoEm,
        titulo: `Waiver do ${caso.waiver.credor} obtido`,
        texto: "Após a data do balanço: evento subsequente que não origina ajuste (CPC 24) – apenas divulgação em nota explicativa (CPC 26, item 76).",
        estado: "information",
        tag: caso.waiver.obtidoEm > dataBase ? "Evento subsequente" : undefined,
      });
    }
    if (caso.waiverVigente && caso.waiver && dataBase > caso.waiver.obtidoEm) {
      eventos.push({
        data: dataBase,
        titulo: "Data-base atual",
        texto: `Waiver vigente: sem direito de vencimento antecipado. ${listar(cov.contratos)} voltam ao cronograma contratual de amortização.`,
        estado: "positive",
        tag: "Data-base",
      });
    }
  }

  const covCaso = temCaso ? caso!.cov : null;
  const minis: { rotulo: string; valor: string; cor?: string; sub?: string }[] = temCaso
    ? [
        {
          rotulo: `${SIGLA[covCaso!.id]} ${covCaso!.periodicidade === "Anual" ? caso!.dataApuracao!.slice(0, 4) : fmtQuarter(caso!.dataApuracao!)}`,
          valor: fmtValor(covCaso!, caso!.valor),
          cor: COR_ESTADO.negative,
        },
        { rotulo: covCaso!.tipo === "max" ? "Máximo contratual" : "Mínimo contratual", valor: fmtRef(covCaso!, covCaso!.limite) },
        {
          rotulo: "Waiver obtido em",
          valor: caso!.waiver ? fmtDate(caso!.waiver.obtidoEm) : "Não obtido",
          cor: caso!.waiver ? (caso!.waiverVigente ? COR_ESTADO.positive : COR_ESTADO.critical) : COR_ESTADO.negative,
          sub: caso!.waiver ? (caso!.waiverVigente ? "antes da data-base" : "após a data do balanço") : undefined,
        },
        {
          rotulo: "Reclassificado p/ circulante",
          valor: fmtCompact(totalReclassificado),
          cor: totalReclassificado > 0 ? COR_ESTADO.negative : undefined,
          sub: comparativo ? `${fmtDate(comparativo.data)}: ${fmtCompact(comparativo.total)}` : totalReclassificado > 0 ? "na data-base" : undefined,
        },
      ]
    : (() => {
        const menor = [...apuracoes].filter((a) => a.dataApuracao).sort((x, y) => x.folga / x.cov.limite - y.folga / y.cov.limite)[0];
        return [
          { rotulo: "Covenants cumpridos", valor: `${apuracoes.filter((a) => a.status !== "excedido").length}/${apuracoes.length}`, cor: COR_ESTADO.positive },
          { rotulo: "Menor folga relativa", valor: menor ? fmtPct(menor.folga / menor.cov.limite, 1) : "—", sub: menor ? SIGLA[menor.cov.id] : undefined },
          { rotulo: "Waivers necessários", valor: "Nenhum" },
          { rotulo: "Reclassificado p/ circulante", valor: fmtCompact(0) },
        ];
      })();

  const colunas: Column<LinhaClassificacao>[] = [
    {
      key: "contrato",
      header: "Contrato",
      minWidth: 250,
      value: (x) => x.pos.c.id,
      render: (x) => (
        <div className="py-0.5">
          <div className="font-semibold text-text">{x.pos.c.id}</div>
          <div className="text-xs text-label leading-snug">{x.pos.c.instrumento}</div>
        </div>
      ),
      total: () => "Total",
    },
    {
      key: "covenants",
      header: "Covenants",
      minWidth: 140,
      render: (x) => (
        <div className="flex flex-wrap gap-1">
          {x.apuracoes.map((a) => (
            <Tag key={a.cov.id} color={a.status === "ok" ? undefined : COR_ESTADO[estadoCovenant(a)]}>
              {SIGLA[a.cov.id]}
            </Tag>
          ))}
        </div>
      ),
    },
    {
      key: "classificacao",
      header: "Classificação",
      value: (x) => (x.pos.reclassificado ? 1 : 0),
      render: (x) =>
        x.pos.reclassificado ? (
          <ObjectStatus state="negative">Reclassificado (item 74)</ObjectStatus>
        ) : (
          <span className="text-[13px] text-label whitespace-nowrap">Cronograma contratual</span>
        ),
    },
    {
      key: "saldo",
      header: "Saldo contábil",
      align: "right",
      value: (x) => x.pos.saldoContabil,
      render: (x) => fmtNum(x.pos.saldoContabil),
      total: (r) => fmtNum(r.reduce((s, x) => s + x.pos.saldoContabil, 0)),
    },
    {
      key: "cronograma",
      header: "Circulante – cronograma",
      headerTitle: "Parcelas dos próximos 12 meses + juros a pagar − custos a apropriar no período",
      align: "right",
      value: (x) => x.circulanteCronograma,
      render: (x) => fmtNum(x.circulanteCronograma, { dash: true }),
      total: (r) => fmtNum(r.reduce((s, x) => s + x.circulanteCronograma, 0)),
    },
    {
      key: "reclass",
      header: "Reclassificado",
      align: "right",
      value: (x) => x.reclassificado,
      render: (x) => <span className={x.reclassificado > 0 ? "font-semibold text-negative" : undefined}>{fmtNum(x.reclassificado, { dash: true })}</span>,
      total: (r) => {
        const t = r.reduce((s, x) => s + x.reclassificado, 0);
        return <span className={t > 0 ? "text-negative" : undefined}>{fmtNum(t, { dash: true })}</span>;
      },
    },
    {
      key: "circ",
      header: "Circulante no balanço",
      align: "right",
      value: (x) => x.pos.circulante,
      render: (x) => fmtNum(x.pos.circulante, { dash: true }),
      total: (r) => fmtNum(r.reduce((s, x) => s + x.pos.circulante, 0)),
    },
    {
      key: "nc",
      header: "Não circulante no balanço",
      align: "right",
      value: (x) => x.pos.naoCirculante,
      render: (x) => fmtNum(x.pos.naoCirculante, { dash: true }),
      total: (r) => fmtNum(r.reduce((s, x) => s + x.pos.naoCirculante, 0)),
    },
  ];

  return (
    <Card
      title="Waiver e classificação (CPC 26, itens 74–76)"
      subtitle={`Efeito dos covenants na classificação circulante × não circulante em ${fmtDate(dataBase)}`}
      status={statusCard}
      bodyClassName="px-0 pb-0"
    >
      <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-5 gap-5 lg:gap-8">
        <div className="lg:col-span-3 min-w-0">
          <div className="space-y-2.5 text-sm text-text leading-relaxed">
            {paragrafos.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {minis.map((m) => (
              <Mini key={m.rotulo} rotulo={m.rotulo} valor={m.valor} cor={m.cor} sub={m.sub} />
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 min-w-0">
          {eventos.length ? (
            <>
              <div className="text-[13px] font-semibold text-text mb-3">Linha do tempo</div>
              <ol className="relative">
                {eventos.map((e, i) => (
                  <li key={`${e.data}-${i}`} className="relative pl-7 pb-4 last:pb-0">
                    {i < eventos.length - 1 && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-line" aria-hidden />}
                    <span
                      className="absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 bg-white"
                      style={{ borderColor: COR_ESTADO[e.estado], boxShadow: e.tag === "Data-base" ? `0 0 0 3px ${COR_ESTADO[e.estado]}26` : undefined }}
                      aria-hidden
                    >
                      <span className="absolute inset-[3px] rounded-full" style={{ backgroundColor: COR_ESTADO[e.estado] }} />
                    </span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-bold tabular text-text">{fmtDate(e.data)}</span>
                      {e.tag && <Tag color={e.tag === "Data-base" ? "#0070f2" : undefined}>{e.tag}</Tag>}
                    </div>
                    <div className="text-[13px] font-semibold text-text mt-0.5">{e.titulo}</div>
                    <div className="text-xs text-label leading-snug mt-0.5">{e.texto}</div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <div className="text-[13px] font-semibold text-text mb-2">Próximas apurações</div>
              <ul className="divide-y divide-line-soft border-y border-line-soft">
                {apuracoes.map((a) => (
                  <li key={a.cov.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="min-w-0 text-text">{a.cov.indicador}</span>
                    <span className="shrink-0 text-right tabular">
                      <span className="font-semibold text-text">{fmtDate(proximaApuracao(a.cov, dataBase))}</span>
                      <span className="block text-xs text-label">folga atual {fmtFolga(a.cov, a.folga)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Regra item="Item 74" titulo="Descumprimento sem waiver até a data do balanço">
          Todo o passivo do contrato vai para o circulante, ainda que o credor concorde, depois dessa data, em não exigir o pagamento.
        </Regra>
        <Regra item="Item 75" titulo="Waiver obtido até a data do balanço">
          Com prazo de carência de pelo menos 12 meses após a data do balanço, a dívida mantém a classificação do cronograma contratual.
        </Regra>
        <Regra item="Item 76" titulo="Waiver obtido após a data do balanço">
          Evento subsequente que não origina ajuste (CPC 24): a classificação não muda e o fato é divulgado em nota explicativa.
        </Regra>
      </div>

      <div className="border-t border-line-soft">
        <div className="px-4 pt-3 pb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h4 className="text-sm font-bold text-text">Contratos sujeitos a covenants</h4>
          <span className="text-xs text-label">Custo amortizado em {fmtDate(dataBase)} · R$</span>
        </div>
        <DataTable columns={colunas} rows={classificacao} rowKey={(x) => x.pos.c.id} showTotals />
      </div>
    </Card>
  );
}

function Regra({ item, titulo, children }: { item: string; titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-[#f5f6f7] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Tag color="#556b82">CPC 26 · {item}</Tag>
      </div>
      <div className="text-[13px] font-semibold text-text mt-1.5 leading-snug">{titulo}</div>
      <div className="text-xs text-label leading-snug mt-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Base de cálculo
// ---------------------------------------------------------------------------

function CardBaseCalculo({ serie, icsd }: { serie: IndicadoresCorporativos[]; icsd: ICSDAno[] }) {
  const covIcsd = COVENANTS_DIVIDA.find((c) => c.id === "icsd")!;
  const th = "px-3 py-2.5 text-right font-semibold text-[13px] border-b border-[#a8b2bd] whitespace-nowrap";
  const tdNum = "px-3 py-2 text-right tabular border-b border-line-soft whitespace-nowrap";
  const tdRot = "sticky left-0 z-[1] bg-white pl-4 pr-3 py-2 border-b border-line-soft";

  const colIcsd: Column<ICSDAno>[] = [
    { key: "ano", header: "Exercício", value: (x) => x.ano, render: (x) => <span className="font-semibold">{x.ano}</span> },
    { key: "geracao", header: "Geração de caixa", align: "right", value: (x) => x.geracaoCaixa, render: (x) => fmtNum(x.geracaoCaixa) },
    {
      key: "servico",
      header: "Serviço da dívida",
      headerTitle: "Principal + juros pagos no exercício",
      align: "right",
      value: (x) => x.servicoDivida,
      render: (x) => fmtNum(x.servicoDivida),
    },
    {
      key: "icsd",
      header: "ICSD",
      align: "right",
      value: (x) => x.icsd,
      render: (x) => {
        const s = statusCovenant(covIcsd, x.icsd);
        return (
          <span className="font-bold" style={{ color: s === "ok" ? undefined : COR_ESTADO[semaforoState(s)] }}>
            {fmtX(x.icsd)}
          </span>
        );
      },
    },
    { key: "min", header: "Mínimo", align: "right", render: () => fmtLimite(covIcsd) },
    {
      key: "status",
      header: "Status",
      render: (x) => {
        const s = statusCovenant(covIcsd, x.icsd);
        return <ObjectStatus state={semaforoState(s)}>{STATUS_TEXTO[s]}</ObjectStatus>;
      },
    },
  ];

  return (
    <Card
      title="Base de cálculo"
      subtitle="Componentes e indicadores por trimestre · valores em R$ · indicadores em múltiplos (x) e capitalização em %"
      bodyClassName="px-0 pb-0"
    >
      <div className="overflow-x-auto fiori-scroll">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-[2] bg-white text-left pl-4 pr-3 py-2.5 font-semibold text-[13px] border-b border-[#a8b2bd] min-w-[250px]">
                Item
              </th>
              {serie.map((i) => (
                <th key={i.data} className={th}>
                  <div>{fmtQuarter(i.data)}</div>
                  <div className="text-xs font-normal text-label">{fmtDate(i.data)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LINHAS_BASE.map((l) => (
              <tr key={l.rotulo} className={l.destaque ? "font-semibold" : undefined}>
                <td className={tdRot}>
                  <div className="whitespace-nowrap">{l.rotulo}</div>
                  {l.sub && <div className="text-xs text-label font-normal whitespace-nowrap">{l.sub}</div>}
                </td>
                {serie.map((i) => (
                  <td key={i.data} className={tdNum}>
                    {fmtNum(l.v(i))}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td colSpan={serie.length + 1} className="bg-[#f5f6f7] pl-4 pr-3 py-1.5 text-xs font-semibold text-label border-b border-line-soft uppercase tracking-wide">
                Indicadores dos covenants
              </td>
            </tr>
            {COVENANTS_TRIMESTRE.map((c) => (
              <tr key={c.id} className="font-semibold">
                <td className={tdRot}>
                  <div className="whitespace-nowrap">{c.indicador}</div>
                  <div className="text-xs text-label font-normal whitespace-nowrap">
                    {fmtLimite(c)} · apuração {c.periodicidade.toLowerCase()}
                  </div>
                </td>
                {serie.map((i) => {
                  const v = valorIndicador(c.id, i);
                  const s = statusCovenant(c, v);
                  const oficial = c.periodicidade === "Trimestral" || i.data.endsWith("-12-31");
                  return (
                    <td
                      key={i.data}
                      className={`${tdNum} ${oficial ? "" : "text-label font-normal"}`}
                      title={oficial ? undefined : "Informativo – apuração anual em 31/12"}
                      style={oficial && s !== "ok" ? { color: COR_ESTADO[semaforoState(s)] } : undefined}
                    >
                      {fmtValor(c, v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line-soft mt-4">
        <div className="px-4 pt-3 pb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h4 className="text-sm font-bold text-text">ICSD – apuração anual (BNDES)</h4>
          <span className="text-xs text-label">{covIcsd.formula}</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5">
          <div className="lg:col-span-3 min-w-0">
            <DataTable columns={colIcsd} rows={icsd} rowKey={(x) => String(x.ano)} emptyText="Nenhum exercício encerrado até a data-base" />
          </div>
          <div className="lg:col-span-2 px-4 py-3 lg:border-l border-line-soft text-xs text-label leading-relaxed space-y-2">
            <p>
              Serviço da dívida = principal + juros pagos no exercício por todos os contratos, conforme a movimentação (
              <Link to="/c01-movimentacao" className="text-link hover:underline">
                C01
              </Link>
              ). A geração de caixa do exercício vem da controladoria.
            </p>
            <p>
              Dívida bruta pelo custo amortizado (
              <Link to="/c00-carteira" className="text-link hover:underline">
                C00
              </Link>
              ) e encargos dos últimos 12 meses (
              <Link to="/c03-encargos" className="text-link hover:underline">
                C03
              </Link>
              ) calculados com as premissas importadas do SAP em cada data; aplicações financeiras pela carteira de aplicações na respectiva
              data.
            </p>
            <p>
              <strong className="text-text font-semibold">Nota:</strong> caixa, EBITDA, patrimônio líquido, ativo total, imóveis a pagar e geração
              de caixa são dados corporativos fictícios do ambiente de teste.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pequenos componentes
// ---------------------------------------------------------------------------

function Mini({ rotulo, valor, cor, sub }: { rotulo: string; valor: ReactNode; cor?: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-[#f5f6f7] px-3 py-2 min-w-0 flex flex-col justify-between">
      <div className="text-xs text-label leading-tight">{rotulo}</div>
      <div className="text-base sm:text-lg font-bold tabular text-text whitespace-nowrap mt-0.5" style={cor ? { color: cor } : undefined}>
        {valor}
      </div>
      {sub && <div className="text-[11px] text-label leading-tight mt-0.5">{sub}</div>}
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
