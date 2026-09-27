import clsx from "clsx";
import { Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "../../shared/components/fiori/Button";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { NumberInput, SegmentedButton, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { usePremissas } from "../../shared/context/MercadoContext";
import { EMPRESAS } from "../../shared/data/empresas";
import { addDays, fmtDate, lastMonthEnds } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct, plural } from "../../shared/lib/format";
import { useBenchmarks } from "../context/BenchmarkContext";
import { ESCOPOS_BENCHMARK, PCT_MAXIMO, PCT_MINIMO, type Benchmark, type EscopoBenchmark } from "../data/benchmark";
import { OPERACOES } from "../data/carteira";
import { relatorioPorId } from "../data/catalogo";
import { FUNDOS } from "../data/fundos";
import { TIPOS_TITULO, TITULOS } from "../data/tesouro";
import { TIME_DEPOSITS } from "../data/timeDeposits";
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
import {
  contratosMestre,
  rentabilidadeMestre,
  taxaFundoTexto,
  taxaTDTexto,
  taxaTituloTexto,
  TIPOS_CONTRATO,
  type RentabContrato,
  type TipoContrato,
} from "../lib/carteiraMestre";
import { taxaContratada } from "../lib/finance";

const rel = relatorioPorId("benchmark");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

/** Contrato cadastrado (qualquer data) com a chave do benchmark: tipo, produto, portfolio e taxa contratada */
interface ContratoBenchmark {
  transacao: string;
  tipo: TipoContrato;
  produto: string;
  portfolio: string;
  taxa: string;
}

const nomeTitulo = (tipo: string) => TIPOS_TITULO.find((x) => x.tipo === tipo)?.nome ?? tipo;
/** Títulos públicos na ordem do Tesouro (Selic, Prefixado, …); demais produtos em ordem alfabética */
const ordemProduto = (produto: string) => TIPOS_TITULO.findIndex((x) => x.nome === produto);

/** Todos os contratos da Carteira-Mestre: renda fixa bancária, Tesouro Direto, fundos e time deposits */
const CONTRATOS: ContratoBenchmark[] = [
  ...OPERACOES.map((o) => ({ transacao: o.transacao, tipo: "Renda fixa bancária" as const, produto: o.produto, portfolio: o.portfolio, taxa: taxaContratada(o) })),
  ...TITULOS.map((t) => ({ transacao: t.transacao, tipo: "Tesouro Direto" as const, produto: nomeTitulo(t.tipo), portfolio: t.portfolio, taxa: taxaTituloTexto(t) })),
  ...FUNDOS.map((f) => ({ transacao: f.transacao, tipo: "Fundo de investimento" as const, produto: f.produto, portfolio: f.portfolio, taxa: taxaFundoTexto(f) })),
  ...TIME_DEPOSITS.map((d) => ({ transacao: d.transacao, tipo: "Time deposit" as const, produto: "Time deposit", portfolio: d.portfolio, taxa: taxaTDTexto(d) })),
];
const POR_TRANSACAO = new Map(CONTRATOS.map((c) => [c.transacao, c]));

const INFO_TIPO = Object.fromEntries(TIPOS_CONTRATO.map((t, i) => [t.tipo, { ...t, ordem: i }])) as Record<
  TipoContrato,
  (typeof TIPOS_CONTRATO)[number] & { ordem: number }
>;

/** Portfolios de todos os tipos de contrato, com os tipos que cada um contém */
const PORTFOLIOS = [...new Set(CONTRATOS.map((c) => c.portfolio))].sort().map((portfolio) => ({
  portfolio,
  tipos: TIPOS_CONTRATO.filter((t) => CONTRATOS.some((c) => c.portfolio === portfolio && c.tipo === t.tipo)).map((t) => t.curto),
}));

/** Tipos de produto (chave do benchmark), na ordem dos tipos de contrato */
const PRODUTOS: { produto: string; tipo: TipoContrato }[] = [...new Map(CONTRATOS.map((c) => [c.produto, c.tipo])).entries()]
  .map(([produto, tipo]) => ({ produto, tipo }))
  .sort((a, b) => INFO_TIPO[a.tipo].ordem - INFO_TIPO[b.tipo].ordem || ordemProduto(a.produto) - ordemProduto(b.produto) || a.produto.localeCompare(b.produto, "pt-BR"));
const TIPO_DO_PRODUTO = new Map(PRODUTOS.map((x) => [x.produto, x.tipo]));

function rotuloProduto(produto: string): string {
  const tipo = TIPO_DO_PRODUTO.get(produto);
  return tipo && tipo !== produto ? `${produto} (${INFO_TIPO[tipo].curto})` : produto;
}

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
      return PORTFOLIOS.map((x) => ({ value: x.portfolio, label: `${x.portfolio} (${x.tipos.join(", ")})` }));
    case "produto":
      return PRODUTOS.map((x) => ({ value: x.produto, label: rotuloProduto(x.produto) }));
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
  nota: string;
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
  r: RentabContrato;
  /** taxa contratada, como exibida */
  taxa: string;
  portfolio: string;
  /** regra vigente no último dia do período da operação */
  regra: Benchmark | null;
  cmp: ComparacaoOperacao;
}

