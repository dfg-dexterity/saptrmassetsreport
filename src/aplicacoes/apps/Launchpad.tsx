import clsx from "clsx";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  Info,
  Landmark,
  Scale,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Card, SectionTitle } from "../../shared/components/fiori/Card";
import { GenericTile } from "../../shared/components/fiori/GenericTile";
import { MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, semaforoState, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ShellBar } from "../../shared/components/shell/ShellBar";
import { RELATORIOS, SECOES, type Relatorio } from "../data/catalogo";
import { OPERACOES } from "../data/carteira";
import { FUNDOS } from "../data/fundos";
import { TIME_DEPOSITS } from "../data/timeDeposits";
import cdsResumo from "../../shared/data/cdsResumo";
import { useAlertas } from "../context/useDados";
import {
  contratosMestre,
  evolucaoMestre,
  movimentacaoMestre,
  rentabilidadeMestre,
  somaMestre,
  TIPOS_CONTRATO,
  type RentabContrato,
  type TipoContrato,
} from "../lib/carteiraMestre";
import { useBenchmarks } from "../context/BenchmarkContext";
import { AVISO_DADOS, IMPORTACAO_SAP, ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import { compararCarteira, SITUACAO_STATE, TOLERANCIA_BENCHMARK } from "../lib/benchmark";
import { usePremissas } from "../../shared/context/MercadoContext";
import { diffDays, fmtDate, fmtMonthShort, lastMonthEnds, previousMonthEnd } from "../../shared/lib/dates";
import { analiseFiscal, consolidarRentabilidade, posicoesEm, rentabilidade } from "../lib/finance";
import { historicoFundo, posicaoFundo } from "../lib/fundos";
import { posicaoTimeDeposit } from "../lib/timeDeposit";
import { fmtCompact, fmtDec, fmtInt, fmtMi, fmtPct, fmtX } from "../../shared/lib/format";
import {
  apurarCovenants,
  avaliarPolitica,
  classificarHHI,
  concentracaoPorGrupo,
  fmtLimiteCovenant,
  fmtValorCovenant,
  hhi,
  rotuloApuracao,
  rotuloCovenant,
  totalCarteira,
  totalMestre,
  type Semaforo,
} from "../lib/indicadores";

/** Ordem de gravidade do semáforo (para achar o pior status) */
const NIVEL: Record<Semaforo, number> = { ok: 0, atencao: 1, excedido: 2 };

const COR_SEMAFORO: Record<Semaforo, string> = { ok: "#30914c", atencao: "#e26300", excedido: "#f53232" };

/** Rótulos curtos dos tipos de contrato no rodapé do tile da Carteira-Mestre */
const ROTULO_TIPO: Record<TipoContrato, [string, string]> = {
  "Renda fixa bancária": ["renda fixa", "renda fixa"],
  "Tesouro Direto": ["título", "títulos"],
  "Fundo de investimento": ["fundo", "fundos"],
  "Time deposit": ["TD", "TDs"],
};

/**
 * Rentabilidade consolidada dos contratos da Carteira-Mestre no período (mesma fórmula do R03):
 * % do CDI líquido = Σ rendimento líquido ÷ Σ (base × CDI do período); rentabilidade real = líquida ÷ IPCA do período.
 */
function consolidarMestre(linhas: RentabContrato[], inicio: string, p: PremissasMercado) {
  const diasPeriodo = Math.max(1, diffDays(inicio, p.dataBase));
  const soma = (fn: (l: RentabContrato) => number) => linhas.reduce((s, l) => s + fn(l), 0);
  const capital = soma((l) => l.base * (l.dias / diasPeriodo));
  const peso = soma((l) => l.base * l.cdiPeriodo);
  const rendLiquido = soma((l) => l.rendLiquido);
  const rentabLiquida = capital > 0 ? rendLiquido / capital : 0;
  const ipcaPeriodo = Math.pow(1 + p.ipca12m, diasPeriodo / 365) - 1;
  return {
    rendLiquido,
    pctCDILiquido: peso > 0 ? rendLiquido / peso : 0,
    rentabReal: (1 + rentabLiquida) / (1 + ipcaPeriodo) - 1,
  };
}

function saudacao(d: Date) {
  const h = d.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export function Launchpad() {
  const navigate = useNavigate();
  const { premissas: p } = usePremissas();
  const alertas = useAlertas();
  const { cadastro } = useBenchmarks();
  const [busca, setBusca] = useState("");
  const [agora, setAgora] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const d = useMemo(() => {
    const meses = lastMonthEnds(p.dataBase, 13);
    const inicio12 = meses[0];

    // Renda fixa bancária (R01, R03 por operação, R04)
    const pos = posicoesEm(OPERACOES, p.dataBase, p);
    const totalRF = totalCarteira(pos);
    const linhasRF = rentabilidade(OPERACOES, inicio12, p.dataBase, p);
    const rentRF = consolidarRentabilidade(linhasRF, inicio12, p.dataBase, p);
    const bmkRF = compararCarteira(linhasRF, cadastro, p);
    const fiscal = pos.map((x) => analiseFiscal(x, p));
    const aguardar = fiscal.filter((f) => f.recomendacao === "Aguardar próxima faixa");
    const iof = fiscal.filter((f) => f.recomendacao === "Evitar resgate (IOF)");

    // Carteira consolidada (Carteira-Mestre: renda fixa bancária, Tesouro Direto, fundos e time deposits)
    const mestre = contratosMestre(p.dataBase, p);
    const total = totalMestre(mestre);
    const contabil = somaMestre(mestre, "valorContabil");
    const evol = evolucaoMestre(meses.slice(1), p);
    const rend12 = evol.reduce((s, m) => s + m.rendimentos, 0);
    const linhas12 = rentabilidadeMestre(inicio12, p.dataBase, p);
    const bmk = compararCarteira(linhas12, cadastro, p);
    const rent = consolidarMestre(linhas12, inicio12, p);
    const grupos = concentracaoPorGrupo(mestre);
    const indiceHHI = hhi(grupos.map((g) => g.share));
    const hhiClasse = classificarHHI(indiceHHI);
    const politica = avaliarPolitica(mestre);
    const regra = (id: string) => politica.find((r) => r.id === id)!;
    const liquidez = regra("liquidez");
    const exterior = regra("exterior");
    const credito = regra("credito");
    const controladora = mestre.filter((c) => c.empresa === "1000");
    const vencimentos = mestre
      .filter((c) => c.prazoRemanescente !== null && c.prazoRemanescente <= 90)
      .sort((a, b) => a.prazoRemanescente! - b.prazoRemanescente!);
    const porTipo = TIPOS_CONTRATO.map((t) => {
      const cs = mestre.filter((c) => c.tipo === t.tipo);
      return { ...t, qtd: cs.length, saldo: somaMestre(cs, "saldoCurva") };
    });
    const doTipo = (tipo: TipoContrato) => mestre.filter((c) => c.tipo === tipo);

    // R08 – títulos públicos (saldo a mercado e MTM)
    const titulos = doTipo("Tesouro Direto");
    const r08 = { qtd: titulos.length, mercado: somaMestre(titulos, "saldoMercado"), mtm: somaMestre(titulos, "mtm") };

    // R10 – time deposits (saldo em R$ pela PTAX da data-base e variação cambial do mês)
    const tds = TIME_DEPOSITS.map((td) => posicaoTimeDeposit(td, p.dataBase, p)).filter((x) => x.ativo);
    const r10 = {
      qtd: tds.length,
      moedas: [...new Set(tds.map((x) => x.td.moeda))].join("/"),
      saldo: somaMestre(doTipo("Time deposit"), "saldoCurva"),
      variacaoMes: tds.reduce((s, x) => s + x.variacaoCambialMes, 0),
    };

    // R09 – fundos (saldo em cotas, come-cotas recolhidos e o próximo, estimado com o último dado disponível)
    const fundos = FUNDOS.map((f) => ({ f, pos: posicaoFundo(f, p.dataBase, p), hist: historicoFundo(f, p) })).filter((x) => x.pos.ativo);
    const proximoCC = fundos.map((x) => x.pos.proximoComeCotas).filter((x): x is string => !!x).sort()[0] ?? null;
    // IR recolhido em cada come-cotas até a data-base (inclusive de fundos já resgatados) + o próximo, projetado
    const eventosCC = new Map<string, number>();
    for (const f of FUNDOS)
      for (const e of historicoFundo(f, p).comeCotas) if (e.data <= p.dataBase) eventosCC.set(e.data, (eventosCC.get(e.data) ?? 0) + e.ir);
    let irProximoCC = 0;
    for (const x of fundos) irProximoCC += x.hist.comeCotas.find((e) => e.data === proximoCC)?.ir ?? 0;
    const serieCC = [
      ...[...eventosCC.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-3).map(([data, ir]) => ({ data, ir, projetado: false })),
      ...(proximoCC ? [{ data: proximoCC, ir: irProximoCC, projetado: true }] : []),
    ];
    const r09 = {
      qtd: fundos.length,
      saldo: somaMestre(doTipo("Fundo de investimento"), "saldoCurva"),
      proximoCC,
      irProximoCC,
      serieCC,
    };

    // R11 – exposição cambial (time deposits + fundo cambial) × limite da política
    const r11 = exterior;

    // Painel de KPIs – regras simples com meta explícita (mesmas bases do painel)
    const difCDI = bmk.realizado - bmk.pct;
    const piorGrupo = grupos.reduce<Semaforo>((pior, g) => (NIVEL[g.status] > NIVEL[pior] ? g.status : pior), "ok");
    const kpis: { id: string; rotulo: string; status: Semaforo }[] = [
      { id: "cdi", rotulo: "% CDI 12m", status: difCDI >= -TOLERANCIA_BENCHMARK ? "ok" : difCDI >= -0.02 ? "atencao" : "excedido" },
      { id: "liquidez", rotulo: "Liquidez", status: liquidez.status },
      { id: "hhi", rotulo: "HHI", status: hhiClasse.status },
      { id: "cambio", rotulo: "Câmbio", status: exterior.status },
      { id: "credito", rotulo: "Crédito", status: credito.status },
      { id: "grupo", rotulo: "Grupos", status: piorGrupo },
    ];

    // R12 – roll-forward do mês da data-base: SF = SI + aplicações + rendimentos − resgates brutos − come-cotas
    const mov = movimentacaoMestre(previousMonthEnd(p.dataBase), p.dataBase, p).total;
    const r12 = {
      mov,
      diferenca: mov.saldoInicial + mov.aplicacoes + mov.rendimentos - mov.resgatesBrutos - mov.comeCotas - mov.saldoFinal,
      diferencaMestre: mov.saldoFinal - total,
    };

    // Covenants contratuais da dívida: mesma apuração da carteira de captações
    const covenants = apurarCovenants(p.dataBase);
    return {
      pos,
      totalRF,
      rentRF,
      bmkRF,
      mestre,
      total,
      contabil,
      evol,
      rend12,
      bmk,
      rent,
      grupos,
      indiceHHI,
      hhiClasse,
      politica,
      liquidez,
      aguardar,
      iof,
      covenants,
      controladora: somaMestre(controladora, "saldoCurva"),
      controladoraContabil: somaMestre(controladora, "valorContabil"),
      vencimentos,
      porTipo,
      r08,
      r09,
      r10,
      r11,
      kpis,
      r12,
    };
  }, [p, cadastro]);

  const limitesAlerta = d.grupos.filter((g) => g.status !== "ok").length + d.politica.filter((r) => r.status !== "ok").length;
  const covDescumpridos = d.covenants.filter((c) => c.status === "excedido");
  const covSemWaiver = covDescumpridos.filter((c) => c.reclassifica).length;
  const covAtencao = d.covenants.filter((c) => c.status === "atencao").length;
  const dlEbitda = d.covenants.find((c) => c.cov.id === "dlEbitda");
  const rotuloDl = dlEbitda ? rotuloCovenant(dlEbitda) : null;
  // Rodapé curto (cabe no tile 1×1)
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const rodapeCov: { texto: string; state: ValueState } = covSemWaiver
    ? { texto: plural(covSemWaiver, "covenant descumprido", "descumpridos"), state: "negative" }
    : covDescumpridos.length
      ? { texto: plural(covDescumpridos.length, "covenant c/ waiver", "c/ waiver"), state: "critical" }
      : covAtencao
        ? { texto: plural(covAtencao, "em atenção", "em atenção"), state: "critical" }
        : { texto: "Covenants cumpridos", state: "positive" };

  const kpisNaMeta = d.kpis.filter((k) => k.status === "ok").length;
  const kpisAtencao = d.kpis.filter((k) => k.status === "atencao").length;
  const kpisFora = d.kpis.filter((k) => k.status === "excedido").length;
  const mesBase = fmtMonthShort(p.dataBase);
  const r12Fechado = Math.abs(d.r12.diferenca) < 0.005 && Math.abs(d.r12.diferencaMestre) < 0.005;
  const sinal = (v: number) => (v > 0.5 ? "+" : "");

  const tiles: Record<string, Parameters<typeof GenericTile>[0]> = {
    premissas: {
      title: "Premissas",
      subtitle: "Importadas do SAP",
      value: fmtDec(p.cdi * 100, 2),
      unit: `CDI % a.a. · IPCA ${fmtPct(p.ipca12m)}`,
      footer: `USD ${fmtDec(p.ptaxUSD, 4)} · EUR ${fmtDec(p.ptaxEUR, 4)}`,
    },
    benchmark: {
      title: "Benchmark de rentabilidade",
      subtitle: "BMK · % do CDI",
      value: fmtDec(d.bmk.pct * 100, 1),
      unit: "% do CDI (carteira)",
      footer: `Realizado 12m: ${fmtDec(d.bmk.realizado * 100, 1)}%`,
      footerState: SITUACAO_STATE[d.bmk.situacao],
    },
    mestre: {
      title: "Carteira-Mestre",
      subtitle: "Base consolidada de contratos",
      value: fmtMi(d.total),
      unit: `R$ milhões (saldo bruto) · ${d.mestre.length} contratos`,
      footer: d.porTipo.map((t) => plural(t.qtd, ...ROTULO_TIPO[t.tipo])).join(" · "),
      wide: true,
      chart: <MiniBarrasTipo dados={d.porTipo} />,
    },
    r01: {
      title: "Composição Detalhada",
      subtitle: "R01 · Renda fixa bancária",
      value: fmtMi(d.totalRF),
      unit: "R$ milhões (saldo bruto)",
      footer: `${d.pos.length} operações ativas`,
    },
    r08: {
      title: "Tesouro Direto",
      subtitle: `R08 · ${plural(d.r08.qtd, "título público", "títulos públicos")}`,
      value: fmtMi(d.r08.mercado),
      unit: "R$ milhões a mercado",
      footer: `MTM ${sinal(d.r08.mtm)}${fmtCompact(d.r08.mtm)}`,
      footerState: d.r08.mtm >= 0 ? "positive" : "negative",
    },
    r10: {
      title: "Time Deposits",
      subtitle: `R10 · ${plural(d.r10.qtd, "TD", "TDs")}${d.r10.moedas ? ` · ${d.r10.moedas}` : ""}`,
      value: fmtMi(d.r10.saldo),
      unit: "R$ milhões (ME × PTAX)",
      footer: `Câmbio mês ${sinal(d.r10.variacaoMes)}${fmtCompact(d.r10.variacaoMes)}`,
      footerState: Math.abs(d.r10.variacaoMes) < 0.5 ? undefined : d.r10.variacaoMes > 0 ? "positive" : "negative",
    },
    r11: {
      title: "Moeda × Tipo de Contrato",
      subtitle: "R11 · Exposição cambial",
      value: fmtDec(d.r11.share * 100, 1),
      unit: `% da carteira · limite ${fmtPct(d.r11.limite, 0)}`,
      state: semaforoState(d.r11.status),
      footer:
        d.r11.status === "ok"
          ? "Dentro do limite"
          : d.r11.status === "atencao"
            ? `Atenção: ${fmtPct(d.r11.share / d.r11.limite, 0)} do limite`
            : "Acima do limite",
      footerState: semaforoState(d.r11.status),
    },
    r07: {
      title: "Concentração da Carteira",
      subtitle: "R07 · Índice HHI",
      value: fmtInt(d.indiceHHI),
      unit: d.hhiClasse.rotulo,
      state: semaforoState(d.hhiClasse.status),
      footer: limitesAlerta ? `${limitesAlerta} limite(s) em atenção` : "Carteira enquadrada",
      footerState: limitesAlerta ? "critical" : "positive",
    },
    r05: {
      title: "Evolução Mensal",
      subtitle: "R05 · Carteira consolidada, 12 meses",
      value: fmtDec(d.bmk.realizado * 100, 1),
      unit: "% do CDI bruto (12 meses)",
      footer: `Rendimentos 12m: ${fmtCompact(d.rend12)}`,
      wide: true,
      chart: (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={d.evol.map((m) => ({ v: m.saldoFinal }))} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#049f9a" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#049f9a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Area type="monotone" dataKey="v" stroke="#049f9a" strokeWidth={2} fill="url(#spark)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      ),
    },
    r03: {
      title: "Rentabilidade Realizada e Real",
      subtitle: "R03 · Renda fixa bancária",
      value: fmtDec(d.rentRF.pctCDIBruto * 100, 1),
      unit: "% do CDI bruto 12m",
      footer: `Benchmark ${fmtDec(d.bmkRF.pct * 100, 1)}%`,
      footerState: SITUACAO_STATE[d.bmkRF.situacao],
      state: d.bmkRF.situacao === "abaixo" ? "critical" : d.bmkRF.situacao === "acima" ? "positive" : "neutral",
    },
    r04: {
      title: "Eficiência Fiscal por Prazo",
      subtitle: "R04 · Renda fixa bancária",
      value: String(d.aguardar.length + d.iof.length),
      unit: "operações em janela fiscal",
      state: d.aguardar.length + d.iof.length ? "critical" : "positive",
      footer: `Economia: ${fmtCompact(d.aguardar.reduce((s, a) => s + a.economiaIR, 0))}`,
    },
    r09: {
      title: "Fundos e Come-cotas",
      subtitle: `R09 · ${plural(d.r09.qtd, "fundo", "fundos")} · come-cotas mai/nov`,
      value: fmtMi(d.r09.saldo),
      unit: "R$ milhões em cotas",
      footer: d.r09.proximoCC
        ? `Próximo: ${fmtDate(d.r09.proximoCC)} · IR estimado ${fmtCompact(d.r09.irProximoCC)}`
        : "Sem come-cotas previsto",
      footerState: d.r09.proximoCC ? "information" : undefined,
      wide: true,
      chart: <MiniComeCotas dados={d.r09.serieCC} />,
    },
    kpis: {
      title: "Painel de KPIs",
      subtitle: "Carteira consolidada · metas da política",
      value: `${kpisNaMeta}/${d.kpis.length}`,
      unit: "KPIs na meta",
      state: kpisFora ? "negative" : kpisAtencao ? "critical" : "positive",
      footer: kpisFora || kpisAtencao ? [kpisAtencao && `${kpisAtencao} em atenção`, kpisFora && `${kpisFora} fora da meta`].filter(Boolean).join(" · ") : "Todos os KPIs na meta",
      footerState: kpisFora ? "negative" : kpisAtencao ? "critical" : "positive",
      wide: true,
      chart: <MiniScorecard kpis={d.kpis} />,
    },
    r06: {
      title: "Endividamento × Aplicações",
      subtitle: "R06 · DL / EBITDA",
      value: dlEbitda ? fmtDec(dlEbitda.valor, 2) : "—",
      unit: dlEbitda ? `x (covenant ${fmtLimiteCovenant(dlEbitda.cov)})` : "",
      state: rotuloDl?.state ?? "neutral",
      footer: rodapeCov.texto,
      footerState: rodapeCov.state,
    },
    r12: {
      title: "Conciliação de Fim de Mês",
      subtitle: `R12 · Roll-forward de ${mesBase} · DU−1 a DU+3`,
      value: fmtDec(Math.abs(d.r12.diferenca) < 0.005 ? 0 : d.r12.diferenca, 2),
      unit: "R$ de diferença no mês",
      state: r12Fechado ? "positive" : "negative",
      footer: r12Fechado
        ? `Saldo final ${fmtCompact(d.r12.mov.saldoFinal)} = Carteira-Mestre`
        : `Diferença × Carteira-Mestre: ${fmtCompact(d.r12.diferencaMestre)}`,
      footerState: r12Fechado ? "positive" : "negative",
      wide: true,
      chart: <MiniRollForward mov={d.r12.mov} />,
    },
    r02: {
      title: "Movimentação – Nota Explicativa",
      subtitle: "R02 · CPC 40 / CVM 475",
      value: fmtMi(d.contabil),
      unit: "R$ milhões (contábil)",
      footer: `Controladora: ${fmtCompact(d.controladoraContabil)}`,
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
  const filtra = (r: Relatorio) =>
    !termo || [r.titulo, r.descricao, r.codigo, r.publico, r.aba].some((t) => t.toLowerCase().includes(termo));
  const visiveis = RELATORIOS.filter(filtra);

  const abrir = (r: Relatorio) => navigate(r.rota);

  return (
    <div className="min-h-screen flex flex-col horizon-backdrop">
      <ShellBar search={{ value: busca, onChange: setBusca }} />

      <main className="flex-1 max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Cabeçalho da página */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-6">
          <div>
            <p className="text-sm text-label first-letter:uppercase">
              {agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
            <h1 className="text-2xl sm:text-[1.75rem] font-bold text-text leading-tight mt-0.5">{saudacao(agora)}!</h1>
            <p className="text-base text-label mt-1">
              Reporting Pack de Aplicações Financeiras · SAP S/4HANA Treasury and Risk Management
            </p>
          </div>
          <div className="flex items-stretch gap-4 sm:gap-6 bg-white/70 backdrop-blur rounded-2xl shadow-fiori px-5 py-3">
            <QuickStat label="Carteira consolidada" value={fmtCompact(d.total)} />
            <div className="w-px bg-line-soft" />
            <QuickStat
              label="Liquidez imediata"
              value={fmtCompact(d.liquidez.valor)}
              title={`${fmtPct(d.liquidez.share, 1)} da carteira · mínimo da política ${fmtPct(d.liquidez.limite, 0)}`}
            />
            <div className="w-px bg-line-soft hidden sm:block" />
            <QuickStat label="Data-base" value={fmtDate(p.dataBase)} className="hidden sm:block" />
          </div>
        </div>

        <MessageStrip design="critical" className="mb-2">
          <strong>{AVISO_DADOS}</strong>
        </MessageStrip>
        <p className="text-xs text-label mb-7 px-1">
          Premissas gerais importadas do {IMPORTACAO_SAP.sistema} em{" "}
          {new Date(IMPORTACAO_SAP.ultimaImportacao).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · último dado
          disponível {fmtDate(ultimoDadoNaDataBase(p.dataBase))} ·{" "}
          <button className="text-link font-semibold hover:underline" onClick={() => navigate("/premissas")}>
            ver premissas
          </button>{" "}
          · altere a data-base no topo da página para rever o fechamento de meses anteriores.
        </p>

        {/* Visão geral */}
        {!termo && (
          <section className="mb-8">
            <SectionTitle>Visão geral</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              <KpiCard
                label="Carteira consolidada"
                value={fmtCompact(d.total)}
                sub={`${d.mestre.length} contratos · saldo bruto`}
              />
              <KpiCard label="Rendimentos 12m" value={fmtCompact(d.rend12)} sub="Bruto, antes de IR, IOF e taxas" color="#256f3a" />
              <KpiCard
                label="% CDI bruto 12m"
                value={`${fmtDec(d.bmk.realizado * 100, 1)}%`}
                sub={`Benchmark ${fmtDec(d.bmk.pct * 100, 1)}% · líquido ${fmtDec(d.rent.pctCDILiquido * 100, 1)}%`}
                color={d.bmk.situacao === "abaixo" ? "#b44f00" : d.bmk.situacao === "acima" ? "#256f3a" : undefined}
              />
              <KpiCard label="Rentabilidade real 12m" value={fmtPct(d.rent.rentabReal)} sub={`Líquida · IPCA 12m ${fmtPct(p.ipca12m)}`} color="#049f9a" />
              <KpiCard
                label="Índice HHI"
                value={fmtInt(d.indiceHHI)}
                sub={d.hhiClasse.rotulo}
                color={d.hhiClasse.status === "ok" ? "#256f3a" : "#b44f00"}
              />
              <KpiCard
                label="DL / EBITDA"
                value={dlEbitda ? fmtX(dlEbitda.valor) : "—"}
                sub={dlEbitda ? `Covenant ${fmtLimiteCovenant(dlEbitda.cov)} · ${rotuloApuracao(dlEbitda)}` : ""}
                color={rotuloDl ? COR_ESTADO[rotuloDl.state] : undefined}
              />
            </div>
          </section>
        )}

        {/* Aplicativos agrupados pelas seções do Índice */}
        <div className="flex flex-wrap gap-x-10 gap-y-7 mb-8">
          {SECOES.map((s) => {
            const rels = visiveis.filter((r) => r.secao === s.id);
            if (!rels.length) return null;
            return (
              <section key={s.id} className="min-w-0 w-full sm:w-auto">
                <h2 className="text-base font-bold text-text mb-3 whitespace-nowrap">
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
            <SectionTitle
              extra={
                <span className="text-xs text-label whitespace-nowrap">
                  {alertas.length} alerta(s) na data-base
                </span>
              }
            >
              Informações e alertas
            </SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {/* Vencimentos */}
              <Card
                title="Próximos vencimentos"
                subtitle={`Contratos da Carteira-Mestre que vencem em até 90 dias${d.vencimentos.length > 5 ? ` (5 de ${d.vencimentos.length})` : ""}`}
                icon={<CalendarClock className="w-5 h-5 text-brand" />}
                actions={<VerMais onClick={() => navigate("/carteira-mestre")} />}
              >
                {d.vencimentos.length === 0 ? (
                  <Vazio texto="Nenhum vencimento nos próximos 90 dias" />
                ) : (
                  <ul className="divide-y divide-line-soft -mx-1">
                    {d.vencimentos.slice(0, 5).map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-3 px-1 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-text truncate" title={`${v.produto} · ${v.contraparte}`}>
                            {v.produto}
                            {v.moeda !== "BRL" ? ` ${v.moeda}` : ""} · {v.contraparte}
                          </div>
                          <div className="text-xs text-label">
                            {fmtDate(v.vencimento)} · {fmtCompact(v.saldoCurva)}
                            {v.moeda !== "BRL" ? ` (${v.moeda} ${fmtDec(v.saldoME / 1000, 0)} mil)` : ""}
                          </div>
                        </div>
                        <ObjectStatus inverted icon={false} state={v.prazoRemanescente! <= 30 ? "critical" : "information"}>
                          {v.prazoRemanescente} dias
                        </ObjectStatus>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Enquadramento */}
              <Card
                title="Enquadramento na política"
                subtitle="Limites por grupo econômico (R07)"
                icon={<ShieldCheck className="w-5 h-5 text-[#8b47d7]" />}
                actions={<VerMais onClick={() => navigate("/r07-concentracao")} />}
              >
                <ul className="space-y-2.5">
                  {d.grupos.slice(0, 5).map((g) => (
                    <li key={g.grupo}>
                      <div className="flex items-center justify-between text-[13px] mb-1">
                        <span className="text-text font-semibold truncate">{g.grupo}</span>
                        <span className="tabular text-label">
                          {fmtPct(g.share, 1)} / {fmtPct(g.limite, 0)}
                        </span>
                      </div>
                      <MicroBar
                        value={g.utilizacao}
                        max={1.2}
                        marker={1}
                        color={g.status === "ok" ? "#30914c" : g.status === "atencao" ? "#e26300" : "#f53232"}
                      />
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Janela fiscal */}
              <Card
                title="Janela fiscal"
                subtitle="Renda fixa bancária · IOF e faixa do IR (R04)"
                icon={<Hourglass className="w-5 h-5 text-[#c87b00]" />}
                actions={<VerMais onClick={() => navigate("/r04-prazo-fiscal")} />}
              >
                {d.iof.length + d.aguardar.length === 0 ? (
                  <Vazio texto="Nenhuma operação em janela fiscal" />
                ) : (
                  <ul className="divide-y divide-line-soft -mx-1">
                    {[...d.iof, ...d.aguardar].slice(0, 5).map((a) => (
                      <li key={a.pos.op.transacao} className="flex items-center justify-between gap-3 px-1 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-text truncate">
                            {a.pos.op.produto} · {a.pos.op.contraparte}
                          </div>
                          <div className="text-xs text-label">
                            {a.recomendacao === "Evitar resgate (IOF)"
                              ? `IOF ${fmtPct(a.pos.aliqIOF, 0)} · ${a.pos.diasCorridos} dias`
                              : `IR ${fmtPct(a.pos.aliqIR, 1)} → ${fmtPct(a.proxima!.aliquota, 1)} em ${a.diasAteProxima}d`}
                          </div>
                        </div>
                        <ObjectStatus
                          inverted
                          icon={false}
                          state={a.recomendacao === "Evitar resgate (IOF)" ? "critical" : "information"}
                        >
                          {a.recomendacao === "Evitar resgate (IOF)" ? "IOF" : "Aguardar"}
                        </ObjectStatus>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Covenants contratuais da dívida */}
              <Card
                title="Covenants contratuais"
                subtitle={`Última apuração até ${fmtDate(p.dataBase)} (R06)`}
                icon={<Scale className="w-5 h-5 text-[#df1278]" />}
                actions={<VerMais onClick={() => navigate("/r06-indicadores")} />}
              >
                <ul className="divide-y divide-line-soft -mx-1">
                  {d.covenants.map((c) => {
                    const r = rotuloCovenant(c);
                    return (
                      <li key={c.cov.id} className="flex items-center justify-between gap-3 px-1 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-text truncate" title={c.cov.indicador}>
                            {c.cov.indicador}
                          </div>
                          <div className="text-xs text-label">
                            {fmtLimiteCovenant(c.cov)} · {rotuloApuracao(c)} · {r.texto}
                          </div>
                        </div>
                        <ObjectStatus state={r.state}>{fmtValorCovenant(c.cov, c.valor)}</ObjectStatus>
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

            {/* Sobre a planilha */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Destaque
                icon={<Landmark className="w-5 h-5 text-brand" />}
                titulo="Fonte: SAP S/4HANA TRM"
                texto="Posições, fluxos e condições lidos das CDS Views do SAP (IFINTRAN, IFINTRSMANAGE, IFINTRANSCNDN); PTAX, taxas ANBIMA e cotas importadas como dados de mercado."
              />
              <Destaque
                icon={<CheckCircle2 className="w-5 h-5 text-positive" />}
                titulo="Conciliação automática"
                texto="A Carteira-Mestre consolida R01, R08, R09 e R10; o saldo final do R05 e do R02 bate com ela, e o R12 fecha o roll-forward e o razão (FI-GL) no fim do mês."
              />
              <Destaque
                icon={<ShieldCheck className="w-5 h-5 text-[#8b47d7]" />}
                titulo="Normas contábeis"
                texto="CPC 48 (custo amortizado × valor justo), CPC 02 (variação cambial), nota CPC 40 / CVM 475, IRRF (Lei 11.033), IOF (Dec. 6.306) e come-cotas (Lei 14.754)."
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

function QuickStat({ label, value, className, title }: { label: string; value: string; className?: string; title?: string }) {
  return (
    <div className={className} title={title}>
      <div className="text-xs text-label whitespace-nowrap">{label}</div>
      <div className="text-lg font-bold text-text tabular whitespace-nowrap">{value}</div>
    </div>
  );
}

const COR_ESTADO: Record<ValueState, string> = {
  positive: "#256f3a",
  critical: "#b44f00",
  negative: "#aa0808",
  information: "#0070f2",
  neutral: "#1d2d3e",
};

function KpiCard({ label, value, sub, color = "#1d2d3e" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 min-w-0">
      <div className="text-[13px] text-label leading-snug">{label}</div>
      <div className="text-xl font-bold tabular truncate mt-0.5" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-xs text-label leading-snug mt-0.5">{sub}</div>}
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

function Destaque({ icon, titulo, texto }: { icon: React.ReactNode; titulo: string; texto: string }) {
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

// ---------------------------------------------------------------------------
// Micrográficos dos tiles 2×1
// ---------------------------------------------------------------------------

/** Saldo por tipo de contrato (cores de TIPOS_CONTRATO) */
function MiniBarrasTipo({ dados }: { dados: { tipo: string; curto: string; cor: string; saldo: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={dados} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={6}>
        <XAxis dataKey="curto" hide />
        <YAxis hide domain={[0, "dataMax"]} />
        <Bar dataKey="saldo" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {dados.map((x) => (
            <Cell key={x.tipo} fill={x.cor} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** IR recolhido nos últimos come-cotas (mai/nov) e o próximo, projetado com o último dado disponível (claro) */
function MiniComeCotas({ dados }: { dados: { data: string; ir: number; projetado: boolean }[] }) {
  const linhas = dados.map((x) => ({ ...x, rotulo: fmtMonthShort(x.data) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={linhas} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={8}>
        <XAxis dataKey="rotulo" tick={{ fontSize: 9, fill: "#556b82" }} tickLine={false} axisLine={false} interval={0} height={14} />
        <YAxis hide domain={[0, "dataMax"]} />
        <Bar dataKey="ir" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {linhas.map((x) => (
            <Cell key={x.data} fill="#8b47d7" fillOpacity={x.projetado ? 0.35 : 1} stroke={x.projetado ? "#8b47d7" : undefined} strokeDasharray={x.projetado ? "3 2" : undefined} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Status de cada KPI (na meta / atenção / fora) em forma de placar */
function MiniScorecard({ kpis }: { kpis: { id: string; rotulo: string; status: Semaforo }[] }) {
  return (
    <div className="h-full grid grid-cols-2 gap-x-2 gap-y-1 content-center">
      {kpis.map((k) => (
        <div key={k.id} className="flex items-center gap-1.5 min-w-0" title={`${k.rotulo}: ${k.status === "ok" ? "na meta" : k.status === "atencao" ? "atenção" : "fora da meta"}`}>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COR_SEMAFORO[k.status] }} />
          <span className="text-[11px] leading-4 text-label truncate">{k.rotulo}</span>
        </div>
      ))}
    </div>
  );
}

/** Cascata do roll-forward do mês: saldo inicial → aplicações → rendimentos → resgates e come-cotas → saldo final */
function MiniRollForward({ mov }: { mov: { saldoInicial: number; aplicacoes: number; rendimentos: number; resgatesBrutos: number; comeCotas: number; saldoFinal: number } }) {
  const a = mov.saldoInicial;
  const b = a + mov.aplicacoes;
  const c = b + mov.rendimentos;
  const e = c - mov.resgatesBrutos - mov.comeCotas;
  const dados = [
    { n: "SI", v: [0, a], cor: "#556b82" },
    { n: "Apl", v: [a, b], cor: "#0070f2" },
    { n: "Rend", v: [b, c], cor: "#30914c" },
    { n: "Resg", v: [e, c], cor: "#e26300" },
    { n: "SF", v: [0, mov.saldoFinal], cor: "#1d2d3e" },
  ];
  const lo = Math.min(a, e, mov.saldoFinal);
  const hi = Math.max(a, b, c, mov.saldoFinal);
  const folga = (hi - lo) * 0.25 || hi * 0.02;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={dados} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={4}>
        <XAxis dataKey="n" tick={{ fontSize: 9, fill: "#556b82" }} tickLine={false} axisLine={false} interval={0} height={14} />
        <YAxis hide domain={[Math.max(0, lo - folga), hi]} allowDataOverflow />
        <Bar dataKey="v" radius={2} isAnimationActive={false}>
          {dados.map((x) => (
            <Cell key={x.n} fill={x.cor} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
