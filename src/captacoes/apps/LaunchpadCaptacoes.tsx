import clsx from "clsx";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  CheckCircle2,
  Info,
  Landmark,
  PieChart,
  Scale,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer } from "recharts";
import { Card, SectionTitle } from "../../shared/components/fiori/Card";
import { GenericTile } from "../../shared/components/fiori/GenericTile";
import { MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ShellBar } from "../../shared/components/shell/ShellBar";
import { useProduto } from "../../shared/context/ProdutoContext";
import cdsResumo from "../../shared/data/cdsResumo";
import { AVISO_DADOS, IMPORTACAO_SAP, ultimoDadoNaDataBase } from "../../shared/data/mercado";
import type { RelatorioBase } from "../../shared/data/relatorio";
import { addDays, diffDays, fmtDate, lastMonthEnds } from "../../shared/lib/dates";
import { fmtCompact, fmtDec, fmtInt, fmtMi, fmtPct, fmtX } from "../../shared/lib/format";
import type { ApuracaoCovenant } from "../lib/covenants";
import type { CovenantId } from "../data/covenants";
import { RELATORIOS_CAPTACOES, SECOES_CAPTACOES } from "../data/catalogo";
import { COR_MODALIDADE, GRUPO_MODALIDADE, type ContratoDivida } from "../data/contratos";
import { useCovenants, useDivida } from "../context/useDivida";
import {
  cronograma,
  custoMedioPonderado,
  encargosDivida,
  movimentacaoDivida,
  perfilAmortizacao,
  posicoesDivida,
  prazoMedioCarteira,
  totalDivida,
} from "../lib/divida";
import { checagensIntegridade, checklistFechamento, conciliacaoExtratos, conciliacaoGL } from "../lib/fechamento";

// ---------------------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------------------