export function BenchmarkApp() {
  const { premissas: p } = usePremissas();
  const { cadastro, salvar, remover, restaurar, substituir, alterado } = useBenchmarks();
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);

  const [visaoGrafico, setVisaoGrafico] = useState<"tipo" | "produto">("tipo");
  const [filtroTipo, setFiltroTipo] = useState<TipoContrato | "todos">("todos");

  const inicio = lastMonthEnds(p.dataBase, 13)[0];
  // Todos os contratos da Carteira-Mestre (renda fixa, Tesouro Direto, fundos e time deposits), inclusive os liquidados no período
  const rentab = useMemo(() => rentabilidadeMestre(inicio, p.dataBase, p), [inicio, p]);
  const ativos = useMemo(() => contratosMestre(p.dataBase, p), [p]);

  const d = useMemo(() => {
    const linhas: LinhaOp[] = rentab.map((r) => {
      const cmp = compararOperacao(r, cadastro, p);
      const info = POR_TRANSACAO.get(r.op.transacao);
      return { r, taxa: info?.taxa ?? "", portfolio: r.op.portfolio, regra: cmp.trechos[cmp.trechos.length - 1]?.regra ?? null, cmp };
    });
    const carteira = compararCarteira(rentab, cadastro, p);
    const cobertura = new Map<string, number>();
    for (const c of ativos) {
      const b = benchmarkDaOperacao(c.chave, cadastro, p.dataBase);
      if (b) cobertura.set(b.id, (cobertura.get(b.id) ?? 0) + 1);
    }
    const porTipo = TIPOS_CONTRATO.map((t) => {
      const rs = rentab.filter((r) => r.tipo === t.tipo);
      const c = compararCarteira(rs, cadastro, p);
      return { chave: t.curto, tipo: t.tipo, cor: t.cor, realizado: c.realizado * 100, benchmark: c.pct * 100, qtd: rs.length, excesso: c.excesso };
    }).filter((x) => x.qtd > 0);
    const porProduto = PRODUTOS.map(({ produto, tipo }) => {
      const rs = rentab.filter((r) => r.op.produto === produto);
      const c = compararCarteira(rs, cadastro, p);
      return { chave: produto, tipo, cor: INFO_TIPO[tipo].cor, realizado: c.realizado * 100, benchmark: c.pct * 100, qtd: rs.length, excesso: c.excesso };
    })
      .filter((x) => x.qtd > 0)
      .sort((a, b) => INFO_TIPO[a.tipo].ordem - INFO_TIPO[b.tipo].ordem || b.realizado - a.realizado);
    return {
      linhas,
      carteira,
      cobertura,
      porTipo,
      porProduto,
      abaixo: linhas.filter((l) => l.cmp.situacao === "abaixo").length,
      comVigenciaNoPeriodo: linhas.filter((l) => l.cmp.trechos.length > 1).length,
    };
  }, [rentab, ativos, cadastro, p]);

  const linhasTabela = useMemo(() => (filtroTipo === "todos" ? d.linhas : d.linhas.filter((l) => l.r.tipo === filtroTipo)), [d.linhas, filtroTipo]);
  const totalTabela = useMemo(
    () => (filtroTipo === "todos" ? d.carteira : compararCarteira(linhasTabela.map((l) => l.r), cadastro, p)),
    [filtroTipo, d.carteira, linhasTabela, cadastro, p],
  );
  const listaOps = useMemo(() => [...linhasTabela].sort((a, b) => a.cmp.realizado - a.cmp.pct - (b.cmp.realizado - b.cmp.pct)), [linhasTabela]);
  const dadosGrafico = visaoGrafico === "tipo" ? d.porTipo : d.porProduto;
  // Escala do eixo em % do CDI com marcas redondas (inclui 0 e 100%; negativos quando algum realizado for negativo)
  const escala = useMemo(() => {
    const vals = dadosGrafico.flatMap((x) => [x.realizado, x.benchmark]);
    const passo = Math.max(...vals) - Math.min(0, ...vals) > 200 ? 50 : 20;
    // realizados levemente negativos (ex.: −0,1%) não abrem uma faixa negativa inteira no eixo
    const lo = Math.min(...vals) < -1 ? Math.floor(Math.min(...vals) / passo) * passo : 0;
    const hi = Math.max(120, Math.ceil(Math.max(...vals) / passo) * passo);
    const ticks: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += passo) ticks.push(v);
    return { domain: [lo, hi] as [number, number], ticks };
  }, [dadosGrafico]);

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
    setRascunho({ id: null, descricao: "", escopo: "produto", valor: PRODUTOS[0].produto, pct: 100, vigenciaInicio: `${p.dataBase.slice(0, 4)}-01-01`, nota: "" });
  const editar = (b: Benchmark) =>
    setRascunho({
      id: b.id,
      descricao: b.descricao,
      escopo: b.escopo,
      valor: b.valor,
      pct: Math.round(b.pctCDI * 10000) / 100,
      vigenciaInicio: b.vigenciaInicio,
      nota: b.nota ?? "",
    });

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
      ...(r.nota.trim() ? { nota: r.nota.trim() } : {}),
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
            { titulo: "Contratos ativos", tipo: "inteiro" },
            { titulo: "Justificativa", largura: 60 },
          ],
          linhas: ordenado.map((b) => [
            b.descricao,
            ESCOPOS_BENCHMARK.find((e) => e.value === b.escopo)?.label ?? b.escopo,
            b.escopo === "produto" ? rotuloProduto(b.valor) : aplicaSeA(b),
            b.pctCDI * 100,
            taxaEquivalenteBenchmark(b.pctCDI, p.cdi) * 100,
            b.vigenciaInicio,
            d.cobertura.get(b.id) ?? 0,
            b.nota ?? "",
          ]),
          notas: [`Contratos ativos em ${fmtDate(p.dataBase)} na Carteira-Mestre (renda fixa bancária, Tesouro Direto, fundos e time deposits) aos quais a regra se aplica.`],
        },
        {
          nome: "Por tipo de contrato",
          titulo: "Realizado × benchmark por tipo de contrato – últimos 12 meses",
          subtitulo: `${fmtDate(inicio)} a ${fmtDate(p.dataBase)}`,
          colunas: [
            { titulo: "Tipo de contrato", largura: 26 },
            { titulo: "Contratos", tipo: "inteiro" },
            { titulo: "Realizado (% CDI)", tipo: "decimal" },
            { titulo: "Benchmark (% CDI)", tipo: "decimal" },
            { titulo: "Excesso (R$)", tipo: "moeda" },
          ],
          linhas: d.porTipo.map((x) => [x.tipo, x.qtd, x.realizado, x.benchmark, x.excesso]),
          total: ["TOTAL", d.linhas.length, d.carteira.realizado * 100, d.carteira.pct * 100, d.carteira.excesso],
          notas: ["Time deposits: resultado em R$ (juros em moeda estrangeira + variação cambial) sobre o saldo convertido pela PTAX; pode ser negativo quando o real se aprecia."],
        },
        {
          nome: "Realizado x benchmark",
          titulo: "Rentabilidade realizada × benchmark – últimos 12 meses",
          subtitulo: `${fmtDate(inicio)} a ${fmtDate(p.dataBase)}`,
          colunas: [
            { titulo: "Código", largura: 12 },
            { titulo: "Transação", largura: 14 },
            { titulo: "Tipo de contrato", largura: 22 },
            { titulo: "Aplicação", largura: 34 },
            { titulo: "Portfolio", largura: 16 },
            { titulo: "Status", largura: 12 },
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
            l.r.codigo,
            l.r.op.transacao,
            l.r.tipo,
            `${l.r.produto} · ${l.r.contraparte}`,
            l.portfolio,
            l.r.status,
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
            "",
            "",
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
            "Rendimento realizado = variação do saldo bruto (curva na renda fixa e nos títulos, cota nos fundos, saldo em moeda × PTAX nos time deposits) + fluxos recebidos no período (cupons, resgates, come-cotas).",
          ],
        },
      ],
      p.dataBase,
    );

  const colunasCadastro: Column<Benchmark>[] = [
    {
      key: "desc",
      header: "Descrição",
      minWidth: 240,
      value: (b) => b.descricao,
      render: (b) => (
        <div className="max-w-[26rem]">
          <div className="font-semibold text-text">{b.descricao}</div>
          {b.nota && <div className="text-xs text-label leading-snug mt-0.5 whitespace-normal">{b.nota}</div>}
        </div>
      ),
    },
    {
      key: "escopo",
      header: "Escopo",
      value: (b) => ESCOPOS_BENCHMARK.find((e) => e.value === b.escopo)?.prioridade ?? 0,
      render: (b) => <Tag color={COR_ESCOPO[b.escopo]}>{ROTULO_ESCOPO[b.escopo]}</Tag>,
    },
    {
      key: "valor",
      header: "Aplica-se a",
      minWidth: 170,
      value: (b) => aplicaSeA(b),
      render: (b) => <AplicaSeA b={b} />,
    },
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
      header: "Contratos ativos",
      headerTitle: "Contratos ativos na data-base (Carteira-Mestre: renda fixa, Tesouro Direto, fundos e time deposits) aos quais esta regra se aplica",
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
      minWidth: 230,
      value: (l) => `${l.r.produto} ${l.r.contraparte}`,
      render: (l) => (
        <div>
          <div className="font-semibold text-text">
            {l.r.produto} · {l.r.contraparte}
          </div>
          <div className="text-xs text-label">
            {l.r.codigo} · {l.taxa} · {l.portfolio}
            {l.r.status === "Liquidada" && <span className="text-critical-strong"> · liquidada em {fmtDate(l.r.fim)}</span>}
          </div>
        </div>
      ),
      total: () => (filtroTipo === "todos" ? "Carteira consolidada" : INFO_TIPO[filtroTipo].curto),
    },
    {
      key: "tipo",
      header: "Tipo de contrato",
      value: (l) => INFO_TIPO[l.r.tipo].ordem,
      render: (l) => <Tag color={INFO_TIPO[l.r.tipo].cor}>{INFO_TIPO[l.r.tipo].curto}</Tag>,
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
      total: () => `${fmtDec(totalTabela.pct * 100, 1)}%`,
    },
    {
      key: "real",
      header: "Realizado",
      headerTitle: "% do CDI bruto realizado nos últimos 12 meses",
      align: "right",
      value: (l) => l.cmp.realizado,
      render: (l) => <span className="font-semibold">{fmtDec(l.cmp.realizado * 100, 1)}%</span>,
      total: () => `${fmtDec(totalTabela.realizado * 100, 1)}%`,
    },
    {
      key: "dif",
      header: "Diferença",
      align: "right",
      value: (l) => l.cmp.realizado - l.cmp.pct,
      render: (l) => <Diferenca v={l.cmp.realizado - l.cmp.pct} />,
      total: () => <Diferenca v={totalTabela.realizado - totalTabela.pct} />,
    },
    {
      key: "exc",
      header: "Excesso (R$)",
      headerTitle: "Rendimento realizado − rendimento que o benchmark teria gerado sobre o mesmo capital, capitalizado dia a dia",
      align: "right",
      value: (l) => l.cmp.excesso,
      render: (l) => <span className={corExcesso(l.cmp.excesso)}>{fmtNum(l.cmp.excesso)}</span>,
      total: () => <span className={corExcesso(totalTabela.excesso)}>{fmtNum(totalTabela.excesso)}</span>,
    },
    {
      key: "sit",
      header: "Situação",
      value: (l) => l.cmp.situacao,
      render: (l) => <ObjectStatus state={SITUACAO_STATE[l.cmp.situacao]}>{SITUACAO_TEXTO[l.cmp.situacao]}</ObjectStatus>,
      total: () => <ObjectStatus state={SITUACAO_STATE[totalTabela.situacao]}>{SITUACAO_TEXTO[totalTabela.situacao]}</ObjectStatus>,
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
        </>
      }
      kpis={
        <>
          <HeaderKpi
            label="Benchmark efetivo (mix das regras)"
            value={`${fmtDec(d.carteira.pct * 100, 1)}%`}
            unit="do CDI"
            sub={`12 meses · média das regras ${fmtDec(d.carteira.pctRegra * 100, 1)}%`}
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
          <HeaderKpi
            label="Abaixo do benchmark"
            value={String(d.abaixo)}
            unit={`de ${d.linhas.length}`}
            state={d.abaixo ? "critical" : "positive"}
            sub="Contratos nos 12 meses (todos os tipos)"
          />
        </>
      }
    >
      <MessageStrip>
        Cadastre a taxa de benchmark de cada aplicação como <strong>percentual do CDI</strong>. A regra mais específica
        vence: <strong>tipo de produto › portfolio › empresa › carteira consolidada</strong>; entre regras do mesmo nível,
        vale a de vigência mais recente. O rendimento do benchmark é capitalizado <strong>dia a dia</strong> com a regra
        vigente em cada dia, como uma aplicação pós-fixada em % do CDI, e vale para <strong>todos os contratos da
        Carteira-Mestre</strong> – renda fixa bancária, Tesouro Direto, fundos e time deposits. É usado no R01, R03, R05,
        R09, no Painel de KPIs e nos alertas. Nesta demo o cadastro fica salvo neste navegador.
      </MessageStrip>
      {!temCarteiraVigente(cadastro, p.dataBase) && (
        <MessageStrip design="critical">
          Não há regra da <strong>carteira consolidada</strong> vigente em {fmtDate(p.dataBase)}: as aplicações sem regra
          específica são comparadas com 100% do CDI. Cadastre uma regra de carteira com vigência até a data-base.
        </MessageStrip>
      )}

      <Card
        title="Regras de benchmark"
        subtitle={`${plural(cadastro.length, "regra", "regras")} · CDI vigente ${fmtPct(p.cdi)} a.a. (importado do SAP) · clique em uma regra para editar`}
        bodyClassName="px-0 pb-0"
        actions={
          <Button variant="default" icon={<Plus className="w-4 h-4" />} onClick={novo} title="Cadastrar regra de benchmark">
            Novo benchmark
          </Button>
        }
      >
        <div className="hidden lg:block">
          <DataTable columns={colunasCadastro} rows={ordenado} rowKey={(b) => b.id} onRowClick={editar} />
        </div>
        {/* Celular e tablet: lista em cartões */}
        <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
          {ordenado.map((b) => {
            const n = d.cobertura.get(b.id) ?? 0;
            return (
              <li key={b.id} className="px-4 py-3 cursor-pointer hover:bg-hover" onClick={() => editar(b)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-text">{b.descricao}</span>
                      <Tag color={COR_ESCOPO[b.escopo]}>{ROTULO_ESCOPO[b.escopo]}</Tag>
                    </div>
                    <div className="text-[13px] text-text mt-1">
                      <AplicaSeA b={b} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-text tabular whitespace-nowrap">{fmtDec(b.pctCDI * 100, 1)}%</div>
                    <div className="text-xs text-label whitespace-nowrap">{fmtPct(taxaEquivalenteBenchmark(b.pctCDI, p.cdi))} a.a.</div>
                  </div>
                </div>
                {b.nota && <p className="text-xs text-label leading-snug mt-1">{b.nota}</p>}
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <span className="text-xs text-label">
                    Vigência desde {fmtDate(b.vigenciaInicio)} · {n ? plural(n, "contrato ativo", "contratos ativos") : "nenhum contrato ativo"}
                  </span>
                  <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="transparent" icon={<Pencil className="w-4 h-4" />} aria-label={`Editar ${b.descricao}`} title="Editar" onClick={semPropagar(() => editar(b))} />
                    <Button size="sm" variant="transparent" icon={<Trash2 className="w-4 h-4" />} aria-label={`Excluir ${b.descricao}`} title="Excluir" onClick={semPropagar(() => excluir(b))} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card
          className="xl:col-span-3"
          title={visaoGrafico === "tipo" ? "Realizado × benchmark por tipo de contrato" : "Realizado × benchmark por produto"}
          subtitle={`% do CDI bruto · ${fmtDate(inicio)} a ${fmtDate(p.dataBase)}`}
          actions={
            <SegmentedButton
              value={visaoGrafico}
              onChange={setVisaoGrafico}
              items={[
                { value: "tipo", label: "Tipo" },
                { value: "produto", label: "Produto" },
              ]}
            />
          }
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-label mb-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex gap-0.5">
                {TIPOS_CONTRATO.map((t) => (
                  <span key={t.tipo} className="w-2 h-2.5 rounded-[2px]" style={{ backgroundColor: t.cor }} />
                ))}
              </span>
              Realizado (cor do tipo de contrato)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[2px] bg-[#a8b2bd]" />
              Benchmark cadastrado
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 border-t border-dashed border-[#556b82]" />
              100% do CDI
            </span>
          </div>
          {visaoGrafico === "tipo" ? (
            <div className="h-72 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosGrafico} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barGap={3}>
                  <CartesianGrid vertical={false} stroke="#e5e5e5" />
                  <XAxis dataKey="chave" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} />
                  <YAxis
                    tick={AXIS_STYLE}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    domain={escala.domain}
                    ticks={escala.ticks}
                    tickFormatter={(v: number) => `${fmtDec(v, 0)}%`}
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtDec(v, 1)}% do CDI`, n]} />
                  <ReferenceLine y={100} stroke="#556b82" strokeDasharray="4 3" />
                  <Bar dataKey="realizado" name="Realizado" radius={[3, 3, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                    {dadosGrafico.map((x) => (
                      <Cell key={x.chave} fill={x.cor} />
                    ))}
                  </Bar>
                  <Bar dataKey="benchmark" name="Benchmark" fill="#a8b2bd" radius={[3, 3, 0, 0]} maxBarSize={44} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="-ml-2" style={{ height: Math.max(288, dadosGrafico.length * 30 + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosGrafico} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barGap={1} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke="#e5e5e5" />
                  <XAxis
                    type="number"
                    tick={AXIS_STYLE}
                    tickLine={false}
                    axisLine={{ stroke: "#a8b2bd" }}
                    domain={escala.domain}
                    ticks={escala.ticks}
                    tickFormatter={(v: number) => `${fmtDec(v, 0)}%`}
                  />
                  <YAxis type="category" dataKey="chave" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={false} width={158} interval={0} tickFormatter={rotuloCurtoProduto} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtDec(v, 1)}% do CDI`, n]} />
                  <ReferenceLine x={100} stroke="#556b82" strokeDasharray="4 3" />
                  <Bar dataKey="realizado" name="Realizado" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                    {dadosGrafico.map((x) => (
                      <Cell key={x.chave} fill={x.cor} />
                    ))}
                  </Bar>
                  <Bar dataKey="benchmark" name="Benchmark" fill="#a8b2bd" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-xs text-label mt-2 leading-relaxed">
            Títulos públicos pelo valor na curva (a marcação a mercado fica fora da comparação); fundos pela cota, líquida das
            taxas de administração e performance; time deposits pelo resultado em R$ (juros em moeda estrangeira + variação
            cambial), que cai – e pode ficar negativo – quando o real se aprecia.
          </p>
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
        title="Rentabilidade × benchmark por contrato"
        subtitle={`Últimos 12 meses (${fmtDate(inicio)} a ${fmtDate(p.dataBase)}) · ${plural(linhasTabela.length, "contrato", "contratos")} · rendimento ${fmtBRL(linhasTabela.reduce((s, l) => s + l.r.rendimento, 0))}${d.comVigenciaNoPeriodo ? ` · ${d.comVigenciaNoPeriodo} com mudança de regra no período` : ""}`}
        bodyClassName="px-0 pb-0"
        actions={
          <Select
            ariaLabel="Tipo de contrato"
            className="w-44"
            value={filtroTipo}
            onChange={setFiltroTipo}
            options={[
              { value: "todos" as const, label: "Todos os tipos" },
              ...TIPOS_CONTRATO.map((t) => ({ value: t.tipo, label: t.curto })),
            ]}
          />
        }
      >
        <div className="hidden lg:block">
          <DataTable columns={colunasOps} rows={linhasTabela} rowKey={(l) => l.r.codigo} showTotals maxHeight={560} defaultSort={{ key: "dif", dir: "asc" }} />
        </div>
        {/* Celular e tablet: lista em cartões (maiores diferenças negativas primeiro, como na tabela) */}
        <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
          {listaOps.length === 0 && <li className="px-4 py-8 text-center text-sm text-label">Nenhum contrato no filtro selecionado</li>}
          {listaOps.map((l) => (
            <li key={l.r.codigo} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-text">
                      {l.r.produto} · {l.r.contraparte}
                    </span>
                    <Tag color={INFO_TIPO[l.r.tipo].cor}>{INFO_TIPO[l.r.tipo].curto}</Tag>
                  </div>
                  <div className="text-xs text-label leading-snug mt-0.5">
                    {l.r.codigo} · {l.taxa} · {l.portfolio}
                    {l.r.status === "Liquidada" && <span className="text-critical-strong"> · liquidada em {fmtDate(l.r.fim)}</span>}
                  </div>
                  <div className="text-xs text-label leading-snug">
                    {l.regra ? `Regra: ${l.regra.descricao}` : "Sem regra (100% do CDI)"}
                    {l.cmp.trechos.length > 1 && ` · ${descreverTrechos(l.cmp.trechos)}`}
                  </div>
                </div>
                <ObjectStatus state={SITUACAO_STATE[l.cmp.situacao]}>{SITUACAO_TEXTO[l.cmp.situacao]}</ObjectStatus>
              </div>
              <ValoresOp bmk={l.cmp.pct} regra={l.cmp.pctRegra} realizado={l.cmp.realizado} excesso={l.cmp.excesso} />
            </li>
          ))}
          {listaOps.length > 0 && (
            <li className="px-4 py-3 bg-[#f5f6f7]">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-bold text-text">
                  {filtroTipo === "todos" ? "Carteira consolidada" : INFO_TIPO[filtroTipo].curto} · {plural(listaOps.length, "contrato", "contratos")}
                </div>
                <ObjectStatus state={SITUACAO_STATE[totalTabela.situacao]}>{SITUACAO_TEXTO[totalTabela.situacao]}</ObjectStatus>
              </div>
              <ValoresOp bmk={totalTabela.pct} regra={totalTabela.pctRegra} realizado={totalTabela.realizado} excesso={totalTabela.excesso} forte />
            </li>
          )}
        </ul>
      </Card>

      {rascunho && (
        <DialogoBenchmark inicial={rascunho} cadastro={cadastro} cdi={p.cdi} dataBase={p.dataBase} onCancel={() => setRascunho(null)} onConfirm={confirmar} />
      )}
    </ReportPage>
  );
}

/** Rótulo do eixo do gráfico por produto (nomes longos do Tesouro abreviados) */
function rotuloCurtoProduto(produto: string): string {
  return produto.replace("com Juros Semestrais", "c/ juros").replace("Fundo crédito privado", "Fundo créd. privado");
}

function AplicaSeA({ b }: { b: Benchmark }) {
  if (b.escopo === "produto") {
    const tipo = TIPO_DO_PRODUTO.get(b.valor);
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>{b.valor}</span>
        {tipo && <Tag color={INFO_TIPO[tipo].cor}>{INFO_TIPO[tipo].curto}</Tag>}
      </div>
    );
  }
  if (b.escopo === "portfolio") {
    const pf = PORTFOLIOS.find((x) => x.portfolio === b.valor);
    return (
      <div>
        <div>{b.valor}</div>
        {pf && <div className="text-xs text-label">{pf.tipos.join(" · ")}</div>}
      </div>
    );
  }
  return <span>{aplicaSeA(b)}</span>;
}

/** Valores do cartão de contrato no celular: benchmark, realizado, diferença e excesso */
function ValoresOp({ bmk, regra, realizado, excesso, forte }: { bmk: number; regra: number; realizado: number; excesso: number; forte?: boolean }) {
  const dd = clsx("tabular truncate", forte ? "font-bold" : "font-semibold");
  return (
    <dl className="grid grid-cols-4 gap-x-2 mt-2 text-[13px]">
      <div className="min-w-0">
        <dt className="text-xs text-label truncate">Benchmark</dt>
        <dd className={clsx(dd, "text-text")}>{fmtDec(bmk * 100, 1)}%</dd>
        <dd className="text-[11px] text-label truncate">regra {fmtDec(regra * 100, 1)}%</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-label truncate">Realizado</dt>
        <dd className={clsx(dd, "text-text")}>{fmtDec(realizado * 100, 1)}%</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-label truncate">Diferença</dt>
        <dd className={dd}>
          <Diferenca v={realizado - bmk} />
        </dd>
      </div>
      <div className="min-w-0 text-right">
        <dt className="text-xs text-label truncate">Excesso</dt>
        <dd className={clsx(dd, corExcesso(excesso))}>{fmtCompact(excesso)}</dd>
      </div>
    </dl>
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
          <Campo label="Justificativa (opcional)">
            <textarea
              value={r.nota}
              onChange={(e) => set({ nota: e.target.value })}
              placeholder="Ex.: custo de oportunidade em R$ de aplicações no exterior"
              maxLength={240}
              rows={2}
              className="w-full rounded-[var(--radius-field)] border border-field bg-white px-2.5 py-2 text-sm text-text focus:outline-none focus:border-brand focus:shadow-[inset_0_-1px_0_var(--color-brand)] resize-none"
            />
          </Campo>
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
