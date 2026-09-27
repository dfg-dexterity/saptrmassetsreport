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
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Card, SectionTitle } from "../../shared/components/fiori/Card";
import { GenericTile } from "../../shared/components/fiori/GenericTile";
import { MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, semaforoState, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ShellBar } from "../../shared/components/shell/ShellBar";
import { RELATORIOS, SECOES, type Relatorio } from "../data/catalogo";
import { EMPRESAS, OPERACOES } from "../data/carteira";
import cdsResumo from "../../shared/data/cdsResumo";
import { useAlertas } from "../context/useDados";
import { contratosMestre } from "../lib/carteiraMestre";
import { useBenchmarks } from "../context/BenchmarkContext";
import { AVISO_DADOS, IMPORTACAO_SAP, ultimoDadoNaDataBase } from "../../shared/data/mercado";
import { compararCarteira, SITUACAO_STATE } from "../lib/benchmark";
import { usePremissas } from "../../shared/context/MercadoContext";
import { fmtDate, lastMonthEnds } from "../../shared/lib/dates";
import { analiseFiscal, consolidarRentabilidade, evolucaoMensal, posicoesEm, rentabilidade } from "../lib/finance";
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
} from "../lib/indicadores";

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
    const pos = posicoesEm(OPERACOES, p.dataBase, p);
    const total = totalCarteira(pos);
    const meses = lastMonthEnds(p.dataBase, 13);
    const evol = evolucaoMensal(OPERACOES, meses.slice(1), p);
    const linhasRent = rentabilidade(OPERACOES, meses[0], p.dataBase, p);
    const rent = consolidarRentabilidade(linhasRent, meses[0], p.dataBase, p);
    const bmk = compararCarteira(linhasRent, cadastro, p);
    const mestre = contratosMestre(p.dataBase, p);
    const grupos = concentracaoPorGrupo(mestre);
    const indiceHHI = hhi(grupos.map((g) => g.share));
    const politica = avaliarPolitica(mestre);
    const fiscal = pos.map((x) => analiseFiscal(x, p));
    const aguardar = fiscal.filter((f) => f.recomendacao === "Aguardar próxima faixa");
    const iof = fiscal.filter((f) => f.recomendacao === "Evitar resgate (IOF)");
    // Covenants contratuais da dívida: mesma apuração da carteira de captações
    const covenants = apurarCovenants(p.dataBase);
    const controladora = pos.filter((x) => x.op.empresa === "1000").reduce((s, x) => s + x.valorBruto, 0);
    const vencimentos = pos
      .filter((x) => x.prazoRemanescente !== null && x.prazoRemanescente <= 90)
      .sort((a, b) => a.prazoRemanescente! - b.prazoRemanescente!);
    const liquido = pos.reduce((s, x) => s + x.valorLiquido, 0);
    const rend12 = evol.reduce((s, m) => s + m.rendimentos, 0);
    return {
      pos,
      total,
      liquido,
      evol,
      rent,
      rend12,
      bmk,
      grupos,
      indiceHHI,
      hhiClasse: classificarHHI(indiceHHI),
      politica,
      aguardar,
      iof,
      covenants,
      controladora,
      vencimentos,
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

  const tiles: Record<string, Parameters<typeof GenericTile>[0]> = {
    premissas: {
      title: "Premissas",
      subtitle: "Importadas do SAP",
      value: fmtDec(p.cdi * 100, 2),
      unit: "CDI % a.a.",
      footer: `IPCA ${fmtPct(p.ipca12m)} · Selic ${fmtPct(p.selic)}`,
    },
    benchmark: {
      title: "Benchmark de rentabilidade",
      subtitle: "BMK · % do CDI",
      value: fmtDec(d.bmk.pct * 100, 1),
      unit: "% do CDI (carteira)",
      footer: `Realizado 12m: ${fmtDec(d.bmk.realizado * 100, 1)}%`,
      footerState: SITUACAO_STATE[d.bmk.situacao],
    },
    r01: {
      title: "Composição Detalhada",
      subtitle: "R01 · Por operação",
      value: fmtMi(d.total),
      unit: "R$ milhões (saldo bruto)",
      footer: `${d.pos.length} operações · ${Object.keys(EMPRESAS).length} empresas`,
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
      subtitle: "R05 · Saldo 12 meses",
      value: fmtDec(d.rent.pctCDIBruto * 100, 1),
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
            <Area type="monotone" dataKey="v" stroke="#049f9a" strokeWidth={2} fill="url(#spark)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      ),
    },
    r03: {
      title: "Rentabilidade Realizada e Real",
      subtitle: "R03 · Últimos 12 meses",
      value: fmtDec(d.rent.pctCDIBruto * 100, 1),
      unit: "% do CDI bruto",
      footer: `Benchmark ${fmtDec(d.bmk.pct * 100, 1)}%`,
      footerState: SITUACAO_STATE[d.bmk.situacao],
      state: d.bmk.situacao === "abaixo" ? "critical" : d.bmk.situacao === "acima" ? "positive" : "neutral",
    },
    r04: {
      title: "Eficiência Fiscal por Prazo",
      subtitle: "R04 · Janela de IR/IOF",
      value: String(d.aguardar.length + d.iof.length),
      unit: "operações em janela fiscal",
      state: d.aguardar.length + d.iof.length ? "critical" : "positive",
      footer: `Economia: ${fmtCompact(d.aguardar.reduce((s, a) => s + a.economiaIR, 0))}`,
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
    r02: {
      title: "Movimentação – Nota Explicativa",
      subtitle: "R02 · CPC 40 / CVM 475",
      value: fmtMi(d.total),
      unit: "R$ milhões (consolidado)",
      footer: `Controladora: ${fmtCompact(d.controladora)}`,
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
            <QuickStat label="Saldo líquido" value={fmtCompact(d.liquido)} />
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
              <KpiCard label="Carteira (saldo bruto)" value={fmtCompact(d.total)} sub={`${d.pos.length} operações ativas`} />
              <KpiCard label="Rendimentos 12m" value={fmtCompact(d.rend12)} sub="Bruto, antes de IR/IOF" color="#256f3a" />
              <KpiCard
                label="% CDI bruto 12m"
                value={`${fmtDec(d.rent.pctCDIBruto * 100, 1)}%`}
                sub={`Benchmark ${fmtDec(d.bmk.pct * 100, 1)}% · líquido ${fmtDec(d.rent.pctCDILiquido * 100, 1)}%`}
                color={d.bmk.situacao === "abaixo" ? "#b44f00" : d.bmk.situacao === "acima" ? "#256f3a" : undefined}
              />
              <KpiCard label="Rentabilidade real" value={fmtPct(d.rent.rentabReal)} sub={`IPCA 12m ${fmtPct(p.ipca12m)}`} color="#049f9a" />
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
                subtitle="Operações que vencem em até 90 dias"
                icon={<CalendarClock className="w-5 h-5 text-brand" />}
                actions={<VerMais onClick={() => navigate("/r01-composicao")} />}
              >
                {d.vencimentos.length === 0 ? (
                  <Vazio texto="Nenhum vencimento nos próximos 90 dias" />
                ) : (
                  <ul className="divide-y divide-line-soft -mx-1">
                    {d.vencimentos.slice(0, 5).map((v) => (
                      <li key={v.op.transacao} className="flex items-center justify-between gap-3 px-1 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-text truncate">
                            {v.op.produto} · {v.op.contraparte}
                          </div>
                          <div className="text-xs text-label">
                            {fmtDate(v.op.dataVencimento)} · {fmtCompact(v.valorBruto)}
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
                subtitle="IOF e mudança de faixa do IR (R04)"
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
                texto="Posições, fluxos e condições lidos das CDS Views do SAP (IFINTRAN, IFINTRSMANAGE, IFINTRANSCNDN)."
              />
              <Destaque
                icon={<CheckCircle2 className="w-5 h-5 text-positive" />}
                titulo="Conciliação automática"
                texto="Rendimentos do R03 conciliam com o R05, e o saldo final do R05 com a posição do R01 e com o R02."
              />
              <Destaque
                icon={<ShieldCheck className="w-5 h-5 text-[#8b47d7]" />}
                titulo="Normas contábeis"
                texto="Classificação CPC 48, nota explicativa CPC 40 / CVM 475 e tabelas de IRRF (Lei 11.033) e IOF (Dec. 6.306)."
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

function QuickStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
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
