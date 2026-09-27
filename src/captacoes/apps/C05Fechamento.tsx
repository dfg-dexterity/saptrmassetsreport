import clsx from "clsx";
import { ArrowRight, CheckCircle2, UserRound, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { SegmentedButton, TabBar } from "../../shared/components/fiori/Inputs";
import { CHART_COLORS, HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { ultimoDadoNaDataBase } from "../../shared/data/mercado";
import { fmtDate, fromDay, isBusinessDay, toDay } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec } from "../../shared/lib/format";
import { useDivida } from "../context/useDivida";
import { relatorioCaptacao } from "../data/catalogo";
import { CONTAS_CONTABEIS, TOLERANCIA_CONCILIACAO, type GrupoContabil, type StatusEtapa } from "../data/fechamento";
import {
  checagensIntegridade,
  checklistFechamento,
  conciliacaoExtratos,
  conciliacaoGL,
  type Checagem,
  type EtapaStatus,
  type LinhaConciliacaoExtrato,
  type LinhaConciliacaoGL,
} from "../lib/fechamento";

const rel = relatorioCaptacao("c05");

type Aba = "gl" | "extratos" | "checagens" | "checklist";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOLERANCIA = fmtBRL(TOLERANCIA_CONCILIACAO, true);

/** Valor em R$ com centavos, sem símbolo (colunas "(R$)" da conciliação) */
function fmtValor(v: number): string {
  return fmtDec(v, 2);
}

/** Diferença com sinal explícito (+/−); zero exibido sem sinal */
function fmtDif(v: number): string {
  if (Math.abs(v) < 0.005) return "0,00";
  return `${v > 0 ? "+" : "−"}${fmtDec(Math.abs(v), 2)}`;
}

/** O motor formata "R$ -0,00" quando a diferença é um resíduo negativo de ponto flutuante */
function semZeroNegativo(texto: string): string {
  return texto.replace(/-0,00(?!\d)/g, "0,00");
}

function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

/** Grupos contábeis do passivo de captações, com o nome do plano de contas do FI-GL */
const GRUPOS: { grupo: GrupoContabil; nome: string; cor: string }[] = (["BNDES", "CCB", "Debêntures", "CRA/CRI"] as GrupoContabil[]).map(
  (grupo, i) => {
    const conta = CONTAS_CONTABEIS.find((c) => c.grupo === grupo);
    return { grupo, nome: conta ? conta.descricao.split(" – ")[0] : grupo, cor: CHART_COLORS[i] };
  },
);
const COR_GRUPO = Object.fromEntries(GRUPOS.map((g) => [g.grupo, g.cor])) as Record<GrupoContabil, string>;

/** "Financiamentos BNDES – Principal – circulante" → "Principal – circulante" */
function rubricaConta(descricao: string): string {
  const i = descricao.indexOf(" – ");
  return i >= 0 ? descricao.slice(i + 3) : descricao;
}

const STATUS_GL: Record<LinhaConciliacaoGL["status"], ValueState> = { Conciliado: "positive", Divergente: "negative" };
const STATUS_EXTRATO: Record<LinhaConciliacaoExtrato["status"], ValueState> = {
  Conciliado: "positive",
  Arredondamento: "information",
  Divergente: "negative",
};
const STATUS_ETAPA: Record<StatusEtapa, ValueState> = { Concluído: "positive", "Com pendência": "critical", Pendente: "neutral" };

/** Linha divergente: destaque do sap.m.ListItem (faixa à esquerda) + fundo suave */
const DESTAQUE_DIVERGENTE = "bg-[#fff6f9]! [&>td:first-child]:shadow-[inset_4px_0_0_#f53232]";

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function diaSemana(iso: string): string {
  return DIAS_SEMANA[(((toDay(iso) + 4) % 7) + 7) % 7];
}

/**
 * Data do dia útil do calendário de fechamento (feriados nacionais – base ANBIMA):
 * DU-1 = último dia útil do mês da data-base; DU-2 = dia útil anterior; DU+1 = primeiro dia útil após a data-base.
 */
function dataDoDiaUtil(dataBase: string, rotulo: string): string {
  const n = Number(rotulo.replace("DU", ""));
  let d = toDay(dataBase);
  if (n < 0) {
    while (!isBusinessDay(d)) d--;
    for (let k = -1; k > n; k--) {
      d--;
      while (!isBusinessDay(d)) d--;
    }
  } else {
    for (let k = 0; k < n; k++) {
      d++;
      while (!isBusinessDay(d)) d++;
    }
  }
  return fromDay(d);
}

/** Relatório relacionado a cada checagem de integridade */
const LINK_CHECAGEM: Record<string, { rotulo: string; rota?: string; aba?: Aba }> = {
  cplp: { rotulo: "C02 – Vencimentos e CP/LP", rota: "/c02-cronograma" },
  rollforward: { rotulo: "C01 – Movimentação", rota: "/c01-movimentacao" },
  juros: { rotulo: "C03 – Encargos", rota: "/c03-encargos" },
  custos: { rotulo: "C03 – Encargos", rota: "/c03-encargos" },
  vencidos: { rotulo: "C00 – Carteira", rota: "/c00-carteira" },
  cronograma: { rotulo: "C02 – Vencimentos e CP/LP", rota: "/c02-cronograma" },
  mercado: { rotulo: "Premissas", rota: "/premissas" },
  gl: { rotulo: "Ver TRM × FI-GL", aba: "gl" },
  extratos: { rotulo: "Ver TRM × extratos", aba: "extratos" },
};

/** Transações SAP do checklist de fechamento */
const TRANSACOES_SAP: { codigo: string; descricao: string }[] = [
  { codigo: "TBB1", descricao: "Contabilização dos fluxos (pagamentos de principal, juros e custos) no FI-GL" },
  { codigo: "TPM44", descricao: "Apropriação por competência (accrual/deferral) de juros e custos de transação" },
  { codigo: "TPM1", descricao: "Avaliação: atualização monetária do principal pelos índices importados" },
];

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function C05Fechamento() {
  const { premissas: p, posicoes, reclassificados } = useDivida("todas");
  const [aba, setAba] = useState<Aba>("gl");
  const [grupo, setGrupo] = useState<GrupoContabil | null>(null);
  const [somenteDivergentes, setSomenteDivergentes] = useState<"todas" | "divergentes">("todas");
  const db = p.dataBase;

  const d = useMemo(() => {
    const gl = conciliacaoGL(posicoes, db);
    const extratos = conciliacaoExtratos(posicoes, db);
    const checagens: Checagem[] = checagensIntegridade(posicoes, db, p, gl, extratos).map((c) => ({
      ...c,
      detalhe: semZeroNegativo(c.detalhe),
    }));
    const checklist = checklistFechamento(db, checagens);

    const glDiv = gl.filter((l) => l.status === "Divergente");
    const extDiv = extratos.filter((l) => l.status === "Divergente");
    const checagensOk = checagens.filter((c) => c.ok).length;
    const etapasConcluidas = checklist.filter((e) => e.status === "Concluído").length;

    // Maior diferença absoluta entre as duas conciliações
    const candidatos = [
      ...gl.map((l) => ({ valor: l.diferenca, onde: `Conta ${l.conta.conta}`, fonte: "FI-GL", aba: "gl" as Aba })),
      ...extratos.map((l) => ({ valor: l.diferenca, onde: l.pos.c.id, fonte: "extrato", aba: "extratos" as Aba })),
    ];
    const maior = candidatos.reduce((m, x) => (Math.abs(x.valor) > Math.abs(m.valor) ? x : m), candidatos[0]);

    const porGrupo = GRUPOS.map((g) => {
      const linhas = gl.filter((l) => l.conta.grupo === g.grupo);
      return {
        ...g,
        contas: linhas.length,
        divergentes: linhas.filter((l) => l.status === "Divergente").length,
        saldoTRM: linhas.reduce((s, l) => s + l.saldoTRM, 0),
        diferenca: linhas.reduce((s, l) => s + l.diferenca, 0),
      };
    });

    // Dias do checklist (DU-2 … DU+3) com a data no calendário de dias úteis
    const dias: { dia: string; data: string; etapas: EtapaStatus[] }[] = [];
    for (const e of checklist) {
      let g = dias.find((x) => x.dia === e.dia);
      if (!g) {
        g = { dia: e.dia, data: dataDoDiaUtil(db, e.dia), etapas: [] };
        dias.push(g);
      }
      g.etapas.push(e);
    }

    const responsaveis = [...new Set(checklist.map((e) => e.responsavel))].map((r) => {
      const etapas = checklist.filter((e) => e.responsavel === r);
      return { responsavel: r, total: etapas.length, concluidas: etapas.filter((e) => e.status === "Concluído").length };
    });

    const totalContabil = posicoes.reduce((s, x) => s + x.saldoContabil, 0);
    const custosAApropriar = posicoes.reduce((s, x) => s + x.custosAApropriar, 0);

    return {
      gl,
      extratos,
      checagens,
      checklist,
      glDiv,
      extDiv,
      checagensOk,
      etapasConcluidas,
      maior,
      porGrupo,
      dias,
      responsaveis,
      totalContabil,
      custosAApropriar,
    };
  }, [posicoes, p, db]);

  const glOk = d.gl.length - d.glDiv.length;
  const extOk = d.extratos.length - d.extDiv.length;
  const maiorAbs = Math.abs(d.maior?.valor ?? 0);
  const maiorForaTolerancia = maiorAbs > TOLERANCIA_CONCILIACAO;
  const aprovacao = d.checklist.find((e) => e.id === "aprovacao");
  const dataAprovacao = aprovacao ? dataDoDiaUtil(db, aprovacao.dia) : null;
  const outrasFalhas = d.checagens.filter((c) => !c.ok && c.id !== "gl" && c.id !== "extratos");
  const qtdPendencias = d.glDiv.length + d.extDiv.length + outrasFalhas.length;

  const linhasGL = d.gl.filter(
    (l) => (!grupo || l.conta.grupo === grupo) && (somenteDivergentes === "todas" || l.status === "Divergente"),
  );
  const somaGL = (rows: LinhaConciliacaoGL[], fn: (l: LinhaConciliacaoGL) => number) => rows.reduce((s, l) => s + fn(l), 0);
  const somaExt = (fn: (l: LinhaConciliacaoExtrato) => number) => d.extratos.reduce((s, l) => s + fn(l), 0);
  const totalExtTRM = somaExt((l) => l.saldoTRM);

  const irPara = (a: Aba) => {
    setAba(a);
    if (a === "gl") {
      setGrupo(null);
      setSomenteDivergentes(d.glDiv.length ? "divergentes" : "todas");
    }
  };

  // -------------------------------------------------------------------------
  // Exportação
  // -------------------------------------------------------------------------

  const exportar = () =>
    exportarExcel(
      `C05_Fechamento_Conciliacao_${db}.xlsx`,
      [
        {
          nome: "TRM x FI-GL",
          titulo: "C05 – Conciliação TRM × FI-GL por conta contábil",
          subtitulo: `Saldos em R$ · diferença = FI-GL − TRM · tolerância ${TOLERANCIA}`,
          colunas: [
            { titulo: "Conta", largura: 14 },
            { titulo: "Descrição", largura: 70 },
            { titulo: "Grupo contábil", largura: 14 },
            { titulo: "Saldo TRM (R$)", tipo: "moeda", largura: 18 },
            { titulo: "Saldo FI-GL (R$)", tipo: "moeda", largura: 18 },
            { titulo: "Diferença (R$)", tipo: "moeda", largura: 14 },
            { titulo: "Status", largura: 13 },
            { titulo: "Motivo", largura: 90 },
          ],
          linhas: d.gl.map((l) => [l.conta.conta, l.conta.descricao, l.conta.grupo, l.saldoTRM, l.saldoGL, l.diferenca, l.status, l.motivo ?? ""]),
          total: [
            "Total",
            "",
            "",
            somaGL(d.gl, (l) => l.saldoTRM),
            somaGL(d.gl, (l) => l.saldoGL),
            somaGL(d.gl, (l) => l.diferenca),
            `${glOk}/${d.gl.length} conciliadas`,
            "",
          ],
          notas: [
            `Tolerância de conciliação: diferenças de até ${TOLERANCIA} por conta são consideradas conciliadas.`,
            "Saldo TRM = posição pelo custo amortizado (principal atualizado, juros a pagar e custos de transação a apropriar como redutora).",
            "Total do saldo TRM = saldo contábil da carteira de captações (C00).",
          ],
        },
        {
          nome: "TRM x Extratos",
          titulo: "C05 – Conciliação TRM × extratos por contrato",
          subtitulo: "Saldo devedor em R$ (principal atualizado + juros a pagar) · diferença = extrato − TRM",
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Instrumento", largura: 56 },
            { titulo: "Fonte do extrato", largura: 50 },
            { titulo: "Principal atualizado (R$)", tipo: "moeda", largura: 18 },
            { titulo: "Juros a pagar (R$)", tipo: "moeda", largura: 16 },
            { titulo: "Saldo TRM (R$)", tipo: "moeda", largura: 18 },
            { titulo: "Saldo extrato (R$)", tipo: "moeda", largura: 18 },
            { titulo: "Diferença (R$)", tipo: "moeda", largura: 14 },
            { titulo: "Status", largura: 16 },
            { titulo: "Motivo", largura: 90 },
          ],
          linhas: d.extratos.map((l) => [
            l.pos.c.id,
            l.pos.c.instrumento,
            l.fonte,
            l.pos.principalAtualizado,
            l.pos.jurosAPagar,
            l.saldoTRM,
            l.saldoExtrato,
            l.diferenca,
            l.status,
            l.motivo ?? "",
          ]),
          total: [
            "Total",
            "",
            "",
            somaExt((l) => l.pos.principalAtualizado),
            somaExt((l) => l.pos.jurosAPagar),
            totalExtTRM,
            somaExt((l) => l.saldoExtrato),
            somaExt((l) => l.diferenca),
            `${extOk}/${d.extratos.length} conciliados`,
            "",
          ],
          notas: [
            `Arredondamento: diferença de centavos (PU × quantidade) dentro da tolerância de ${TOLERANCIA}.`,
            `Saldos TRM calculados com os dados de mercado importados do SAP (último dado disponível: ${fmtDate(ultimoDadoNaDataBase(db))}).`,
            "Os custos de transação a apropriar não constam dos extratos e não entram nesta conciliação.",
          ],
        },
        {
          nome: "Checagens",
          titulo: "C05 – Checagens de integridade do fechamento",
          subtitulo: `${d.checagensOk} de ${d.checagens.length} checagens OK`,
          colunas: [
            { titulo: "Nº", tipo: "inteiro", largura: 6 },
            { titulo: "Checagem", largura: 64 },
            { titulo: "Resultado", largura: 12 },
            { titulo: "Detalhe", largura: 70 },
          ],
          linhas: d.checagens.map((c, i) => [i + 1, c.descricao, c.ok ? "OK" : "Falha", c.detalhe]),
        },
        {
          nome: "Checklist SAP",
          titulo: "C05 – Checklist de fechamento SAP (DU-2 a DU+3)",
          subtitulo: `${d.etapasConcluidas} de ${d.checklist.length} etapas concluídas · DU-1 = último dia útil do mês`,
          colunas: [
            { titulo: "Dia", largura: 8 },
            { titulo: "Data", tipo: "data", largura: 12 },
            { titulo: "Etapa", largura: 72 },
            { titulo: "Transação SAP", largura: 14 },
            { titulo: "Responsável", largura: 18 },
            { titulo: "Status", largura: 16 },
          ],
          linhas: d.checklist.map((e) => [e.dia, dataDoDiaUtil(db, e.dia), e.etapa, e.transacao ?? "", e.responsavel, e.status]),
        },
      ],
      db,
    );

  // -------------------------------------------------------------------------
  // Colunas
  // -------------------------------------------------------------------------

  const colGL: Column<LinhaConciliacaoGL>[] = [
    {
      key: "conta",
      header: "Conta",
      minWidth: 110,
      value: (l) => l.conta.conta,
      render: (l) => <span className="font-semibold tabular whitespace-nowrap">{l.conta.conta}</span>,
    },
    {
      key: "descricao",
      header: "Descrição",
      minWidth: 300,
      value: (l) => rubricaConta(l.conta.descricao),
      render: (l) => (
        <span title={l.conta.descricao} className="xl:whitespace-nowrap">
          {rubricaConta(l.conta.descricao)}
        </span>
      ),
      total: (rows) => <span className="text-label font-semibold">{plural(rows.length, "conta", "contas")}</span>,
    },
    {
      key: "grupo",
      header: "Grupo",
      minWidth: 100,
      value: (l) => l.conta.grupo,
      render: (l) => <Tag color={COR_GRUPO[l.conta.grupo]}>{l.conta.grupo}</Tag>,
    },
    {
      key: "trm",
      header: "Saldo TRM (R$)",
      align: "right",
      minWidth: 140,
      value: (l) => l.saldoTRM,
      render: (l) => fmtValor(l.saldoTRM),
      total: (rows) => fmtValor(somaGL(rows, (l) => l.saldoTRM)),
    },
    {
      key: "gl",
      header: "Saldo FI-GL (R$)",
      align: "right",
      minWidth: 140,
      value: (l) => l.saldoGL,
      render: (l) => fmtValor(l.saldoGL),
      total: (rows) => fmtValor(somaGL(rows, (l) => l.saldoGL)),
    },
    {
      key: "dif",
      header: "Diferença (R$)",
      headerTitle: "FI-GL − TRM",
      align: "right",
      minWidth: 120,
      value: (l) => l.diferenca,
      render: (l) => <Diferenca valor={l.diferenca} />,
      total: (rows) => <Diferenca valor={somaGL(rows, (l) => l.diferenca)} forte />,
    },
    {
      key: "status",
      header: "Status",
      minWidth: 120,
      value: (l) => l.status,
      render: (l) => <ObjectStatus state={STATUS_GL[l.status]}>{l.status}</ObjectStatus>,
    },
    {
      key: "motivo",
      header: "Motivo",
      minWidth: 240,
      sortable: false,
      render: (l) => (l.motivo ? <span className="text-[13px] leading-snug block">{l.motivo}</span> : <span className="text-label">—</span>),
    },
  ];

  const colExt: Column<LinhaConciliacaoExtrato>[] = [
    {
      key: "contrato",
      header: "Contrato",
      minWidth: 210,
      value: (l) => l.pos.c.id,
      render: (l) => (
        <div className="py-0.5">
          <div className="font-semibold text-text">{l.pos.c.id}</div>
          <div className="text-xs text-label leading-snug mt-0.5">{l.pos.c.instrumento}</div>
        </div>
      ),
      total: (rows) => plural(rows.length, "contrato", "contratos"),
    },
    {
      key: "fonte",
      header: "Fonte do extrato",
      minWidth: 190,
      value: (l) => l.fonte,
      render: (l) => <span className="text-[13px] leading-snug block">{l.fonte}</span>,
    },
    {
      key: "trm",
      header: "Saldo TRM (R$)",
      headerTitle: "Principal atualizado + juros a pagar",
      align: "right",
      minWidth: 150,
      value: (l) => l.saldoTRM,
      render: (l) => (
        <div>
          <div>{fmtValor(l.saldoTRM)}</div>
          <div className="text-xs text-label">
            {fmtCompact(l.pos.principalAtualizado)} + {fmtCompact(l.pos.jurosAPagar)}
          </div>
        </div>
      ),
      total: () => fmtValor(totalExtTRM),
    },
    {
      key: "extrato",
      header: "Saldo extrato (R$)",
      align: "right",
      minWidth: 140,
      value: (l) => l.saldoExtrato,
      render: (l) => fmtValor(l.saldoExtrato),
      total: () => fmtValor(somaExt((l) => l.saldoExtrato)),
    },
    {
      key: "dif",
      header: "Diferença (R$)",
      headerTitle: "Extrato − TRM",
      align: "right",
      minWidth: 110,
      value: (l) => l.diferenca,
      render: (l) => <Diferenca valor={l.diferenca} />,
      total: () => <Diferenca valor={somaExt((l) => l.diferenca)} forte />,
    },
    {
      key: "status",
      header: "Status",
      minWidth: 140,
      value: (l) => l.status,
      render: (l) => <ObjectStatus state={STATUS_EXTRATO[l.status]}>{l.status}</ObjectStatus>,
    },
    {
      key: "motivo",
      header: "Motivo",
      minWidth: 250,
      sortable: false,
      render: (l) =>
        l.motivo ? (
          <span className={clsx("text-[13px] leading-snug block", l.status !== "Divergente" && "text-label")}>{l.motivo}</span>
        ) : (
          <span className="text-label">—</span>
        ),
    },
  ];

  const statusExtratos = (["Conciliado", "Arredondamento", "Divergente"] as const).map((s) => ({
    status: s,
    qtd: d.extratos.filter((l) => l.status === s).length,
  }));

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi
            label="Contas conciliadas"
            value={`${glOk}/${d.gl.length}`}
            state={d.glDiv.length ? "critical" : "positive"}
            sub="TRM × FI-GL"
          />
          <HeaderKpi
            label="Extratos conciliados"
            value={`${extOk}/${d.extratos.length}`}
            state={d.extDiv.length ? "critical" : "positive"}
            sub="TRM × extratos"
          />
          <HeaderKpi
            label="Checagens OK"
            value={`${d.checagensOk}/${d.checagens.length}`}
            state={d.checagensOk < d.checagens.length ? "critical" : "positive"}
            sub="integridade"
          />
          <HeaderKpi
            label="Etapas concluídas"
            value={`${d.etapasConcluidas}/${d.checklist.length}`}
            state={d.etapasConcluidas < d.checklist.length ? "critical" : "positive"}
            sub="checklist DU-2 a DU+3"
          />
          <HeaderKpi
            label="Maior diferença"
            value={fmtBRL(maiorAbs, true)}
            state={maiorForaTolerancia ? "negative" : "positive"}
            sub={
              d.maior && maiorAbs >= 0.005
                ? `${d.maior.onde} · ${d.maior.fonte} ${d.maior.valor < 0 ? "a menor" : "a maior"}`
                : "sem diferenças"
            }
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
              { value: "checagens", label: "Checagens de integridade", count: d.checagens.length },
              { value: "checklist", label: "Checklist SAP", count: d.checklist.length },
            ]}
          />
        </div>
      }
    >
      {/* Resumo das pendências da data-base */}
      {qtdPendencias === 0 ? (
        <MessageStrip design="positive">
          <strong>Fechamento de {fmtDate(db)} sem pendências:</strong> {d.gl.length} contas TRM × FI-GL e {d.extratos.length}{" "}
          extratos conciliados dentro da tolerância de {TOLERANCIA}, {d.checagensOk} de {d.checagens.length} checagens de
          integridade OK e {d.etapasConcluidas} de {d.checklist.length} etapas do checklist concluídas
          {d.etapasConcluidas === d.checklist.length ? " – período aprovado pela Controladoria." : "."}
        </MessageStrip>
      ) : (
        <MessageStrip design="critical">
          <strong>
            Fechamento de {fmtDate(db)} com {plural(qtdPendencias, "pendência", "pendências")} acima da tolerância de {TOLERANCIA}:
          </strong>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {d.glDiv.map((l) => (
              <li key={l.conta.conta}>
                Conta <strong className="tabular">{l.conta.conta}</strong> ({l.conta.grupo} – {rubricaConta(l.conta.descricao).toLowerCase()}): saldo
                do FI-GL {fmtBRL(Math.abs(l.diferenca), true)} {l.diferenca < 0 ? "menor" : "maior"} que o TRM.{" "}
                <LinkAcao onClick={() => irPara("gl")}>Ver conciliação</LinkAcao>
              </li>
            ))}
            {d.extDiv.map((l) => (
              <li key={l.pos.c.id}>
                Extrato do <strong>{l.pos.c.id}</strong>: saldo {fmtBRL(Math.abs(l.diferenca), true)}{" "}
                {l.diferenca < 0 ? "menor" : "maior"} que o TRM. <LinkAcao onClick={() => irPara("extratos")}>Ver conciliação</LinkAcao>
              </li>
            ))}
            {outrasFalhas.map((c) => (
              <li key={c.id}>
                {c.descricao}: {c.detalhe}. <LinkAcao onClick={() => irPara("checagens")}>Ver checagens</LinkAcao>
              </li>
            ))}
          </ul>
          {aprovacao && aprovacao.status !== "Concluído" && dataAprovacao && (
            <p className="mt-1">
              Checklist com {d.etapasConcluidas} de {d.checklist.length} etapas concluídas; a aprovação da Controladoria ({aprovacao.dia},{" "}
              {fmtDate(dataAprovacao)}) aguarda a regularização.
            </p>
          )}
        </MessageStrip>
      )}

      {/* ------------------------------------------------------------------ TRM × FI-GL */}
      {aba === "gl" && (
        <>
          {reclassificados.size > 0 && (
            <MessageStrip design="information">
              {[...reclassificados].sort().join(" e ")} {reclassificados.size === 1 ? "está reclassificado" : "estão reclassificados"}{" "}
              integralmente para o circulante nesta data-base (covenant descumprido sem waiver – CPC 26, item 74). As contas de
              principal e custos circulantes do BNDES incluem o saldo reclassificado, tanto no TRM quanto no FI-GL.{" "}
              <Link to="/c04-covenants" className="text-link font-semibold hover:underline">
                Ver C04 – Covenants
              </Link>
            </MessageStrip>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 no-print">
            {d.porGrupo.map((g) => {
              const ativo = grupo === g.grupo;
              return (
                <button
                  key={g.grupo}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setGrupo(ativo ? null : g.grupo)}
                  className={clsx(
                    "text-left bg-white rounded-[var(--radius-card)] shadow-fiori px-3 sm:px-4 py-3 min-w-0 transition-shadow hover:shadow-fiori-lg",
                    ativo && "shadow-[inset_0_0_0_2px_#0070f2]!",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.cor }} />
                    <span className="text-sm font-bold text-text truncate">{g.grupo}</span>
                  </div>
                  <div className="text-xs text-label truncate mt-0.5" title={g.nome}>
                    {g.nome}
                  </div>
                  <div className="text-lg sm:text-xl font-light text-text tabular mt-1.5 whitespace-nowrap">{fmtCompact(g.saldoTRM)}</div>
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mt-1">
                    <span className="text-xs text-label">{plural(g.contas, "conta", "contas")}</span>
                    {g.divergentes ? (
                      <ObjectStatus state="negative">{plural(g.divergentes, "divergente", "divergentes")}</ObjectStatus>
                    ) : (
                      <ObjectStatus state="positive">Conciliado</ObjectStatus>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <Card
            title="Conciliação TRM × FI-GL por conta contábil"
            subtitle={`Saldos em R$ na data-base ${fmtDate(db)} · diferença = FI-GL − TRM`}
            bodyClassName="px-0! pb-0!"
            className="min-w-0 overflow-hidden"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
              <span className="text-[13px] text-label">
                {linhasGL.length} de {d.gl.length} contas
                {grupo && (
                  <>
                    {" "}
                    · grupo <strong className="text-text">{grupo}</strong> ·{" "}
                    <button type="button" className="text-link font-semibold hover:underline" onClick={() => setGrupo(null)}>
                      Limpar filtro
                    </button>
                  </>
                )}
              </span>
              <SegmentedButton
                value={somenteDivergentes}
                onChange={setSomenteDivergentes}
                items={[
                  { value: "todas", label: "Todas" },
                  { value: "divergentes", label: `Divergentes (${d.glDiv.length})` },
                ]}
              />
            </div>

            <div className="hidden lg:block border-t border-line-soft">
              <DataTable
                columns={colGL}
                rows={linhasGL}
                rowKey={(l) => l.conta.conta}
                showTotals
                rowClassName={(l) => (l.status === "Divergente" ? DESTAQUE_DIVERGENTE : undefined)}
                emptyText="Nenhuma conta divergente no filtro selecionado"
              />
            </div>

            {/* Pop-in (sap.m.Table responsiva) */}
            <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
              {linhasGL.length === 0 && <li className="px-4 py-8 text-center text-sm text-label">Nenhuma conta divergente no filtro selecionado</li>}
              {linhasGL.map((l) => (
                <li
                  key={l.conta.conta}
                  className={clsx("px-4 py-3", l.status === "Divergente" && "bg-[#fff6f9] shadow-[inset_4px_0_0_#f53232]")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-text tabular">{l.conta.conta}</span>
                        <Tag color={COR_GRUPO[l.conta.grupo]}>{l.conta.grupo}</Tag>
                      </div>
                      <div className="text-xs text-label leading-snug mt-0.5">{rubricaConta(l.conta.descricao)}</div>
                    </div>
                    <ObjectStatus state={STATUS_GL[l.status]}>{l.status}</ObjectStatus>
                  </div>
                  <PopInValores rotulo="FI-GL (R$)" trm={l.saldoTRM} outro={l.saldoGL} dif={l.diferenca} />
                  {l.motivo && <p className="text-xs text-text leading-snug mt-2">{l.motivo}</p>}
                </li>
              ))}
              {linhasGL.length > 0 && (
                <li className="px-4 py-3 bg-[#f5f6f7]">
                  <div className="text-sm font-bold text-text">Total · {plural(linhasGL.length, "conta", "contas")}</div>
                  <PopInValores
                    rotulo="FI-GL (R$)"
                    trm={somaGL(linhasGL, (l) => l.saldoTRM)}
                    outro={somaGL(linhasGL, (l) => l.saldoGL)}
                    dif={somaGL(linhasGL, (l) => l.diferenca)}
                    forte
                  />
                </li>
              )}
            </ul>

            <ul className="text-xs text-label px-4 py-3 space-y-1 leading-relaxed border-t border-line-soft">
              <li>
                (i) Tolerância de conciliação: diferenças de até <strong className="text-text">{TOLERANCIA}</strong> por conta são
                consideradas conciliadas; acima disso a conta fica divergente e bloqueia a aprovação do período.
              </li>
              <li>
                (ii) Saldo TRM = posição pelo custo amortizado na data-base: principal atualizado, juros a pagar e custos de
                transação a apropriar (redutora, com sinal negativo). O total de todas as contas ({fmtBRL(d.totalContabil, true)})
                é o saldo contábil da carteira (
                <Link to="/c00-carteira" className="text-link hover:underline">
                  C00
                </Link>
                ).
              </li>
              <li>(iii) Saldo FI-GL = saldo das contas do passivo de captações no razão (ambiente de teste), após TBB1, TPM44 e TPM1.</li>
            </ul>
          </Card>
        </>
      )}

      {/* ------------------------------------------------------------------ TRM × extratos */}
      {aba === "extratos" && (
        <Card
          title="Conciliação TRM × extratos por contrato"
          subtitle="Saldo devedor em R$ (principal atualizado + juros a pagar) · diferença = extrato − TRM"
          bodyClassName="px-0! pb-0!"
          className="min-w-0 overflow-hidden"
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 pb-3">
            {statusExtratos.map((s) => (
              <span key={s.status} className="inline-flex items-center gap-1.5 text-[13px]">
                <ObjectStatus state={STATUS_EXTRATO[s.status]}>{s.status}</ObjectStatus>
                <span className="text-text font-semibold tabular">{s.qtd}</span>
              </span>
            ))}
          </div>

          <div className="hidden lg:block border-t border-line-soft">
            <DataTable
              columns={colExt}
              rows={d.extratos}
              rowKey={(l) => l.pos.c.id}
              showTotals
              rowClassName={(l) => (l.status === "Divergente" ? DESTAQUE_DIVERGENTE : undefined)}
            />
          </div>

          <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
            {d.extratos.map((l) => (
              <li
                key={l.pos.c.id}
                className={clsx("px-4 py-3", l.status === "Divergente" && "bg-[#fff6f9] shadow-[inset_4px_0_0_#f53232]")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text">{l.pos.c.id}</div>
                    <div className="text-xs text-label leading-snug mt-0.5">{l.pos.c.instrumento}</div>
                  </div>
                  <ObjectStatus state={STATUS_EXTRATO[l.status]}>{l.status}</ObjectStatus>
                </div>
                <div className="text-xs text-label leading-snug mt-1.5">
                  <span className="text-text">Fonte:</span> {l.fonte}
                </div>
                <PopInValores rotulo="Extrato (R$)" trm={l.saldoTRM} outro={l.saldoExtrato} dif={l.diferenca} />
                {l.status === "Divergente" && l.motivo && <p className="text-xs text-text leading-snug mt-2">{l.motivo}</p>}
              </li>
            ))}
            <li className="px-4 py-3 bg-[#f5f6f7]">
              <div className="text-sm font-bold text-text">Total · {plural(d.extratos.length, "contrato", "contratos")}</div>
              <PopInValores
                rotulo="Extrato (R$)"
                trm={totalExtTRM}
                outro={somaExt((l) => l.saldoExtrato)}
                dif={somaExt((l) => l.diferenca)}
                forte
              />
            </li>
          </ul>

          <ul className="text-xs text-label px-4 py-3 space-y-1 leading-relaxed border-t border-line-soft">
            <li>
              (i) Arredondamento: diferença de centavos no cálculo por PU × quantidade, dentro da tolerância de{" "}
              <strong className="text-text">{TOLERANCIA}</strong> – conta como conciliado.
            </li>
            <li>
              (ii) Saldos do TRM calculados com os dados de mercado importados do SAP (último dado disponível:{" "}
              {fmtDate(ultimoDadoNaDataBase(db))}); a projeção dos fluxos futuros usa esse mesmo último dado e não entra
              na conciliação.
            </li>
            <li>
              (iii) Os extratos não trazem os custos de transação a apropriar: saldo TRM dos extratos ({fmtBRL(totalExtTRM, true)}) −
              custos a apropriar ({fmtBRL(d.custosAApropriar, true)}) = saldo contábil ({fmtBRL(d.totalContabil, true)}), igual ao
              total da aba TRM × FI-GL.
            </li>
          </ul>
        </Card>
      )}

      {/* ------------------------------------------------------------------ Checagens */}
      {aba === "checagens" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <Card
            className="xl:col-span-2 min-w-0"
            title="Checagens de integridade"
            subtitle={`Validações automáticas da carteira de captações na data-base ${fmtDate(db)}`}
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

          <div className="space-y-5 min-w-0">
            <Card title="Resultado" subtitle="Checagens aprovadas na data-base">
              <div className="flex items-baseline gap-1.5">
                <span
                  className={clsx(
                    "text-[2.25rem] leading-none font-light tabular",
                    d.checagensOk === d.checagens.length ? "text-positive" : "text-critical",
                  )}
                >
                  {d.checagensOk}/{d.checagens.length}
                </span>
                <span className="text-sm text-label">checagens OK</span>
              </div>
              <MicroBar
                className="mt-3 h-2"
                value={d.checagensOk}
                max={d.checagens.length}
                color={d.checagensOk === d.checagens.length ? "#30914c" : "#e76500"}
              />
              <p className="text-xs text-label mt-3 leading-relaxed">
                As checagens cruzam a carteira (C00), a movimentação (C01), o cronograma (C02) e as conciliações desta tela. A
                aprovação da Controladoria exige todas as checagens OK.
              </p>
            </Card>

            <Card title="Pendências a regularizar" subtitle={d.glDiv.length + d.extDiv.length ? "Motivo apurado e ação sugerida" : undefined}>
              {d.glDiv.length + d.extDiv.length === 0 && outrasFalhas.length === 0 ? (
                <div className="flex items-start gap-2 text-[13px] text-text">
                  <CheckCircle2 className="w-4 h-4 text-positive shrink-0 mt-px" />
                  Nenhuma pendência – conciliações dentro da tolerância e período pronto para aprovação.
                </div>
              ) : (
                <ul className="space-y-3">
                  {d.glDiv.map((l) => (
                    <Pendencia
                      key={l.conta.conta}
                      titulo={`Conta ${l.conta.conta} · FI-GL`}
                      valor={l.diferenca}
                      motivo={l.motivo}
                      onVer={() => irPara("gl")}
                    />
                  ))}
                  {d.extDiv.map((l) => (
                    <Pendencia
                      key={l.pos.c.id}
                      titulo={`${l.pos.c.id} · extrato`}
                      valor={l.diferenca}
                      motivo={l.motivo}
                      onVer={() => irPara("extratos")}
                    />
                  ))}
                  {outrasFalhas.map((c) => (
                    <li key={c.id} className="text-[13px]">
                      <div className="font-semibold text-text">{c.descricao}</div>
                      <div className="text-label mt-0.5">{c.detalhe}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ Checklist SAP */}
      {aba === "checklist" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <Card
            className="xl:col-span-2 min-w-0"
            title="Checklist de fechamento SAP"
            subtitle="Calendário DU-2 a DU+3 · DU-1 = último dia útil do mês; DU+1 = primeiro dia útil seguinte (feriados nacionais – ANBIMA)"
          >
            <ol>
              {d.dias.map((g, gi) => {
                const pend = g.etapas.some((e) => e.status === "Com pendência");
                const aberta = g.etapas.some((e) => e.status !== "Concluído");
                const cor = pend ? "#e76500" : aberta ? "#758ca4" : "#30914c";
                const ultimo = gi === d.dias.length - 1;
                return (
                  <li key={g.dia} className="grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] sm:grid-cols-[6.5rem_2rem_minmax(0,1fr)]">
                    <div className="text-right pt-2">
                      <div className="text-sm font-bold text-text">{g.dia}</div>
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
                            "rounded-lg border px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4",
                            e.status === "Com pendência" ? "border-[#e76500]/50 bg-critical-bg/40" : "border-line-soft",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-text leading-snug">{e.etapa}</div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-label">
                              {e.transacao && (
                                <span className="inline-flex items-center gap-1">
                                  Transação <Tag color="#0070f2">{e.transacao}</Tag>
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1">
                                <UserRound className="w-3.5 h-3.5" />
                                {e.responsavel}
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0">
                            <ObjectStatus inverted state={STATUS_ETAPA[e.status]}>
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
            <Card title="Andamento do fechamento" subtitle={`Data-base ${fmtDate(db)}`}>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={clsx(
                    "text-[2.25rem] leading-none font-light tabular",
                    d.etapasConcluidas === d.checklist.length ? "text-positive" : "text-critical",
                  )}
                >
                  {d.etapasConcluidas}/{d.checklist.length}
                </span>
                <span className="text-sm text-label">etapas concluídas</span>
              </div>
              <MicroBar
                className="mt-3 h-2"
                value={d.etapasConcluidas}
                max={d.checklist.length}
                color={d.etapasConcluidas === d.checklist.length ? "#30914c" : "#e76500"}
              />
              <div className="text-[13px] font-semibold text-text mt-5 mb-2">Por responsável</div>
              <ul className="space-y-2.5">
                {d.responsaveis.map((r) => (
                  <li key={r.responsavel}>
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="text-text truncate">{r.responsavel}</span>
                      <span className="tabular text-label whitespace-nowrap">
                        <span className="text-text font-semibold">{r.concluidas}</span> de {r.total}
                      </span>
                    </div>
                    <MicroBar
                      className="mt-1.5"
                      value={r.concluidas}
                      max={r.total}
                      color={r.concluidas === r.total ? "#30914c" : "#e76500"}
                    />
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Transações SAP do fechamento" subtitle="SAP S/4HANA Treasury and Risk Management">
              <ul className="space-y-3">
                {TRANSACOES_SAP.map((t) => (
                  <li key={t.codigo} className="flex items-start gap-3 text-[13px]">
                    <span className="w-14 shrink-0">
                      <Tag color="#0070f2">{t.codigo}</Tag>
                    </span>
                    <span className="text-text leading-snug">{t.descricao}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-label mt-3 leading-relaxed">
                Os dados de mercado usados na avaliação (TPM1) e na apropriação (TPM44) são os importados do SAP até a data-base;
                as parcelas futuras são projetadas com o último dado disponível.
              </p>
            </Card>
          </div>
        </div>
      )}
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Componentes auxiliares
// ---------------------------------------------------------------------------

function Diferenca({ valor, forte }: { valor: number; forte?: boolean }) {
  const fora = Math.abs(valor) > TOLERANCIA_CONCILIACAO;
  const zero = Math.abs(valor) < 0.005;
  return (
    <span className={clsx("tabular whitespace-nowrap", fora ? "text-negative font-bold" : zero ? "text-label" : "text-text", forte && !fora && "font-bold")}>
      {fmtDif(valor)}
    </span>
  );
}

/** Colunas "pop-in" da tabela responsiva: saldo TRM × saldo comparado × diferença */
function PopInValores({ rotulo, trm, outro, dif, forte }: { rotulo: string; trm: number; outro: number; dif: number; forte?: boolean }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-3 mt-2 text-[13px]">
      <div className="min-w-0">
        <dt className="text-xs text-label">TRM (R$)</dt>
        <dd className="text-text font-semibold tabular">{fmtValor(trm)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-label">{rotulo}</dt>
        <dd className="text-text font-semibold tabular">{fmtValor(outro)}</dd>
      </div>
      <div className="text-right">
        <dt className="text-xs text-label">Dif. (R$)</dt>
        <dd className="font-semibold">
          <Diferenca valor={dif} forte={forte} />
        </dd>
      </div>
    </dl>
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

function Pendencia({ titulo, valor, motivo, onVer }: { titulo: string; valor: number; motivo: string | null; onVer: () => void }) {
  return (
    <li className="rounded-lg border border-[#f53232]/30 bg-[#fff6f9] px-3 py-2.5 text-[13px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-text tabular">{titulo}</span>
        <span className="tabular font-bold text-negative whitespace-nowrap">R$ {fmtDif(valor)}</span>
      </div>
      {motivo && <p className="text-text leading-snug mt-1">{motivo}</p>}
      <div className="mt-1.5">
        <LinkAcao onClick={onVer}>Ver conciliação</LinkAcao>
      </div>
    </li>
  );
}
