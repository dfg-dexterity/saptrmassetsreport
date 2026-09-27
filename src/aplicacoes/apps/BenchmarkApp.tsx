import clsx from "clsx";
import { Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { addDays, fmtDate, lastMonthEnds } from "../../shared/lib/dates";
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
  corExcesso,
  regraCarteiraVigente,
  SITUACAO_STATE,
  SITUACAO_TEXTO,
  taxaEquivalenteBenchmark,
  type ComparacaoOperacao,
  type TrechoBenchmark,
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

type Erros = Partial<Record<"descricao" | "escopo" | "valor" | "pct" | "vigenciaInicio", string>>;

/** Existe regra da carteira consolidada vigente na data-base? (obrigatória: é a regra padrão de todas as aplicações) */
function temCarteiraVigente(lista: Benchmark[], dataBase: string): boolean {
  return regraCarteiraVigente(lista, dataBase) !== null;
}

function validar(r: Rascunho, cadastro: Benchmark[], dataBase: string): Erros {
  const e: Erros = {};
  if (r.descricao.trim().length < 3) e.descricao = "Informe uma descrição com pelo menos 3 caracteres.";
  if (r.escopo !== "carteira" && !r.valor) e.valor = "Selecione a que o benchmark se aplica.";
  if (!Number.isFinite(r.pct) || r.pct < PCT_MINIMO * 100 || r.pct > PCT_MAXIMO * 100)
    e.pct = `O benchmark deve estar entre ${fmtDec(PCT_MINIMO * 100, 0)}% e ${fmtDec(PCT_MAXIMO * 100, 0)}% do CDI.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.vigenciaInicio)) e.vigenciaInicio = "Informe a data de início da vigência.";
  const valor = r.escopo === "carteira" ? "" : r.valor;
  const duplicado = cadastro.find((b) => b.id !== r.id && b.escopo === r.escopo && b.valor === valor && b.vigenciaInicio === r.vigenciaInicio);
  if (duplicado && !e.valor && !e.vigenciaInicio) e.vigenciaInicio = `Já existe a regra “${duplicado.descricao}” para este escopo com a mesma vigência.`;

  // A carteira consolidada precisa continuar com uma regra vigente na data-base depois da alteração
  const original = r.id ? cadastro.find((b) => b.id === r.id) : undefined;
  const mexeNaCarteira = r.escopo === "carteira" || original?.escopo === "carteira";
  if (mexeNaCarteira && !e.vigenciaInicio && temCarteiraVigente(cadastro, dataBase)) {
    const resultante = [
      ...cadastro.filter((b) => b.id !== r.id),
      { id: r.id ?? "novo", descricao: r.descricao, escopo: r.escopo, valor, pctCDI: r.pct / 100, vigenciaInicio: r.vigenciaInicio },
    ];
    if (!temCarteiraVigente(resultante, dataBase)) {
      if (r.escopo !== "carteira")
        e.escopo = `Esta é a única regra da carteira consolidada vigente em ${fmtDate(dataBase)}. Cadastre outra regra de carteira antes de mudar o escopo.`;
      else
        e.vigenciaInicio = `A carteira consolidada precisa de uma regra vigente na data-base (${fmtDate(dataBase)}): use uma vigência até essa data ou mantenha outra regra de carteira vigente.`;
    }
  }
  return e;
}

/** Chamado pelos botões da linha: não deixa o clique chegar ao onRowClick da tabela (que abre a edição) */
function semPropagar(fn: () => void) {
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
}

interface LinhaOp {
  r: RentabOp;
  /** regra vigente no último dia do período da operação */
  regra: Benchmark | null;
  cmp: ComparacaoOperacao;
}

export function BenchmarkApp() {
  const { premissas: p } = usePremissas();
  const { cadastro, salvar, remover, restaurar, substituir, alterado } = useBenchmarks();
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);

  const inicio = lastMonthEnds(p.dataBase, 13)[0];
  const rentab = useMemo(() => rentabilidade(OPERACOES, inicio, p.dataBase, p), [inicio, p]);

  const d = useMemo(() => {
    const linhas: LinhaOp[] = rentab.map((r) => {
      const cmp = compararOperacao(r, cadastro, p);
      return { r, regra: cmp.trechos[cmp.trechos.length - 1]?.regra ?? null, cmp };
    });
    const carteira = compararCarteira(rentab, cadastro, p);
    const ativas = OPERACOES.filter((o) => ativaEm(o, p.dataBase));
    const cobertura = new Map<string, number>();
    for (const o of ativas) {
      const b = benchmarkDaOperacao(o, cadastro, p.dataBase);
      if (b) cobertura.set(b.id, (cobertura.get(b.id) ?? 0) + 1);
    }
    const porProduto = PRODUTOS.map((produto) => {
      const rs = rentab.filter((r) => r.op.produto === produto);
      const c = compararCarteira(rs, cadastro, p);
      return { produto, realizado: c.realizado * 100, benchmark: c.pct * 100, qtd: rs.length };
    })
      .filter((x) => x.qtd > 0)
      .sort((a, b) => b.realizado - a.realizado);
    return {
      linhas,
      carteira,
      cobertura,
      porProduto,
      abaixo: linhas.filter((l) => l.cmp.situacao === "abaixo").length,
      comVigenciaNoPeriodo: linhas.filter((l) => l.cmp.trechos.length > 1).length,
    };
  }, [rentab, cadastro, p]);

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
    if (b.escopo === "carteira" && temCarteiraVigente(cadastro, p.dataBase) && !temCarteiraVigente(cadastro.filter((x) => x.id !== b.id), p.dataBase)) {
      toast.error(
        `A carteira consolidada precisa de uma regra vigente na data-base (${fmtDate(p.dataBase)}) – edite o percentual ou cadastre outra regra de carteira antes de excluir esta.`,
      );
      return;
    }
    const anterior = cadastro;
    remover(b.id);
    toast.success(`Benchmark “${b.descricao}” excluído`, {
      action: { label: "Desfazer", onClick: () => substituir(anterior) },
    });
  };

  const restaurarPadrao = () => {
    const anterior = cadastro;
    restaurar();
    toast.success("Cadastro de benchmark restaurado para o padrão da demo", {
      action: { label: "Desfazer", onClick: () => substituir(anterior) },
    });
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
            taxaEquivalenteBenchmark(b.pctCDI, p.cdi) * 100,
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
            { titulo: "Regra aplicada (fim do período)", largura: 30 },
            { titulo: "Regra cadastrada (% CDI, média do período)", tipo: "decimal", largura: 18 },
            { titulo: "Benchmark no período (% CDI)", tipo: "decimal", largura: 16 },
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
            l.cmp.pctRegra * 100,
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
            d.carteira.pctRegra * 100,
            d.carteira.pct * 100,
            d.carteira.realizado * 100,
            d.linhas.reduce((s, l) => s + l.r.rendimento, 0),
            d.carteira.rendBenchmark,
            d.carteira.excesso,
            SITUACAO_TEXTO[d.carteira.situacao],
          ],
          notas: [
            "Rendimento do benchmark = capital base × (Π (1 + DI diário × % do CDI da regra vigente no dia) − 1), nos dias úteis em que a aplicação esteve ativa no período; DI diário = (1 + CDI do dia)^(1/252) − 1.",
            "Benchmark no período (% CDI) = rendimento do benchmark ÷ (capital base × CDI do período) – mesma base do realizado; uma aplicação contratada ao mesmo % do CDI fica em linha.",
            "Taxa equivalente = (1 + ((1 + CDI)^(1/252) − 1) × % do CDI)^252 − 1 (capitalização diária).",
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
      headerTitle: "Taxa anual equivalente com o CDI vigente na data-base, capitalizada diariamente: (1 + ((1 + CDI)^(1/252) − 1) × % do CDI)^252 − 1",
      align: "right",
      value: (b) => taxaEquivalenteBenchmark(b.pctCDI, p.cdi),
      render: (b) => `${fmtPct(taxaEquivalenteBenchmark(b.pctCDI, p.cdi))} a.a.`,
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
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="transparent" icon={<Pencil className="w-4 h-4" />} aria-label={`Editar ${b.descricao}`} title="Editar" onClick={semPropagar(() => editar(b))} />
          <Button size="sm" variant="transparent" icon={<Trash2 className="w-4 h-4" />} aria-label={`Excluir ${b.descricao}`} title="Excluir" onClick={semPropagar(() => excluir(b))} />
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
      render: (l) => (
        <div>
          {l.regra ? (
            <div className="flex items-center gap-1.5">
              <Tag color={COR_ESCOPO[l.regra.escopo]}>{ROTULO_ESCOPO[l.regra.escopo]}</Tag>
              <span className="text-[13px] text-text truncate">{l.regra.descricao}</span>
            </div>
          ) : (
            <span className="text-label">Sem regra (100% do CDI)</span>
          )}
          {l.cmp.trechos.length > 1 && <div className="text-xs text-label mt-0.5">{descreverTrechos(l.cmp.trechos)}</div>}
        </div>
      ),
    },
    {
      key: "bmk",
      header: "Benchmark",
      headerTitle: "% do CDI do benchmark no período: rendimento do benchmark (capitalizado dia a dia com a regra vigente em cada dia) ÷ (capital base × CDI do período)",
      align: "right",
      value: (l) => l.cmp.pct,
      render: (l) => (
        <div className="whitespace-nowrap">
          <div>{fmtDec(l.cmp.pct * 100, 1)}%</div>
          <div className="text-xs text-label">regra {fmtDec(l.cmp.pctRegra * 100, 1)}%</div>
        </div>
      ),
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
      headerTitle: "Rendimento realizado − rendimento que o benchmark teria gerado sobre o mesmo capital, capitalizado dia a dia",
      align: "right",
      value: (l) => l.cmp.excesso,
      render: (l) => <span className={corExcesso(l.cmp.excesso)}>{fmtNum(l.cmp.excesso, { parens: true })}</span>,
      total: () => <span className={corExcesso(d.carteira.excesso)}>{fmtNum(d.carteira.excesso, { parens: true })}</span>,
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
            onClick={restaurarPadrao}
            aria-label="Restaurar padrão"
            title="Restaurar o cadastro padrão da demo"
          >
            <span className="hidden sm:inline">Restaurar padrão</span>
          </Button>
          <Button variant="emphasized" icon={<Plus className="w-4 h-4" />} onClick={novo} aria-label="Novo benchmark" title="Novo benchmark">
            <span className="hidden sm:inline">Novo benchmark</span>
          </Button>
        </>
      }
      kpis={
        <>
          <HeaderKpi
            label="Benchmark da carteira"
            value={`${fmtDec(d.carteira.pct * 100, 1)}%`}
            unit="do CDI"
            sub={`12 meses · regras ${fmtDec(d.carteira.pctRegra * 100, 1)}%`}
          />
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
        vale a de vigência mais recente. O rendimento do benchmark é capitalizado <strong>dia a dia</strong> com a regra
        vigente em cada dia, como uma aplicação pós-fixada em % do CDI, e é usado no R01 (composição), R03 (rentabilidade),
        R05 (evolução mensal) e nos alertas. Nesta demo o cadastro fica salvo neste navegador.
      </MessageStrip>
      {!temCarteiraVigente(cadastro, p.dataBase) && (
        <MessageStrip design="critical">
          Não há regra da <strong>carteira consolidada</strong> vigente em {fmtDate(p.dataBase)}: as aplicações sem regra
          específica são comparadas com 100% do CDI. Cadastre uma regra de carteira com vigência até a data-base.
        </MessageStrip>
      )}

      <Card
        title="Regras de benchmark"
        subtitle={`${cadastro.length} regra(s) · CDI vigente ${fmtPct(p.cdi)} a.a. (importado do SAP) · clique na linha para editar`}
        bodyClassName="px-0 pb-0"
        actions={
          <Button size="sm" variant="transparent" icon={<Plus className="w-4 h-4" />} onClick={novo} title="Adicionar regra de benchmark">
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
            Rendimento do benchmark = capital base × (Π (1 + DI diário × % da regra do dia) − 1), com DI diário = (1 + CDI)^(1/252) − 1,
            nos dias úteis em que a aplicação esteve ativa. Benchmark em % do CDI = esse rendimento ÷ (capital base × CDI do
            período), na mesma base do realizado – por isso uma regra de 90% aparece como cerca de {fmtDec(taxaEquivalenteBenchmark(0.9, p.cdi) / p.cdi * 100, 1)}% do CDI em 12 meses.
            Excesso = rendimento realizado − rendimento do benchmark; tolerância de ±0,5 p.p. para “em linha”.
          </p>
        </Card>
      </div>

      <Card
        title="Rentabilidade × benchmark por aplicação"
        subtitle={`Últimos 12 meses (${fmtDate(inicio)} a ${fmtDate(p.dataBase)}) · rendimento total ${fmtBRL(d.linhas.reduce((s, l) => s + l.r.rendimento, 0))}${d.comVigenciaNoPeriodo ? ` · ${d.comVigenciaNoPeriodo} aplicação(ões) com mudança de regra no período` : ""}`}
        bodyClassName="px-0 pb-0"
      >
        <DataTable columns={colunasOps} rows={d.linhas} rowKey={(l) => l.r.op.transacao} showTotals maxHeight={520} defaultSort={{ key: "dif", dir: "asc" }} />
      </Card>

      {rascunho && (
        <DialogoBenchmark inicial={rascunho} cadastro={cadastro} cdi={p.cdi} dataBase={p.dataBase} onCancel={() => setRascunho(null)} onConfirm={confirmar} />
      )}
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

/** "até 31/12/2025: Benchmark da carteira (100%)" – regras anteriores quando a vigência mudou no período */
function descreverTrechos(trechos: TrechoBenchmark[]): string {
  return trechos
    .slice(0, -1)
    .map((t) => `até ${fmtDate(addDays(t.fim, -1))}: ${t.regra?.descricao ?? "sem regra"} (${fmtDec(t.pct * 100, 1)}%)`)
    .join(" · ");
}

/** Mantém Tab / Shift+Tab dentro do diálogo modal */
function prenderFoco(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const focaveis = [
    ...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea, [href], [tabindex]:not([tabindex="-1"])'),
  ].filter((el) => el.offsetParent !== null);
  if (!focaveis.length) return;
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  const ativo = document.activeElement;
  if (e.shiftKey && (ativo === primeiro || !e.currentTarget.contains(ativo))) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && (ativo === ultimo || !e.currentTarget.contains(ativo))) {
    e.preventDefault();
    primeiro.focus();
  }
}

function DialogoBenchmark({
  inicial,
  cadastro,
  cdi,
  dataBase,
  onCancel,
  onConfirm,
}: {
  inicial: Rascunho;
  cadastro: Benchmark[];
  cdi: number;
  dataBase: string;
  onCancel: () => void;
  onConfirm: (r: Rascunho) => void;
}) {
  const [r, setR] = useState<Rascunho>(inicial);
  const [tentou, setTentou] = useState(false);
  const erros = validar(r, cadastro, dataBase);
  const visiveis = tentou ? erros : {};
  // Elemento que abriu o diálogo, capturado na renderização (antes do autoFocus do primeiro campo)
  const [origem] = useState<HTMLElement | null>(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const primeiroCampo = useRef<HTMLInputElement>(null);

  // Foco no primeiro campo ao abrir e de volta ao elemento que abriu o diálogo ao fechar
  useEffect(() => {
    primeiroCampo.current?.focus();
    return () => {
      if (origem && origem !== document.body && document.contains(origem)) origem.focus();
    };
  }, [origem]);

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
        onKeyDown={prenderFoco}
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
              ref={primeiroCampo}
              value={r.descricao}
              onChange={(e) => set({ descricao: e.target.value })}
              placeholder="Ex.: CDBs de bancos de primeira linha"
              maxLength={60}
              className={inputCls(visiveis.descricao)}
            />
          </Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo label="Escopo" obrigatorio erro={visiveis.escopo}>
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
              <NumberInput
                ariaLabel="Benchmark em % do CDI"
                value={r.pct}
                onChange={(v) => set({ pct: v })}
                allowEmpty
                suffix="% CDI"
                step={0.5}
                min={PCT_MINIMO * 100}
                max={PCT_MAXIMO * 100}
              />
            </Campo>
            <Campo label="Vigência a partir de" obrigatorio erro={visiveis.vigenciaInicio}>
              <input type="date" value={r.vigenciaInicio} onChange={(e) => set({ vigenciaInicio: e.target.value })} className={inputCls(visiveis.vigenciaInicio)} />
            </Campo>
          </div>
          <div className="rounded-lg bg-[#f5f6f7] px-3 py-2.5 text-[13px] text-label">
            Equivale a <strong className="text-text tabular">{Number.isFinite(r.pct) ? fmtPct(taxaEquivalenteBenchmark(r.pct / 100, cdi)) : "—"} a.a.</strong> com o
            CDI vigente de {fmtPct(cdi)} a.a. (importado do SAP), capitalizado diariamente. Faixa permitida: {fmtDec(PCT_MINIMO * 100, 0)}% a{" "}
            {fmtDec(PCT_MAXIMO * 100, 0)}% do CDI. A regra vale a partir da vigência; os dias anteriores seguem a regra anterior.
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
