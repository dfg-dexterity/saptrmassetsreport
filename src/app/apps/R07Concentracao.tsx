import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../components/fiori/Card";
import { DataTable, type Column } from "../components/fiori/DataTable";
import { FilterField, Select } from "../components/fiori/Inputs";
import { AXIS_STYLE, CHART_COLORS, CHART_SEMANTIC, HeaderKpi, MicroBar } from "../components/fiori/Kpi";
import { ObjectStatus, semaforoState, Tag } from "../components/fiori/ObjectStatus";
import { ReportPage } from "../components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { LIMITE_POR_RATING } from "../data/carteira";
import { ESCOPOS, useCarteira, type Escopo } from "../context/useDados";
import { exportarExcel } from "../lib/exportar";
import { FAIXAS_PRAZO } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtInt, fmtNum, fmtPct } from "../lib/format";
import {
  avaliarPolitica,
  classificarHHI,
  concentracaoPorGrupo,
  distribuicao,
  hhi,
  SEMAFORO_TEXTO,
  totalCarteira,
  type Fatia,
  type GrupoExposicao,
  type ResultadoRegra,
} from "../lib/indicadores";

const rel = relatorioPorId("r07");

const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

export function R07Concentracao() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, posicoes } = useCarteira(escopo);

  const d = useMemo(() => {
    const grupos = concentracaoPorGrupo(posicoes);
    const indice = hhi(grupos.map((g) => g.share));
    return {
      grupos,
      indice,
      classe: classificarHHI(indice),
      produto: distribuicao(posicoes, (x) => x.op.produto),
      indexador: distribuicao(posicoes, (x) => x.op.indexador),
      prazo: distribuicao(posicoes, (x) => x.faixaPrazo, FAIXAS_PRAZO),
      politica: avaliarPolitica(posicoes),
      total: totalCarteira(posicoes),
    };
  }, [posicoes]);

  const enquadradas = d.politica.filter((r) => r.status !== "excedido").length + d.grupos.filter((g) => g.status !== "excedido").length;
  const totalRegras = d.politica.length + d.grupos.length;

  const colunas: Column<GrupoExposicao>[] = [
    {
      key: "grupo",
      header: "Grupo econômico",
      value: (g) => g.grupo,
      render: (g) => (
        <div>
          <div className="font-semibold text-text">{g.grupo}</div>
          <div className="text-xs text-label">{g.contrapartes.join(", ")}</div>
        </div>
      ),
    },
    { key: "rating", header: "Rating", value: (g) => g.rating, render: (g) => <Tag>{g.rating}</Tag> },
    { key: "ops", header: "Operações", align: "right", value: (g) => g.operacoes, total: (r) => fmtInt(r.reduce((s, g) => s + g.operacoes, 0)) },
    { key: "valor", header: "Exposição (R$)", align: "right", value: (g) => g.valor, render: (g) => fmtNum(g.valor), total: (r) => fmtNum(r.reduce((s, g) => s + g.valor, 0)) },
    { key: "share", header: "% carteira", align: "right", value: (g) => g.share, render: (g) => fmtPct(g.share, 1), total: () => "100,0%" },
    { key: "limite", header: "Limite política", align: "right", value: (g) => g.limite, render: (g) => (g.limite >= 1 ? "Sem limite" : fmtPct(g.limite, 0)) },
    {
      key: "uso",
      header: "Utilização do limite",
      value: (g) => g.utilizacao,
      minWidth: 200,
      render: (g) => (
        <div className="flex items-center gap-2">
          <MicroBar
            value={g.utilizacao}
            max={1.2}
            marker={1}
            className="flex-1 h-2"
            color={g.status === "ok" ? CHART_SEMANTIC.good : g.status === "atencao" ? CHART_SEMANTIC.critical : CHART_SEMANTIC.bad}
          />
          <span className="tabular text-[13px] w-12 text-right">{fmtPct(g.utilizacao, 0)}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Semáforo",
      value: (g) => g.utilizacao,
      render: (g) => <ObjectStatus state={semaforoState(g.status)}>{SEMAFORO_TEXTO[g.status]}</ObjectStatus>,
    },
  ];

  const exportar = () =>
    exportarExcel(
      `R07_Concentracao_${p.dataBase}.xlsx`,
      [
        {
          nome: "Por contraparte",
          titulo: "R07 – Concentração da carteira: exposição por grupo econômico",
          subtitulo: ESCOPOS.find((e) => e.value === escopo)!.label,
          colunas: [
            { titulo: "Grupo econômico", largura: 24 },
            { titulo: "Contrapartes", largura: 40 },
            { titulo: "Rating", largura: 10 },
            { titulo: "Operações", tipo: "inteiro" },
            { titulo: "Exposição (R$)", tipo: "moeda" },
            { titulo: "% carteira", tipo: "pct" },
            { titulo: "Limite", tipo: "pct" },
            { titulo: "Utilização", tipo: "pct" },
            { titulo: "Semáforo", largura: 16 },
          ],
          linhas: d.grupos.map((g) => [g.grupo, g.contrapartes.join(", "), g.rating, g.operacoes, g.valor, g.share, g.limite, g.utilizacao, SEMAFORO_TEXTO[g.status]]),
          total: ["TOTAL", "", "", d.grupos.reduce((s, g) => s + g.operacoes, 0), d.total, 1, "", "", ""],
          notas: [`Índice HHI: ${fmtInt(d.indice)} (${d.classe.rotulo})`],
        },
        ...(
          [
            ["Por produto", "Exposição por tipo de produto", d.produto],
            ["Por indexador", "Exposição por indexador", d.indexador],
            ["Por prazo", "Exposição por prazo remanescente", d.prazo],
          ] as [string, string, Fatia[]][]
        ).map(([nome, titulo, fatias]) => ({
          nome,
          titulo: `R07 – ${titulo}`,
          colunas: [{ titulo: "Categoria", largura: 24 }, { titulo: "Operações", tipo: "inteiro" as const }, { titulo: "Exposição (R$)", tipo: "moeda" as const }, { titulo: "% carteira", tipo: "pct" as const }],
          linhas: fatias.map((f) => [f.chave, f.qtd, f.valor, f.share]),
          total: ["TOTAL", fatias.reduce((s, f) => s + f.qtd, 0), d.total, 1],
        })),
        {
          nome: "Política",
          titulo: "R07 – Enquadramento na política de investimentos",
          colunas: [{ titulo: "Regra", largura: 50 }, { titulo: "Tipo", largura: 10 }, { titulo: "Limite", tipo: "pct" }, { titulo: "Atual", tipo: "pct" }, { titulo: "Valor (R$)", tipo: "moeda" }, { titulo: "Status", largura: 16 }],
          linhas: d.politica.map((r) => [r.regra, r.tipo === "max" ? "Máximo" : "Mínimo", r.limite, r.share, r.valor, SEMAFORO_TEXTO[r.status]]),
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
          <HeaderKpi label="Índice HHI" value={fmtInt(d.indice)} state={semaforoState(d.classe.status)} sub={d.classe.rotulo} />
          <HeaderKpi label="Maior exposição" value={d.grupos[0] ? fmtPct(d.grupos[0].share, 1) : "—"} sub={d.grupos[0]?.grupo} />
          <HeaderKpi label="Grupos econômicos" value={String(d.grupos.length)} sub={`${posicoes.length} operações`} />
          <HeaderKpi
            label="Enquadramento"
            value={`${enquadradas}/${totalRegras}`}
            state={enquadradas === totalRegras ? "positive" : "negative"}
            sub="regras e limites atendidos"
          />
        </>
      }
    >
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <FilterField label="Empresa">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <div className="sm:col-span-2 text-[13px] text-label sm:text-right">
            Limites por rating: {Object.entries(LIMITE_POR_RATING).map(([r, l]) => `${r} ${l >= 1 ? "sem limite" : fmtPct(l, 0)}`).join(" · ")}
          </div>
        </div>
      </div>

      <Card title="Exposição por contraparte (limite por banco)" subtitle="Consolidada por grupo econômico · saldo bruto na data-base" bodyClassName="px-0 pb-0">
        <DataTable columns={colunas} rows={d.grupos} rowKey={(g) => g.grupo} showTotals defaultSort={{ key: "valor", dir: "desc" }} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Donut titulo="Por tipo de produto" fatias={d.produto} />
        <Donut titulo="Por indexador" fatias={d.indexador} />
        <Card title="Por prazo remanescente" subtitle="Liquidez diária considerada em “Até 30 dias”">
          <div className="h-60 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.prazo.map((f) => ({ faixa: f.chave.replace(" dias", "d").replace("Acima de ", "> "), v: f.valor / 1e6, share: f.share }))}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="faixa" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} unit="mi" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _n, item) => [`${fmtBRL(v * 1e6)} (${fmtPct(item.payload.share, 1)})`, "Exposição"]} />
                <Bar dataKey="v" radius={[4, 4, 0, 0]} fill="#168eff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2" title="Enquadramento na política de investimentos" subtitle="Semáforo: verde enquadrado · amarelo ≥ 80% do limite · vermelho desenquadrado" bodyClassName="px-0 pb-0">
          <DataTable<ResultadoRegra>
            columns={[
              { key: "regra", header: "Regra", value: (r) => r.regra, render: (r) => <span className="font-semibold">{r.regra}</span> },
              { key: "tipo", header: "Limite", align: "right", value: (r) => r.limite, render: (r) => `${r.tipo === "max" ? "máx." : "mín."} ${fmtPct(r.limite, 0)}` },
              { key: "atual", header: "Atual", align: "right", value: (r) => r.share, render: (r) => <span className="font-semibold">{fmtPct(r.share, 1)}</span> },
              { key: "valor", header: "Valor", align: "right", value: (r) => r.valor, render: (r) => fmtCompact(r.valor) },
              { key: "status", header: "Status", value: (r) => r.status, render: (r) => <ObjectStatus state={semaforoState(r.status)}>{SEMAFORO_TEXTO[r.status]}</ObjectStatus> },
            ]}
            rows={d.politica}
            rowKey={(r) => r.id}
          />
        </Card>
        <Card title="Índice Herfindahl-Hirschman" subtitle="Soma dos quadrados das participações por grupo">
          <div className="text-4xl font-light tabular" style={{ color: d.classe.status === "ok" ? "#256f3a" : d.classe.status === "atencao" ? "#b44f00" : "#aa0808" }}>
            {fmtInt(d.indice)}
          </div>
          <ObjectStatus state={semaforoState(d.classe.status)} className="mt-1">
            {d.classe.rotulo}
          </ObjectStatus>
          <div className="relative mt-5 h-2.5 rounded-full overflow-hidden flex">
            <div className="h-full bg-[#30914c]" style={{ width: "30%" }} />
            <div className="h-full bg-[#e26300]" style={{ width: "20%" }} />
            <div className="h-full bg-[#f53232]" style={{ width: "50%" }} />
          </div>
          <div className="relative h-4">
            <div className="absolute -top-3.5 w-0.5 h-4 bg-text" style={{ left: `${Math.min(100, (d.indice / 5000) * 100)}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-label tabular -mt-1">
            <span>0</span>
            <span>1.500</span>
            <span>2.500</span>
            <span>5.000+</span>
          </div>
          <p className="text-xs text-label mt-4 leading-relaxed">
            HHI &lt; 1.500: baixa concentração · 1.500–2.500: moderada · &gt; 2.500: alta. Calculado sobre as participações
            por grupo econômico (0–10.000).
          </p>
        </Card>
      </div>
    </ReportPage>
  );
}

function Donut({ titulo, fatias }: { titulo: string; fatias: Fatia[] }) {
  return (
    <Card title={titulo}>
      <div className="flex items-center gap-4">
        <div className="w-36 h-36 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={fatias} dataKey="valor" nameKey="chave" innerRadius="58%" outerRadius="100%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
                {fatias.map((f, i) => (
                  <Cell key={f.chave} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n) => [fmtCompact(v), n]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex-1 min-w-0 space-y-1.5">
          {fatias.map((f, i) => (
            <li key={f.chave} className="flex items-center gap-2 text-[13px]">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="truncate text-text flex-1">{f.chave}</span>
              <span className="tabular font-semibold text-text">{fmtPct(f.share, 1)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
