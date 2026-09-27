import clsx from "clsx";
import { Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "../../shared/components/fiori/Button";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { NumberInput, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { usePremissas } from "../../shared/context/MercadoContext";
import { EMPRESAS } from "../../shared/data/empresas";
import { fmtDate, lastMonthEnds } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";
import { useBenchmarks } from "../context/BenchmarkContext";
import { ESCOPOS_BENCHMARK, PCT_MAXIMO, PCT_MINIMO, type Benchmark, type EscopoBenchmark } from "../data/benchmark";
import { OPERACOES } from "../data/carteira";
import { relatorioPorId } from "../data/catalogo";
import {
  benchmarkDaOperacao,
  compararCarteira,
  compararOperacao,
  SITUACAO_STATE,
  SITUACAO_TEXTO,
  type ComparacaoBenchmark,
} from "../lib/benchmark";
import { ativaEm, rentabilidade, taxaContratada, type RentabOp } from "../lib/finance";

const rel = relatorioPorId("benchmark");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

const PORTFOLIOS = [...new Set(OPERACOES.map((o) => o.portfolio))].sort();
const PRODUTOS = [...new Set(OPERACOES.map((o) => o.produto))].sort();

const ROTULO_ESCOPO: Record<EscopoBenchmark, string> = {
  carteira: "Carteira",
  empresa: "Empresa",
  portfolio: "Portfolio",
  produto: "Produto",
};
const COR_ESCOPO: Record<EscopoBenchmark, string> = {
  carteira: "#556b82",
  empresa: "#0070f2",
  portfolio: "#8b47d7",
  produto: "#049f9a",
};

function opcoesValor(escopo: EscopoBenchmark): { value: string; label: string }[] {
  switch (escopo) {
    case "carteira":
      return [{ value: "", label: "Todas as aplicações" }];
    case "empresa":
      return Object.entries(EMPRESAS).map(([k, e]) => ({ value: k, label: `${k} – ${e.nome}` }));
    case "portfolio":
      return PORTFOLIOS.map((x) => ({ value: x, label: x }));
    case "produto":
      return PRODUTOS.map((x) => ({ value: x, label: x }));
  }
}

function aplicaSeA(b: Benchmark): string {
  if (b.escopo === "carteira") return "Todas as aplicações";
  if (b.escopo === "empresa") return `${b.valor} – ${EMPRESAS[b.valor]?.nome ?? ""}`;
  return b.valor;
}

interface Rascunho {
  id: string | null;
  descricao: string;
  escopo: EscopoBenchmark;
  valor: string;
  pct: number; // em % (102 = 102% do CDI)
  vigenciaInicio: string;
}

type Erros = Partial<Record<"descricao" | "valor" | "pct" | "vigenciaInicio", string>>;

function validar(r: Rascunho, cadastro: Benchmark[]): Erros {
  const e: Erros = {};
  if (r.descricao.trim().length < 3) e.descricao = "Informe uma descrição com pelo menos 3 caracteres.";
  if (r.escopo !== "carteira" && !r.valor) e.valor = "Selecione a que o benchmark se aplica.";
  if (!Number.isFinite(r.pct) || r.pct < PCT_MINIMO * 100 || r.pct > PCT_MAXIMO * 100)
    e.pct = `O benchmark deve estar entre ${fmtDec(PCT_MINIMO * 100, 0)}% e ${fmtDec(PCT_MAXIMO * 100, 0)}% do CDI.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.vigenciaInicio)) e.vigenciaInicio = "Informe a data de início da vigência.";
  const valor = r.escopo === "carteira" ? "" : r.valor;
  const duplicado = cadastro.find((b) => b.id !== r.id && b.escopo === r.escopo && b.valor === valor && b.vigenciaInicio === r.vigenciaInicio);
  if (duplicado && !e.valor && !e.vigenciaInicio) e.vigenciaInicio = `Já existe a regra “${duplicado.descricao}” para este escopo com a mesma vigência.`;
  return e;
}

interface LinhaOp {
  r: RentabOp;
  regra: Benchmark | null;
  cmp: ComparacaoBenchmark;
}

export function BenchmarkApp() {
  const { premissas: p } = usePremissas();
  const { cadastro, salvar, remover, restaurar, alterado } = useBenchmarks();
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);

  const inicio = lastMonthEnds(p.dataBase, 13)[0];
  const rentab = useMemo(() => rentabilidade(OPERACOES, inicio, p.dataBase, p), [inicio, p]);

  const d = useMemo(() => {
    const linhas: LinhaOp[] = rentab.map((r) => ({
      r,
      regra: benchmarkDaOperacao(r.op, cadastro, p.dataBase),
      cmp: compararOperacao(r, cadastro, p.dataBase),
    }));
    const carteira = compararCarteira(rentab, cadastro, p.dataBase);
    const ativas = OPERACOES.filter((o) => ativaEm(o, p.dataBase));
    const cobertura = new Map<string, number>();
    for (const o of ativas) {
      const b = benchmarkDaOperacao(o, cadastro, p.dataBase);
      if (b) cobertura.set(b.id, (cobertura.get(b.id) ?? 0) + 1);
    }
    const porProduto = PRODUTOS.map((produto) => {
      const rs = rentab.filter((r) => r.op.produto === produto);
      const c = compararCarteira(rs, cadastro, p.dataBase);
      return { produto, realizado: c.realizado * 100, benchmark: c.pct * 100, qtd: rs.length };
    })
      .filter((x) => x.qtd > 0)
      .sort((a, b) => b.realizado - a.realizado);
    return { linhas, carteira, cobertura, porProduto, abaixo: linhas.filter((l) => l.cmp.situacao === "abaixo").length };
  }, [rentab, cadastro, p.dataBase]);

  const ordenado = useMemo(
    () =>
      [...cadastro].sort(
        (a, b) =>
          (ESCOPOS_BENCHMARK.find((e) => e.value === a.escopo)?.prioridade ?? 0) -
            (ESCOPOS_BENCHMARK.find((e) => e.value === b.escopo)?.prioridade ?? 0) ||
          a.valor.localeCompare(b.valor) ||
          a.vigenciaInicio.localeCompare(b.vigenciaInicio),
      ),
    [cadastro],
  );

  const novo = () =>
    setRascunho({ id: null, descricao: "", escopo: "produto", valor: PRODUTOS[0], pct: 100, vigenciaInicio: `${p.dataBase.slice(0, 4)}-01-01` });
  const editar = (b: Benchmark) =>
    setRascunho({ id: b.id, descricao: b.descricao, escopo: b.escopo, valor: b.valor, pct: Math.round(b.pctCDI * 10000) / 100, vigenciaInicio: b.vigenciaInicio });

  const excluir = (b: Benchmark) => {
    if (b.escopo === "carteira" && cadastro.filter((x) => x.escopo === "carteira").length === 1) {
      toast.error("A regra da carteira consolidada é obrigatória – edite o percentual em vez de excluí-la.");
      return;
    }
    remover(b.id);
    toast.success(`Benchmark “${b.descricao}” excluído`);
  };

  const confirmar = (r: Rascunho) => {
    const b: Benchmark = {
      id: r.id ?? `bmk-${Date.now().toString(36)}`,
      descricao: r.descricao.trim(),
      escopo: r.escopo,
      valor: r.escopo === "carteira" ? "" : r.valor,
      pctCDI: Math.round(r.pct * 100) / 10000,
      vigenciaInicio: r.vigenciaInicio,
    };
    salvar(b);
    setRascunho(null);
    toast.success(r.id ? `Benchmark “${b.descricao}” atualizado` : `Benchmark “${b.descricao}” cadastrado (${fmtDec(b.pctCDI * 100, 1)}% do CDI)`);
  };

  const exportar = () =>
    exportarExcel(
      `Benchmark_${p.dataBase}.xlsx`,
      [
        {
          nome: "Cadastro",
          titulo: "Cadastro de benchmark – % do CDI",
          subtitulo: "Regra mais específica vence: tipo de produto > portfolio > empresa > carteira",
          colunas: [
            { titulo: "Descrição", largura: 34 },
            { titulo: "Escopo", largura: 20 },
            { titulo: "Aplica-se a", largura: 28 },
            { titulo: "% do CDI", tipo: "decimal" },
            { titulo: "Taxa equivalente (% a.a.)", tipo: "decimal", largura: 18 },
            { titulo: "Vigência desde", tipo: "data" },
            { titulo: "Operações ativas", tipo: "inteiro" },
          ],
          linhas: ordenado.map((b) => [
            b.descricao,
            ESCOPOS_BENCHMARK.find((e) => e.value === b.escopo)?.label ?? b.escopo,
            aplicaSeA(b),
            b.pctCDI * 100,
            b.pctCDI * p.cdi * 100,
            b.vigenciaInicio,
            d.cobertura.get(b.id) ?? 0,
          ]),
        },
        {
          nome: "Realizado x benchmark",
          titulo: "Rentabilidade realizada × benchmark – últimos 12 meses",
          subtitulo: `${fmtDate(inicio)} a ${fmtDate(p.dataBase)}`,
          colunas: [
            { titulo: "Transação", largura: 14 },
            { titulo: "Aplicação", largura: 34 },
            { titulo: "Regra aplicada", largura: 30 },
            { titulo: "Benchmark (% CDI)", tipo: "decimal" },
            { titulo: "Realizado (% CDI)", tipo: "decimal" },
            { titulo: "Rendimento", tipo: "moeda" },
            { titulo: "Rend. do benchmark", tipo: "moeda" },
            { titulo: "Excesso", tipo: "moeda" },
            { titulo: "Situação", largura: 20 },
          ],
          linhas: d.linhas.map((l) => [
            l.r.op.transacao,
            `${l.r.op.produto} · ${l.r.op.contraparte}`,
            l.regra?.descricao ?? "100% do CDI (sem regra)",
            l.cmp.pct * 100,
            l.cmp.realizado * 100,
            l.r.rendimento,
            l.cmp.rendBenchmark,
            l.cmp.excesso,
            SITUACAO_TEXTO[l.cmp.situacao],
          ]),
          total: [
            "TOTAL",
            "",
            "",
            d.carteira.pct * 100,
            d.carteira.realizado * 100,
            d.linhas.reduce((s, l) => s + l.r.rendimento, 0),
            d.carteira.rendBenchmark,
            d.carteira.excesso,
            SITUACAO_TEXTO[d.carteira.situacao],
          ],
        },
      ],
      p.dataBase,
    );

  const colunasCadastro: Column<Benchmark>[] = [
    {
      key: "desc",
      header: "Descrição",
      minWidth: 200,
      value: (b) => b.descricao,
      render: (b) => <span className="font-semibold text-text">{b.descricao}</span>,
    },
    {
      key: "escopo",
      header: "Escopo",
      value: (b) => ESCOPOS_BENCHMARK.find((e) => e.value === b.escopo)?.prioridade ?? 0,
      render: (b) => <Tag color={COR_ESCOPO[b.escopo]}>{ROTULO_ESCOPO[b.escopo]}</Tag>,
    },
    { key: "valor", header: "Aplica-se a", minWidth: 160, value: (b) => aplicaSeA(b) },
    {
      key: "pct",
      header: "% do CDI",
      align: "right",
      value: (b) => b.pctCDI,
      render: (b) => <span className="font-bold tabular">{fmtDec(b.pctCDI * 100, 1)}%</span>,
    },
    {
      key: "taxa",
      header: "Taxa equivalente",
      headerTitle: "Benchmark × CDI vigente na data-base",
      align: "right",
      value: (b) => b.pctCDI * p.cdi,
      render: (b) => `${fmtPct(b.pctCDI * p.cdi)} a.a.`,
    },
    { key: "vig", header: "Vigência desde", align: "right", value: (b) => b.vigenciaInicio, render: (b) => fmtDate(b.vigenciaInicio) },
    {
      key: "ops",
      header: "Operações ativas",
      headerTitle: "Operações ativas na data-base às quais esta regra se aplica",
      align: "right",
      value: (b) => d.cobertura.get(b.id) ?? 0,
      render: (b) => {
        const n = d.cobertura.get(b.id) ?? 0;
        return n ? <span className="tabular">{n}</span> : <span className="text-label">—</span>;
      },
    },
    {
      key: "acoes",
      header: "",
      align: "right",
      render: (b) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="transparent" icon={<Pencil className="w-4 h-4" />} aria-label={`Editar ${b.descricao}`} title="Editar" onClick={() => editar(b)} />
          <Button size="sm" variant="transparent" icon={<Trash2 className="w-4 h-4" />} aria-label={`Excluir ${b.descricao}`} title="Excluir" onClick={() => excluir(b)} />
        </div>
      ),
    },
  ];

  const colunasOps: Column<LinhaOp>[] = [
    {
      key: "op",
      header: "Aplicação",
      sticky: true,
      minWidth: 200,
      value: (l) => l.r.op.contraparte,
      render: (l) => (
        <div>
          <div className="font-semibold text-text">
            {l.r.op.produto} · {l.r.op.contraparte}
          </div>
          <div className="text-xs text-label">
            {l.r.op.transacao} · {taxaContratada(l.r.op)} · {l.r.op.portfolio}
          </div>
        </div>
      ),
      total: () => "Carteira",
    },
    {
      key: "regra",
      header: "Regra aplicada",
      minWidth: 170,
      value: (l) => l.regra?.descricao ?? "",
      render: (l) =>
        l.regra ? (
          <div className="flex items-center gap-1.5">
            <Tag color={COR_ESCOPO[l.regra.escopo]}>{ROTULO_ESCOPO[l.regra.escopo]}</Tag>
            <span className="text-[13px] text-text truncate">{l.regra.descricao}</span>
          </div>
        ) : (
          <span className="text-label">Sem regra (100% do CDI)</span>
        ),
    },
    {
      key: "bmk",
      header: "Benchmark",
      align: "right",
      value: (l) => l.cmp.pct,
      render: (l) => `${fmtDec(l.cmp.pct * 100, 1)}%`,
      total: () => `${fmtDec(d.carteira.pct * 100, 1)}%`,
    },
    {
      key: "real",
      header: "Realizado",
      headerTitle: "% do CDI bruto realizado nos últimos 12 meses",
      align: "right",
      value: (l) => l.cmp.realizado,
      render: (l) => <span className="font-semibold">{fmtDec(l.cmp.realizado * 100, 1)}%</span>,
      total: () => `${fmtDec(d.carteira.realizado * 100, 1)}%`,
    },
    {
      key: "dif",
      header: "Diferença",
      align: "right",
      value: (l) => l.cmp.realizado - l.cmp.pct,
      render: (l) => <Diferenca v={l.cmp.realizado - l.cmp.pct} />,
      total: () => <Diferenca v={d.carteira.realizado - d.carteira.pct} />,
    },
    {
      key: "exc",
      header: "Excesso (R$)",
      headerTitle: "Rendimento realizado − rendimento que o benchmark teria gerado",
      align: "right",
      value: (l) => l.cmp.excesso,
      render: (l) => <span className={l.cmp.excesso >= 0 ? "text-positive" : "text-negative"}>{fmtNum(l.cmp.excesso, { parens: true })}</span>,
      total: () => <span className={d.carteira.excesso >= 0 ? "text-positive" : "text-negative"}>{fmtNum(d.carteira.excesso, { parens: true })}</span>,
    },
    {
      key: "sit",
      header: "Situação",
      value: (l) => l.cmp.situacao,
      render: (l) => <ObjectStatus state={SITUACAO_STATE[l.cmp.situacao]}>{SITUACAO_TEXTO[l.cmp.situacao]}</ObjectStatus>,
      total: () => <ObjectStatus state={SITUACAO_STATE[d.carteira.situacao]}>{SITUACAO_TEXTO[d.carteira.situacao]}</ObjectStatus>,
    },
  ];

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      actions={
        <>
          <Button
            variant="default"
            icon={<RotateCcw className="w-4 h-4" />}
            disabled={!alterado}
            onClick={() => {
              restaurar();
              toast.success("Cadastro de benchmark restaurado para o padrão da demo");
            }}
          >
            <span className="hidden sm:inline">Restaurar padrão</span>
          </Button>
          <Button variant="emphasized" icon={<Plus className="w-4 h-4" />} onClick={novo}>
            <span className="hidden sm:inline">Novo benchmark</span>
          </Button>
        </>
      }
      kpis={
        <>
          <HeaderKpi label="Benchmark da carteira" value={`${fmtDec(d.carteira.pct * 100, 1)}%`} unit="do CDI" sub="Ponderado pelas regras" />
          <HeaderKpi
            label="Realizado 12 meses"
            value={`${fmtDec(d.carteira.realizado * 100, 1)}%`}
            unit="do CDI"
            state={SITUACAO_STATE[d.carteira.situacao]}
            sub={SITUACAO_TEXTO[d.carteira.situacao]}
          />
          <HeaderKpi
            label="Excesso sobre o benchmark"
            value={fmtCompact(d.carteira.excesso)}
            state={d.carteira.excesso >= 0 ? "positive" : "negative"}
            sub="Rendimento 12 meses"
          />
          <HeaderKpi label="Abaixo do benchmark" value={String(d.abaixo)} unit={`de ${d.linhas.length}`} state={d.abaixo ? "critical" : "positive"} sub="Aplicações nos 12 meses" />
        </>
      }
    >
      <MessageStrip>
        Cadastre a taxa de benchmark de cada aplicação como <strong>percentual do CDI</strong>. A regra mais específica
        vence: <strong>tipo de produto › portfolio › empresa › carteira consolidada</strong>; entre regras do mesmo nível,
        vale a de vigência mais recente até a data-base. O benchmark é usado no R01 (composição), R03 (rentabilidade) e R05
        (evolução mensal). Nesta demo o cadastro fica salvo neste navegador.
      </MessageStrip>

      <Card
        title="Regras de benchmark"
        subtitle={`${cadastro.length} regra(s) · CDI vigente ${fmtPct(p.cdi)} a.a. (importado do SAP)`}
        bodyClassName="px-0 pb-0"
        actions={
          <Button size="sm" variant="transparent" icon={<Plus className="w-4 h-4" />} onClick={novo}>
            Adicionar
          </Button>
        }
      >
        <DataTable columns={colunasCadastro} rows={ordenado} rowKey={(b) => b.id} onRowClick={editar} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card className="xl:col-span-3" title="Realizado × benchmark por produto" subtitle={`% do CDI bruto · ${fmtDate(inicio)} a ${fmtDate(p.dataBase)}`}>
          <div className="h-80 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.porProduto} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="produto" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} angle={-35} textAnchor="end" height={78} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={44} domain={[(min: number) => Math.max(0, Math.floor(min / 10) * 10 - 10), "auto"]} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtDec(v, 1)}% do CDI`, n]} />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <Bar dataKey="realizado" name="Realizado" fill="#0070f2" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="benchmark" name="Benchmark" fill="#a8b2bd" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Como o benchmark é aplicado" subtitle="Exemplo com as regras atuais">
          <ol className="space-y-3 text-[13px] text-text">
            {ESCOPOS_BENCHMARK.map((e, i) => {
              const regras = cadastro.filter((b) => b.escopo === e.value);
              return (
                <li key={e.value} className="flex gap-3">
                  <span
                    className="w-6 h-6 shrink-0 rounded-full text-white text-xs font-bold flex items-center justify-center"
                    style={{ backgroundColor: COR_ESCOPO[e.value] }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold">{e.label}</div>
                    <div className="text-label">
                      {regras.length
                        ? regras.map((b) => `${aplicaSeA(b)}: ${fmtDec(b.pctCDI * 100, 1)}%`).join(" · ")
                        : "Nenhuma regra cadastrada neste nível"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-label mt-4 leading-relaxed">
            Excesso = rendimento realizado − (saldo × CDI do período × % do benchmark). A diferença em p.p. compara o % do CDI
            realizado com o benchmark; tolerância de ±0,5 p.p. para “em linha”.
          </p>
        </Card>
      </div>

      <Card
        title="Rentabilidade × benchmark por aplicação"
        subtitle={`Últimos 12 meses (${fmtDate(inicio)} a ${fmtDate(p.dataBase)}) · rendimento total ${fmtBRL(d.linhas.reduce((s, l) => s + l.r.rendimento, 0))}`}
        bodyClassName="px-0 pb-0"
      >
        <DataTable columns={colunasOps} rows={d.linhas} rowKey={(l) => l.r.op.transacao} showTotals maxHeight={520} defaultSort={{ key: "dif", dir: "asc" }} />
      </Card>

      {rascunho && <DialogoBenchmark inicial={rascunho} cadastro={cadastro} cdi={p.cdi} onCancel={() => setRascunho(null)} onConfirm={confirmar} />}
    </ReportPage>
  );
}

function Diferenca({ v }: { v: number }) {
  const pp = Math.round(v * 1000) / 10 || 0;
  return (
    <span className={clsx("tabular", pp > 0.5 ? "text-positive" : pp < -0.5 ? "text-critical-strong" : "text-label")}>
      {pp > 0 ? "+" : ""}
      {fmtDec(pp, 1)} p.p.
    </span>
  );
}

function DialogoBenchmark({
  inicial,
  cadastro,
  cdi,
  onCancel,
  onConfirm,
}: {
  inicial: Rascunho;
  cadastro: Benchmark[];
  cdi: number;
  onCancel: () => void;
  onConfirm: (r: Rascunho) => void;
}) {
  const [r, setR] = useState<Rascunho>(inicial);
  const [tentou, setTentou] = useState(false);
  const erros = validar(r, cadastro);
  const visiveis = tentou ? erros : {};

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const set = (patch: Partial<Rascunho>) => setR((x) => ({ ...x, ...patch }));
  const trocarEscopo = (escopo: EscopoBenchmark) => set({ escopo, valor: opcoesValor(escopo)[0]?.value ?? "" });

  const enviar = () => {
    setTentou(true);
    if (Object.keys(erros).length === 0) onConfirm(r);
  };

  const inputCls = (erro?: string) =>
    clsx(
      "w-full h-9 rounded-[var(--radius-field)] border bg-white px-2.5 text-sm text-text focus:outline-none",
      erro ? "border-negative shadow-[inset_0_-1px_0_var(--color-negative)]" : "border-field focus:border-brand focus:shadow-[inset_0_-1px_0_var(--color-brand)]",
    );

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-[#1d2d3e]/40" onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bmk-titulo"
        className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-fiori-lg overflow-hidden max-h-[92vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-line-soft">
          <h2 id="bmk-titulo" className="text-base font-bold text-text">
            {r.id ? "Editar benchmark" : "Novo benchmark"}
          </h2>
          <button type="button" onClick={onCancel} className="p-1.5 rounded-lg text-link hover:bg-hover" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </header>
        <form
          className="px-5 py-4 space-y-4 overflow-y-auto"
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          <Campo label="Descrição" obrigatorio erro={visiveis.descricao}>
            <input
              autoFocus
              value={r.descricao}
              onChange={(e) => set({ descricao: e.target.value })}
              placeholder="Ex.: CDBs de bancos de primeira linha"
              maxLength={60}
              className={inputCls(visiveis.descricao)}
            />
          </Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo label="Escopo" obrigatorio>
              <Select
                ariaLabel="Escopo"
                value={r.escopo}
                onChange={trocarEscopo}
                options={ESCOPOS_BENCHMARK.map((e) => ({ value: e.value, label: e.label }))}
              />
            </Campo>
            <Campo label="Aplica-se a" obrigatorio={r.escopo !== "carteira"} erro={visiveis.valor}>
              <Select ariaLabel="Aplica-se a" value={r.valor} onChange={(v) => set({ valor: v })} options={opcoesValor(r.escopo)} />
            </Campo>
            <Campo label="Benchmark (% do CDI)" obrigatorio erro={visiveis.pct}>
              <NumberInput ariaLabel="Benchmark em % do CDI" value={r.pct} onChange={(v) => set({ pct: v })} suffix="% CDI" step={0.5} min={PCT_MINIMO * 100} max={PCT_MAXIMO * 100} />
            </Campo>
            <Campo label="Vigência a partir de" obrigatorio erro={visiveis.vigenciaInicio}>
              <input type="date" value={r.vigenciaInicio} onChange={(e) => set({ vigenciaInicio: e.target.value })} className={inputCls(visiveis.vigenciaInicio)} />
            </Campo>
          </div>
          <div className="rounded-lg bg-[#f5f6f7] px-3 py-2.5 text-[13px] text-label">
            Equivale a <strong className="text-text tabular">{Number.isFinite(r.pct) ? fmtPct((r.pct / 100) * cdi) : "—"} a.a.</strong> com o
            CDI vigente de {fmtPct(cdi)} a.a. (importado do SAP). Faixa permitida: {fmtDec(PCT_MINIMO * 100, 0)}% a{" "}
            {fmtDec(PCT_MAXIMO * 100, 0)}% do CDI.
          </div>
          <button type="submit" className="hidden" />
        </form>
        <footer className="flex justify-end gap-2 px-5 py-3 bg-[#f5f6f7] border-t border-line-soft">
          <Button variant="transparent" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="emphasized" onClick={enviar}>
            {r.id ? "Salvar" : "Cadastrar"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Campo({ label, obrigatorio, erro, children }: { label: string; obrigatorio?: boolean; erro?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[13px] text-label">
        {label}
        {obrigatorio && <span className="text-negative ml-0.5">*</span>}
      </span>
      {children}
      {erro && <span className="text-xs text-negative">{erro}</span>}
    </label>
  );
}