function saudacao(d: Date) {
  const h = d.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function plural(n: number, singular: string, pluralTxt: string) {
  return `${fmtInt(n)} ${n === 1 ? singular : pluralTxt}`;
}

/** "2026-03-31T19:05:00" → "31/03/2026 às 19:05" */
function fmtDataHora(isoDataHora: string) {
  return `${fmtDate(isoDataHora.slice(0, 10))} às ${isoDataHora.slice(11, 16)}`;
}

function fmtCovenant(a: ApuracaoCovenant, v: number, casas?: number) {
  return a.cov.formato === "pct" ? fmtPct(v, casas ?? 1) : fmtX(v, casas ?? 2);
}

/** Estado visual de um covenant: descumprido sem waiver = negativo; com waiver ou em atenção = crítico */
function estadoCovenant(a: ApuracaoCovenant): ValueState {
  if (!a.dataApuracao) return "neutral";
  if (a.status === "excedido") return a.reclassifica ? "negative" : "critical";
  if (a.status === "atencao") return "critical";
  return "positive";
}

/** Nomes curtos dos covenants para listas compactas (o nome completo fica no tooltip) */
const NOME_CURTO: Record<CovenantId, string> = {
  dlEbitda: "Dívida líquida / EBITDA",
  icsd: "ICSD (serviço da dívida)",
  capitalizacao: "Índice de capitalização",
  ebitdaDespFin: "EBITDA / encargos financeiros",
  dlImoveisPl: "(DL + imóveis a pagar) / PL",
};

function siglaCovenant(a: ApuracaoCovenant) {
  return a.cov.id === "icsd" ? "ICSD" : NOME_CURTO[a.cov.id];
}

/** Mesmas cores do C02: circulante (12 meses) × não circulante */
const COR_CP = "#e26300";
const COR_NC = "#0070f2";

const COR_ESTADO: Record<ValueState, string> = {
  positive: "#256f3a",
  critical: "#b44f00",
  negative: "#aa0808",
  information: "#0070f2",
  neutral: "#1d2d3e",
};

interface EventoPag {
  c: ContratoDivida;
  data: string;
  principal: number;
  juros: number;
}

interface EventoContratual {
  chave: string;
  c: ContratoDivida;
  data: string;
  titulo: string;
  detalhe: string;
  /** texto completo (tooltip) quando o detalhe é resumido */
  dica?: string;
  critico: boolean;
}

// ---------------------------------------------------------------------------
// Launchpad
// ---------------------------------------------------------------------------

export function LaunchpadCaptacoes() {
  const navigate = useNavigate();
  const produto = useProduto();
  const alertas = produto.alertas;
  const { premissas: p, contratos, posicoes, reclassificados, abertura } = useDivida("todas");
  const covenants = useCovenants();
  const [busca, setBusca] = useState("");
  const [agora, setAgora] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const db = p.dataBase;

  const d = useMemo(() => {
    const total = totalDivida(posicoes);
    const circulante = posicoes.reduce((s, x) => s + x.circulante, 0);
    const naoCirculante = posicoes.reduce((s, x) => s + x.naoCirculante, 0);
    const principalCP = posicoes.reduce((s, x) => s + x.principalCirculante, 0);
    const custoMedio = custoMedioPonderado(posicoes);
    const prazoMedio = prazoMedioCarteira(posicoes);
    const empresas = new Set(posicoes.map((x) => x.c.empresa)).size;

    // Evolução do saldo (13 fins de mês) – posições pelo custo amortizado em cada data
    const evolucao = lastMonthEnds(db, 13).map((m) => ({ data: m, v: totalDivida(posicoesDivida(contratos, m, p)) }));

    // Perfil de amortização do principal: circulante (12 meses) + não circulante por ano
    const porAno = new Map<number, number>();
    let perfilCP = 0;
    for (const x of posicoes) {
      const perfil = perfilAmortizacao(x, db);
      perfilCP += perfil.circulante;
      for (const [ano, v] of perfil.porAno) porAno.set(ano, (porAno.get(ano) ?? 0) + v);
    }
    const perfil = [
      { rotulo: "12m", v: perfilCP, cp: true },
      ...[...porAno.entries()].sort((a, b) => a[0] - b[0]).map(([ano, v]) => ({ rotulo: String(ano), v, cp: false })),
    ];

    // Movimentação e encargos no exercício (abertura → data-base)
    const mov = movimentacaoDivida(contratos, abertura, db, p).total;
    const encargos = encargosDivida(contratos, abertura, db, p).reduce((s, e) => s + e.total, 0);

    // Pagamentos projetados (principal + juros) com o último dado disponível
    const limite30 = addDays(db, 30);
    const eventos: EventoPag[] = cronograma(contratos, db, p)
      .flatMap((l) => l.eventos.map((e) => ({ c: l.c, ...e })))
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.c.id.localeCompare(b.c.id)));
    const em30 = eventos.filter((e) => e.data <= limite30);
    const valor30 = em30.reduce((s, e) => s + e.principal + e.juros, 0);

    // Eventos contratuais nos próximos 12 meses
    const limite12m = addDays(db, 365);
    const eventosContratuais: EventoContratual[] = [];
    for (const x of posicoes) {
      const c = x.c;
      if (c.vencimento <= limite12m) {
        eventosContratuais.push({
          chave: `venc-${c.id}`,
          c,
          data: c.vencimento,
          titulo: `${c.id} · vencimento final`,
          detalhe: `${fmtDate(c.vencimento)} · saldo ${fmtCompact(x.saldoContabil)}`,
          critico: true,
        });
      }
      // Início da amortização: 1ª parcela de principal do cronograma projetado pelo motor (mesmo valor do C00/C02)
      const jaAmortizou = c.amortizacoes.some((a) => a.data <= db);
      const primeira = eventos.find((e) => e.c.id === c.id && e.principal > 0.5);
      if (!jaAmortizou && primeira && primeira.data <= limite12m && primeira.data < c.vencimento) {
        eventosContratuais.push({
          chave: `amort-${c.id}`,
          c,
          data: primeira.data,
          titulo: `${c.id} · início da amortização`,
          detalhe: `${fmtDate(primeira.data)} · 1ª parcela + juros ${fmtCompact(primeira.principal + primeira.juros)}`,
          dica: `1ª parcela em ${fmtDate(primeira.data)}: principal ${fmtCompact(primeira.principal)} + juros ${fmtCompact(primeira.juros)} (projeção com o último dado disponível)`,
          critico: false,
        });
      }
      if (c.capitalizacaoCPC20 && c.capitalizacaoCPC20.ate > db && c.capitalizacaoCPC20.ate <= limite12m) {
        eventosContratuais.push({
          chave: `cpc20-${c.id}`,
          c,
          data: c.capitalizacaoCPC20.ate,
          titulo: `${c.id} · fim da capitalização`,
          detalhe: `${fmtDate(c.capitalizacaoCPC20.ate)} · encargos à despesa (CPC 20)`,
          critico: false,
        });
      }
    }
    eventosContratuais.sort((a, b) => (a.data < b.data ? -1 : 1));

    // Composição por modalidade
    const grupos = new Map<string, number>();
    for (const x of posicoes) {
      const g = GRUPO_MODALIDADE[x.c.modalidade];
      grupos.set(g, (grupos.get(g) ?? 0) + x.saldoContabil);
    }
    const composicao = [...grupos.entries()]
      .map(([grupo, v]) => ({ grupo, v, share: total > 0 ? v / total : 0 }))
      .sort((a, b) => b.v - a.v);

    // Fechamento (C05)
    const gl = conciliacaoGL(posicoes, db);
    const extratos = conciliacaoExtratos(posicoes, db);
    const checagens = checagensIntegridade(posicoes, db, p, gl, extratos);
    // Mesmo critério do C05: "Aprovado" só com a etapa de aprovação da Controladoria concluída
    const aprovado = checklistFechamento(db, checagens).find((e) => e.id === "aprovacao")?.status === "Concluído";

    return {
      total,
      circulante,
      naoCirculante,
      principalCP,
      pctCirculante: total > 0 ? circulante / total : 0,
      custoMedio,
      prazoMedio,
      empresas,
      evolucao,
      perfil,
      mov,
      variacao: mov.saldoFinal - mov.saldoInicial,
      encargos,
      eventos,
      em30,
      valor30,
      limite30,
      eventosContratuais,
      composicao,
      checagens,
      checagensOk: checagens.filter((c) => c.ok).length,
      aprovado,
    };
  }, [posicoes, contratos, abertura, db, p]);

  // Covenants
  const cumpridos = covenants.filter((a) => a.dataApuracao && a.status !== "excedido").length;
  const excedidos = covenants.filter((a) => a.status === "excedido");
  const emAtencao = covenants.filter((a) => a.status === "atencao");
  const comReclassificacao = covenants.some((a) => a.reclassifica);
  const covState: ValueState = comReclassificacao ? "negative" : excedidos.length || emAtencao.length ? "critical" : "positive";
  const covResumo = comReclassificacao
    ? "Dívida reclassificada"
    : excedidos.length
      ? excedidos.every((a) => a.waiverVigente)
        ? `Waiver ${excedidos.map((a) => a.waiver?.credor).join(", ")} obtido`
        : `${plural(excedidos.length, "descumprido", "descumpridos")}`
      : emAtencao.length
        ? `${plural(emAtencao.length, "em atenção", "em atenção")}`
        : "Todos cumpridos";
  const covDestaque = covenants.find((a) => a.reclassifica) ?? excedidos[0] ?? emAtencao[0];
  const covSub = !covDestaque
    ? "Todos dentro do limite"
    : covDestaque.reclassifica
      ? `${siglaCovenant(covDestaque)} sem waiver`
      : covDestaque.status === "excedido"
        ? `${siglaCovenant(covDestaque)} com waiver`
        : `${siglaCovenant(covDestaque)} em atenção`;
  const covHint = covDestaque
    ? `${covDestaque.cov.indicador}: ${fmtCovenant(covDestaque, covDestaque.valor)} (limite ${covDestaque.cov.tipo === "max" ? "≤" : "≥"} ${fmtCovenant(covDestaque, covDestaque.cov.limite, covDestaque.cov.formato === "pct" ? 0 : 1)})`
    : undefined;

  const reclassIds = [...reclassificados].sort();
  const checagensPendentes = d.checagens.length - d.checagensOk;
  const ano = db.slice(0, 4);

  const tiles: Record<string, Parameters<typeof GenericTile>[0]> = {
    premissas: {
      title: "Premissas",
      subtitle: "Importadas do SAP",
      value: fmtDec(p.cdi * 100, 2),
      unit: "CDI % a.a.",
      footer: `IPCA ${fmtPct(p.ipca12m)} · TJLP ${fmtPct(p.tjlp)}`,
    },
    c00: {
      title: "Carteira de Captações",
      subtitle: "C00 · Custo amortizado",
      value: fmtMi(d.total),
      unit: "R$ milhões",
      footer: `${plural(posicoes.length, "contrato ativo", "contratos ativos")} · ${plural(d.empresas, "empresa", "empresas")}`,
      wide: true,
      chart: (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={d.evolucao} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="spark-captacoes" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0070f2" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#0070f2" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="v"
              stroke="#0070f2"
              strokeWidth={2}
              fill="url(#spark-captacoes)"
              isAnimationActive={false}
              baseValue="dataMin"
            />
          </AreaChart>
        </ResponsiveContainer>
      ),
    },
    c02: {
      title: "Vencimentos e CP/LP",
      subtitle: "C02 · Perfil de amortização",
      value: fmtDec(d.pctCirculante * 100, 1),
      unit: "% da dívida no circulante",
      state: reclassIds.length ? "negative" : "neutral",
      footer: reclassIds.length
        ? `Reclassificados (CPC 26): ${reclassIds.join(", ")}`
        : `Principal em 12 meses: ${fmtCompact(d.principalCP)}`,
      footerState: reclassIds.length ? "negative" : undefined,
      wide: true,
      chart: (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={d.perfil} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="18%">
            <Bar dataKey="v" isAnimationActive={false} radius={[2, 2, 0, 0]}>
              {d.perfil.map((b) => (
                <Cell key={b.rotulo} fill={b.cp ? COR_CP : COR_NC} fillOpacity={b.cp ? 1 : 0.55} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ),
    },
    c01: {
      title: "Movimentação da Dívida",
      subtitle: `C01 · Desde ${fmtDate(abertura)}`,
      value: `${d.variacao > 0.05e6 ? "+" : d.variacao < -0.05e6 ? "\u2212" : ""}${fmtMi(Math.abs(d.variacao))}`,
      indicator: d.variacao >= 0 ? "up" : "down",
      unit: "R$ milhões no exercício",
      footer: `Captações: ${fmtCompact(d.mov.captacoes)}`,
    },
    c03: {
      title: "Encargos e Custo da Dívida",
      subtitle: "C03 · Custo médio",
      value: fmtDec(d.custoMedio * 100, 2),
      unit: "% a.a. (juros + correção)",
      footer: `Encargos ${ano}: ${fmtCompact(d.encargos)}`,
    },
    c04: {
      title: "Covenants",
      subtitle: "C04 · Última apuração",
      value: `${cumpridos}/${covenants.length}`,
      unit: "covenants cumpridos",
      state: covState,
      footer: covResumo,
      footerState: covState,
    },
    c05: {
      title: "Fechamento e Conciliação",
      subtitle: "C05 · Integridade",
      value: `${d.checagensOk}/${d.checagens.length}`,
      unit: "checagens OK",
      state: checagensPendentes ? "critical" : "positive",
      footer: checagensPendentes
        ? plural(checagensPendentes, "checagem pendente", "checagens pendentes")
        : d.aprovado
          ? "Período aprovado"
          : "Pronto para aprovação",
      footerState: checagensPendentes ? "critical" : "positive",
    },
    c06: {
      title: "Nota Explicativa de Captações",
      subtitle: "C06 · CPC 40 / CPC 26",
      value: fmtMi(d.total),
      unit: "R$ milhões (consolidado)",
      footer: (
        <span title={`Circulante ${fmtCompact(d.circulante)} · Não circulante ${fmtCompact(d.naoCirculante)}`}>
          CP {fmtMi(d.circulante)} · NC {fmtMi(d.naoCirculante)}
        </span>
      ),
    },
    cds: {
      title: "Catálogo de CDS Views",
      subtitle: "Base técnica SAP",
      value: String(cdsResumo.visoes),
      unit: "CDS Views catalogadas",
      footer: `${fmtInt(cdsResumo.campos)} campos mapeados`,
    },
  };

  const termo = busca.trim().toLowerCase();
  const filtra = (r: RelatorioBase) =>
    !termo || [r.titulo, r.tituloCurto, r.descricao, r.codigo, r.publico, r.aba].some((t) => t.toLowerCase().includes(termo));
  const visiveis = RELATORIOS_CAPTACOES.filter(filtra);
  const abrir = (r: RelatorioBase) => navigate(r.rota);

  return (
    <div className="min-h-screen flex flex-col horizon-backdrop">
      <ShellBar search={{ value: busca, onChange: setBusca }} />

      <main className="flex-1 max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Cabeçalho da página */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-6">
          <div className="min-w-0">
            <p className="text-sm text-label first-letter:uppercase">
              {agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
            <h1 className="text-2xl sm:text-[1.75rem] font-bold text-text leading-tight mt-0.5">{saudacao(agora)}!</h1>
            <p className="text-base text-label mt-1">{produto.descricao}</p>
          </div>
          <div className="flex items-stretch gap-4 sm:gap-6 bg-white/70 backdrop-blur rounded-2xl shadow-fiori px-5 py-3 self-start lg:self-auto">
            <QuickStat label="Dívida bruta" value={fmtCompact(d.total)} />
            <div className="w-px bg-line-soft" />
            <QuickStat label="Custo médio" value={`${fmtPct(d.custoMedio)} a.a.`} />
            <div className="w-px bg-line-soft hidden sm:block" />
            <QuickStat label="Data-base" value={fmtDate(db)} className="hidden sm:block" />
          </div>
        </div>

        <MessageStrip design="critical" className="mb-2">
          <strong>{AVISO_DADOS}</strong>
        </MessageStrip>
        <p className="text-xs text-label mb-7 px-1">
          Premissas gerais importadas do {IMPORTACAO_SAP.sistema} em {fmtDataHora(IMPORTACAO_SAP.ultimaImportacao)} · último dado
          disponível {fmtDate(ultimoDadoNaDataBase(p.dataBase))} ·{" "}
          <button type="button" className="text-link font-semibold hover:underline" onClick={() => navigate("/premissas")}>
            ver premissas
          </button>{" "}
          · altere a data-base no topo da página para rever o fechamento de meses anteriores.
        </p>

        {/* Visão geral */}
        {!termo && (
          <section className="mb-8">
            <SectionTitle extra={<span className="text-xs text-label whitespace-nowrap">Posição em {fmtDate(db)}</span>}>
              Visão geral
            </SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
              <KpiCard
                className="col-span-2 xl:col-span-1"
                label="Dívida bruta"
                value={fmtCompact(d.total)}
                sub="Custo amortizado (CPC 48)"
              />
              <KpiCard
                label="Circulante"
                value={fmtCompact(d.circulante)}
                sub={reclassIds.length ? `${fmtPct(d.pctCirculante, 1)} · reclassificado` : `${fmtPct(d.pctCirculante, 1)} da dívida`}
                hint={
                  reclassIds.length
                    ? `Inclui o não circulante de ${reclassIds.join(", ")} reclassificado para o circulante (CPC 26, item 74)`
                    : undefined
                }
                subState={reclassIds.length ? "negative" : undefined}
                color={reclassIds.length ? COR_ESTADO.negative : undefined}
              />
              <KpiCard label="Não circulante" value={fmtCompact(d.naoCirculante)} sub={`${fmtPct(1 - d.pctCirculante, 1)} da dívida`} />
              <KpiCard label="Custo médio ponderado" value={`${fmtPct(d.custoMedio)} a.a.`} sub={`CDI ${fmtPct(p.cdi)} a.a.`} />
              <KpiCard label="Prazo médio" value={`${fmtDec(d.prazoMedio, 1)} anos`} sub="Amortização do principal" />
              <KpiCard
                label="Covenants cumpridos"
                value={`${cumpridos}/${covenants.length}`}
                color={COR_ESTADO[covState]}
                sub={covSub}
                hint={covHint}
                subState={covState === "positive" ? undefined : covState}
              />
              <KpiCard
                label="Pagamentos em 30 dias"
                value={fmtCompact(d.valor30)}
                sub={d.em30.length ? `${plural(d.em30.length, "evento", "eventos")} até ${fmtDate(d.limite30)}` : "Nenhum pagamento previsto"}
              />
            </div>
          </section>
        )}

        {/* Aplicativos agrupados pelas seções do Índice */}
        <div className="flex flex-wrap gap-x-10 gap-y-7 mb-8">
          {SECOES_CAPTACOES.map((s) => {
            const rels = visiveis.filter((r) => r.secao === s.id);
            if (!rels.length) return null;
            return (
              <section key={s.id} className="min-w-0 w-full sm:w-auto">
                <h2 className="text-base font-bold text-text mb-3 sm:whitespace-nowrap">
                  <span className="text-label font-normal mr-1">{s.numero}.</span>
                  {s.titulo}
                </h2>
                <div className="flex flex-wrap gap-3">
                  {rels.map((r) => (
                    <GenericTile key={r.id} icon={r.icone} iconColor={r.cor} onClick={() => abrir(r)} {...tiles[r.id]} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {visiveis.length === 0 && (
          <div className="text-center py-16 text-label">
            <p className="text-base">Nenhum relatório encontrado para “{busca}”.</p>
          </div>
        )}

        {/* Informações e alertas */}
        {!termo && (
          <section className="mt-2">
            <SectionTitle extra={<span className="text-xs text-label whitespace-nowrap">{plural(alertas.length, "alerta", "alertas")} na data-base</span>}>
              Informações e alertas
            </SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {/* Próximos pagamentos */}
              <Card
                title="Próximos pagamentos"
                subtitle="Principal e juros projetados com o último dado disponível (C02)"
                icon={<Banknote className="w-5 h-5 text-brand" />}
                actions={<VerMais onClick={() => navigate("/c02-cronograma")} />}
              >
                {d.eventos.length === 0 ? (
                  <Vazio texto="Nenhum pagamento previsto" />
                ) : (
                  <>
                    <ul className="divide-y divide-line-soft -mx-1">
                      {d.eventos.slice(0, 5).map((e) => {
                        const dias = diffDays(db, e.data);
                        const tipo = e.principal > 0.005 && e.juros > 0.005 ? "Principal + juros" : e.principal > 0.005 ? "Principal" : "Juros";
                        return (
                          <li key={`${e.c.id}-${e.data}`} className="flex items-center justify-between gap-3 px-1 py-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-text truncate">
                                {e.c.id} · {e.c.credor}
                              </div>
                              <div className="text-xs text-label truncate">
                                {fmtDate(e.data)} · {tipo} · {fmtCompact(e.principal + e.juros)}
                              </div>
                            </div>
                            <ObjectStatus inverted icon={false} state={dias <= 30 ? "information" : "neutral"}>
                              {plural(dias, "dia", "dias")}
                            </ObjectStatus>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-2 pt-2 border-t border-line-soft flex items-center justify-between gap-3 text-xs">
                      <span className="text-label">Total em 30 dias</span>
                      <span className="font-semibold text-text tabular whitespace-nowrap">
                        {fmtCompact(d.valor30)} · {plural(d.em30.length, "evento", "eventos")}
                      </span>
                    </div>
                  </>
                )}
              </Card>

              {/* Composição */}
              <Card
                title="Composição da dívida"
                subtitle="Saldo pelo custo amortizado por modalidade (C00)"
                icon={<PieChart className="w-5 h-5 text-[#8b47d7]" />}
                actions={<VerMais onClick={() => navigate("/c00-carteira")} />}
              >
                <ul className="space-y-2.5">
                  {d.composicao.map((g) => (
                    <li key={g.grupo}>
                      <div className="flex items-center justify-between gap-3 text-[13px] mb-1">
                        <span className="inline-flex items-center gap-2 text-text font-semibold truncate">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COR_MODALIDADE[g.grupo] ?? "#758ca4" }} />
                          {g.grupo}
                        </span>
                        <span className="tabular text-label whitespace-nowrap">
                          {fmtCompact(g.v)} · {fmtPct(g.share, 1)}
                        </span>
                      </div>
                      <MicroBar value={g.share} max={1} color={COR_MODALIDADE[g.grupo] ?? "#758ca4"} />
                    </li>
                  ))}
                </ul>
                <div className="mt-3 pt-2 border-t border-line-soft flex items-center justify-between gap-3 text-xs">
                  <span className="text-label">Total ({plural(posicoes.length, "contrato", "contratos")})</span>
                  <span className="font-semibold text-text tabular whitespace-nowrap">{fmtCompact(d.total)}</span>
                </div>
              </Card>

              {/* Eventos contratuais */}
              <Card
                title="Eventos contratuais"
                subtitle="Vencimentos, início da amortização e CPC 20 nos próximos 12 meses"
                icon={<CalendarClock className="w-5 h-5 text-[#c87b00]" />}
                actions={<VerMais onClick={() => navigate("/c02-cronograma")} />}
              >
                {d.eventosContratuais.length === 0 ? (
                  <Vazio texto="Nenhum evento nos próximos 12 meses" />
                ) : (
                  <ul className="divide-y divide-line-soft -mx-1">
                    {d.eventosContratuais.slice(0, 6).map((e) => (
                      <li key={e.chave} className="flex items-center justify-between gap-3 px-1 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-text truncate">{e.titulo}</div>
                          <div className="text-xs text-label truncate" title={e.dica ?? e.detalhe}>
                            {e.detalhe}
                          </div>
                        </div>
                        <ObjectStatus inverted icon={false} state={e.critico ? "critical" : "information"}>
                          {plural(diffDays(db, e.data), "dia", "dias")}
                        </ObjectStatus>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Covenants */}
              <Card
                title="Covenants"
                subtitle={`Última apuração até ${fmtDate(db)} (C04)`}
                icon={<Scale className="w-5 h-5 text-[#df1278]" />}
                actions={<VerMais onClick={() => navigate("/c04-covenants")} />}
              >
                <ul className="divide-y divide-line-soft -mx-1">
                  {covenants.map((a) => {
                    const st = estadoCovenant(a);
                    const limite = `Limite ${a.cov.tipo === "max" ? "≤" : "≥"} ${fmtCovenant(a, a.cov.limite, a.cov.formato === "pct" ? 0 : 1)}`;
                    const nota =
                      a.status === "excedido"
                        ? a.reclassifica
                          ? "sem waiver"
                          : `waiver em ${fmtDate(a.waiver?.obtidoEm)}`
                        : a.dataApuracao
                          ? fmtDate(a.dataApuracao)
                          : "sem apuração";
                    return (
                      <li key={a.cov.id} className="flex items-center justify-between gap-3 px-1 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-text truncate" title={a.cov.indicador}>
                            {NOME_CURTO[a.cov.id]}
                          </div>
                          <div className={clsx("text-xs truncate", a.status === "excedido" ? (a.reclassifica ? "text-negative" : "text-critical") : "text-label")}>
                            {limite} · {nota}
                          </div>
                        </div>
                        <ObjectStatus state={st}>{a.dataApuracao ? fmtCovenant(a, a.valor) : "—"}</ObjectStatus>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>

            {/* Lista de alertas */}
            <Card
              className="mt-4"
              title="Central de alertas"
              subtitle="Gerada automaticamente a partir dos relatórios para a data-base selecionada"
              icon={<Sparkles className="w-5 h-5 text-brand" />}
            >
              {alertas.length === 0 ? (
                <Vazio texto="Nenhum alerta" />
              ) : (
                <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 divide-y lg:divide-y-0 divide-line-soft">
                  {alertas.map((a) => {
                    const Icon = a.severidade === "negative" ? XCircle : a.severidade === "critical" ? AlertTriangle : Info;
                    return (
                      <li key={a.id} className="lg:border-b lg:border-line-soft">
                        <button
                          type="button"
                          onClick={() => navigate(a.rota)}
                          className="w-full flex items-start gap-3 py-2.5 text-left rounded-lg hover:bg-hover px-2 -mx-2"
                        >
                          <Icon
                            className={clsx(
                              "w-4 h-4 mt-0.5 shrink-0",
                              a.severidade === "negative" ? "text-negative" : a.severidade === "critical" ? "text-critical-strong" : "text-brand",
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-text">{a.titulo}</span>
                            <span className="block text-xs text-label mt-0.5">{a.descricao}</span>
                          </span>
                          <ArrowRight className="w-4 h-4 text-label mt-0.5 shrink-0" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {/* Sobre o produto */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Destaque
                icon={<Landmark className="w-5 h-5 text-brand" />}
                titulo="Fonte: SAP S/4HANA TRM"
                texto="Contratos, fluxos e condições lidos das CDS Views do SAP (IFINTRAN, IFINTRSMANAGE, IFINTRANSCNDN, CMATPROFILEQ)."
              />
              <Destaque
                icon={<CheckCircle2 className="w-5 h-5 text-positive" />}
                titulo="Conciliação automática"
                texto="A movimentação do C01 fecha com a carteira do C00, que concilia com o FI-GL e com os extratos de BNDES, agentes fiduciários e securitizadoras (C05)."
              />
              <Destaque
                icon={<ShieldCheck className="w-5 h-5 text-[#8b47d7]" />}
                titulo="Normas contábeis"
                texto="Custo amortizado (CPC 48), circulante × não circulante com reclassificação por covenant (CPC 26), juros capitalizados (CPC 20) e nota explicativa (CPC 40)."
              />
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-line-soft bg-white/80 mt-8">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap gap-2 items-center justify-between text-xs text-label">
          <span>SAP Fiori Launchpad · tema Horizon · Demo Dexterity IT Solutions</span>
          <span className="tabular">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componentes locais
// ---------------------------------------------------------------------------

function QuickStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-label whitespace-nowrap">{label}</div>
      <div className="text-lg font-bold text-text tabular whitespace-nowrap">{value}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  subState,
  hint,
  color = "#1d2d3e",
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  subState?: ValueState;
  /** texto completo exibido como tooltip do subtítulo */
  hint?: string;
  color?: string;
  className?: string;
}) {
  return (
    <div className={clsx("bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 min-w-0", className)}>
      <div className="text-[13px] text-label truncate" title={label}>
        {label}
      </div>
      <div className="text-xl font-bold tabular truncate mt-0.5" style={{ color }}>
        {value}
      </div>
      {sub && (
        <div
          className={clsx("text-xs truncate mt-0.5", subState ? "font-semibold" : "text-label")}
          style={subState ? { color: COR_ESTADO[subState] } : undefined}
          title={hint ?? sub}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function VerMais({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="p-1.5 rounded-lg text-link hover:bg-hover" aria-label="Abrir relatório" title="Abrir relatório">
      <ArrowRight className="w-4 h-4" />
    </button>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-3 rounded-lg bg-positive-bg text-positive text-[13px] font-semibold">
      <CheckCircle2 className="w-4 h-4" /> {texto}
    </div>
  );
}

function Destaque({ icon, titulo, texto }: { icon: ReactNode; titulo: string; texto: string }) {
  return (
    <div className="bg-white/70 rounded-[var(--radius-card)] border border-line-soft px-4 py-3 flex gap-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <div className="text-sm font-bold text-text">{titulo}</div>
        <div className="text-[13px] text-label leading-relaxed mt-0.5">{texto}</div>
      </div>
    </div>
  );
}
