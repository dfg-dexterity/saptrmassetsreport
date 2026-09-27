import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, CHART_COLORS, CHART_SEMANTIC, HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { ObjectStatus, semaforoState, Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { LIMITE_POR_RATING } from "../data/carteira";
import { ESCOPOS, useMestre, type Escopo } from "../context/useDados";
import { fmtDate } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { FAIXAS_PRAZO } from "../lib/finance";
import { MOEDAS, TIPOS_CONTRATO, type ContratoMestre, type Moeda, type TipoContrato } from "../lib/carteiraMestre";
import { fmtBRL, fmtCompact, fmtDec, fmtInt, fmtMi, fmtNum, fmtPct } from "../../shared/lib/format";
import {
  avaliarPolitica,
  classificarHHI,
  concentracaoPorGrupo,
  distribuicaoMestre,
  hhi,
  SEMAFORO_TEXTO,
  totalMestre,
  type Fatia,
  type GrupoExposicao,
  type ResultadoRegra,
} from "../lib/indicadores";

const rel = relatorioPorId("r07");

const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

const COR_TIPO = Object.fromEntries(TIPOS_CONTRATO.map((t) => [t.tipo, t.cor])) as Record<TipoContrato, string>;
const CURTO_TIPO = Object.fromEntries(TIPOS_CONTRATO.map((t) => [t.tipo, t.curto])) as Record<TipoContrato, string>;
const COR_MOEDA: Record<Moeda, string> = { BRL: CHART_COLORS[0], USD: CHART_COLORS[2], EUR: CHART_COLORS[3] };
const SIMBOLO_MOEDA: Record<Moeda, string> = { BRL: "R$", USD: "US$", EUR: "€" };

const corSemaforo = (s: ResultadoRegra["status"]) => (s === "ok" ? CHART_SEMANTIC.good : s === "atencao" ? CHART_SEMANTIC.critical : CHART_SEMANTIC.bad);

/** Valor em moeda estrangeira compacto: US$ 815,8 mil */
function fmtME(v: number, moeda: Moeda): string {
  return fmtCompact(v).replace("R$", SIMBOLO_MOEDA[moeda]);
}

/** Folga da regra em fração: máximo → limite − atual; mínimo → atual − limite (negativa = desenquadrada) */
const folgaRegra = (r: ResultadoRegra) => (r.tipo === "max" ? r.limite - r.share : r.share - r.limite);

const fmtPP = (v: number) => `${v >= 0 ? "+" : ""}${fmtDec(v * 100, 1)} p.p.`;

export function R07Concentracao() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, contratos } = useMestre(escopo);

  const d = useMemo(() => {
    const grupos = concentracaoPorGrupo(contratos);
    const indice = hhi(grupos.map((g) => g.share));
    const total = totalMestre(contratos);
    const moeda = distribuicaoMestre(contratos, (x) => x.moeda, MOEDAS).filter((f) => f.qtd > 0);
    const saldoME = new Map<string, number>();
    for (const c of contratos) saldoME.set(c.moeda, (saldoME.get(c.moeda) ?? 0) + c.saldoME);
    const fundoCambial = contratos.filter((c) => c.moeda === "BRL" && c.indexador === "USD").reduce((s, c) => s + c.saldoCurva, 0);
    const prazo = distribuicaoMestre(contratos, (x) => x.faixaPrazo, FAIXAS_PRAZO);
    const prazoPorTipo = FAIXAS_PRAZO.map((faixa) => {
      const linha: Record<string, number | string> = { faixa: faixa.replace(" dias", "d").replace("Acima de ", "> ").replace("Até ", "≤ ") };
      for (const t of TIPOS_CONTRATO) linha[t.tipo] = contratos.filter((c) => c.faixaPrazo === faixa && c.tipo === t.tipo).reduce((s, c) => s + c.saldoCurva, 0) / 1e6;
      const f = prazo.find((x) => x.chave === faixa)!;
      linha.total = f.valor;
      linha.share = f.share;
      linha.qtd = f.qtd;
      return linha;
    });
    return {
      grupos,
      indice,
      classe: classificarHHI(indice),
      tipo: distribuicaoMestre(
        contratos,
        (x) => x.tipo,
        TIPOS_CONTRATO.map((t) => t.tipo),
      ).filter((f) => f.qtd > 0),
      indexador: distribuicaoMestre(contratos, (x) => x.indexador),
      moeda,
      saldoME,
      fundoCambial,
      prazo,
      prazoPorTipo,
      politica: avaliarPolitica(contratos),
      total,
    };
  }, [contratos]);

  const tiposPresentes = TIPOS_CONTRATO.filter((t) => d.tipo.some((f) => f.chave === t.tipo));
  const escala = Math.max(0.3, Math.ceil(Math.max(...d.politica.map((r) => Math.max(r.share, r.limite))) * 1.2 * 10) / 10);

  const regrasOk = d.politica.filter((r) => r.status !== "excedido").length + d.grupos.filter((g) => g.status !== "excedido").length;
  const totalRegras = d.politica.length + d.grupos.length;
  const emAtencao = d.politica.filter((r) => r.status === "atencao").length + d.grupos.filter((g) => g.status === "atencao").length;
  const escopoRotulo = ESCOPOS.find((e) => e.value === escopo)!.label;

  const colunas: Column<GrupoExposicao>[] = [
    {
      key: "grupo",
      header: "Grupo econômico",
      sticky: true,
      minWidth: 200,
      value: (g) => g.grupo,
      render: (g) => (
        <div>
          <div className="font-semibold text-text">{g.grupo}</div>
          <div className="text-xs text-label">{g.contrapartes.join(", ")}</div>
        </div>
      ),
      total: () => <span>Total ({d.grupos.length} grupos)</span>,
    },
    { key: "rating", header: "Rating", value: (g) => g.rating, render: (g) => <Tag>{g.rating}</Tag> },
    {
      key: "tipos",
      header: "Tipos de contrato",
      minWidth: 250,
      value: (g) => g.tipos.length,
      render: (g) => (
        <div className="flex gap-1">
          {TIPOS_CONTRATO.filter((t) => g.tipos.includes(t.tipo)).map((t) => (
            <Tag key={t.tipo} color={t.cor}>
              {t.curto}
            </Tag>
          ))}
        </div>
      ),
    },
    { key: "ops", header: "Contratos", align: "right", value: (g) => g.operacoes, total: (r) => fmtInt(r.reduce((s, g) => s + g.operacoes, 0)) },
    { key: "valor", header: "Exposição (R$)", align: "right", value: (g) => g.valor, render: (g) => fmtNum(g.valor), total: (r) => fmtNum(r.reduce((s, g) => s + g.valor, 0)) },
    { key: "share", header: "% carteira", align: "right", value: (g) => g.share, render: (g) => <span className="font-semibold">{fmtPct(g.share, 1)}</span>, total: () => "100,0%" },
    { key: "limite", header: "Limite política", align: "right", value: (g) => g.limite, render: (g) => (g.limite >= 1 ? "Sem limite" : fmtPct(g.limite, 0)) },
    {
      key: "uso",
      header: "Utilização do limite",
      value: (g) => g.utilizacao,
      minWidth: 200,
      render: (g) => (
        <div className="flex items-center gap-2">
          <MicroBar value={g.utilizacao} max={1.2} marker={1} className="flex-1 h-2" color={corSemaforo(g.status)} />
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

  const colunasPolitica: Column<ResultadoRegra>[] = [
    {
      key: "regra",
      header: "Regra da política",
      minWidth: 260,
      value: (r) => r.regra,
      render: (r) => <span className="font-semibold text-text leading-snug">{r.regra}</span>,
    },
    { key: "limite", header: "Limite", align: "right", value: (r) => r.limite, render: (r) => `${r.tipo === "max" ? "máx." : "mín."} ${fmtPct(r.limite, 0)}` },
    { key: "valor", header: "Valor (R$)", align: "right", value: (r) => r.valor, render: (r) => fmtNum(r.valor) },
    {
      key: "atual",
      header: "Participação",
      align: "right",
      value: (r) => r.share,
      render: (r) => (
        <div>
          <div className="font-semibold">{fmtPct(r.share, 1)}</div>
          <div className={`text-xs ${folgaRegra(r) < 0 ? "text-negative" : "text-label"}`}>folga {fmtPP(folgaRegra(r))}</div>
        </div>
      ),
    },
    {
      key: "barra",
      header: `Participação × limite (0–${fmtPct(escala, 0)})`,
      headerTitle: "Barra = participação na carteira; traço = limite da política (mesma escala para todas as regras)",
      minWidth: 190,
      value: (r) => r.share / escala,
      render: (r) => <MicroBar value={r.share} max={escala} marker={r.limite} className="h-2" color={corSemaforo(r.status)} />,
    },
    {
      key: "status",
      header: "Semáforo",
      value: (r) => r.status,
      render: (r) => <ObjectStatus state={semaforoState(r.status)}>{SEMAFORO_TEXTO[r.status]}</ObjectStatus>,
    },
  ];

  const exportar = () =>
    exportarExcel(
      `R07_Concentracao_${p.dataBase}.xlsx`,
      [
        {
          nome: "Por grupo econômico",
          titulo: "R07 – Concentração da carteira consolidada: exposição por grupo econômico",
          subtitulo: `${escopoRotulo} · Carteira-Mestre (renda fixa bancária, Tesouro Direto, fundos e time deposits)`,
          colunas: [
            { titulo: "Grupo econômico", largura: 24 },
            { titulo: "Contrapartes", largura: 40 },
            { titulo: "Rating", largura: 10 },
            { titulo: "Tipos de contrato", largura: 36 },
            { titulo: "Contratos", tipo: "inteiro" },
            { titulo: "Exposição (R$)", tipo: "moeda" },
            { titulo: "% carteira", tipo: "pct" },
            { titulo: "Limite", tipo: "pct" },
            { titulo: "Utilização", tipo: "pct" },
            { titulo: "Semáforo", largura: 16 },
          ],
          linhas: d.grupos.map((g) => [
            g.grupo,
            g.contrapartes.join(", "),
            g.rating,
            TIPOS_CONTRATO.filter((t) => g.tipos.includes(t.tipo))
              .map((t) => t.tipo)
              .join(", "),
            g.operacoes,
            g.valor,
            g.share,
            g.limite >= 1 ? "Sem limite" : g.limite,
            g.limite >= 1 ? null : g.utilizacao,
            SEMAFORO_TEXTO[g.status],
          ]),
          total: ["TOTAL", "", "", "", d.grupos.reduce((s, g) => s + g.operacoes, 0), d.total, 1, "", "", ""],
          notas: [
            `Índice HHI: ${fmtInt(d.indice)} (${d.classe.rotulo}) – soma dos quadrados das participações por grupo econômico (0–10.000).`,
            `Limites por rating: ${Object.entries(LIMITE_POR_RATING)
              .map(([r, l]) => `${r} ${l >= 1 ? "sem limite" : fmtPct(l, 0)}`)
              .join(" · ")}.`,
            "Exposição = saldo bruto em R$ na data-base: curva na renda fixa e nos títulos públicos, valor da cota nos fundos e saldo em moeda × PTAX nos time deposits.",
          ],
        },
        ...(
          [
            ["Por tipo de contrato", "Exposição por tipo de contrato", d.tipo],
            ["Por indexador", "Exposição por indexador", d.indexador],
            ["Por prazo", "Exposição por prazo remanescente (fundos pelo prazo de resgate)", d.prazo],
          ] as [string, string, Fatia[]][]
        ).map(([nome, titulo, fatias]) => ({
          nome,
          titulo: `R07 – ${titulo}`,
          subtitulo: escopoRotulo,
          colunas: [{ titulo: "Categoria", largura: 24 }, { titulo: "Contratos", tipo: "inteiro" as const }, { titulo: "Exposição (R$)", tipo: "moeda" as const }, { titulo: "% carteira", tipo: "pct" as const }],
          linhas: fatias.map((f) => [f.chave, f.qtd, f.valor, f.share]),
          total: ["TOTAL", fatias.reduce((s, f) => s + f.qtd, 0), d.total, 1],
        })),
        {
          nome: "Por moeda",
          titulo: "R07 – Exposição por moeda",
          subtitulo: escopoRotulo,
          colunas: [
            { titulo: "Moeda", largura: 10 },
            { titulo: "Contratos", tipo: "inteiro" },
            { titulo: "Saldo na moeda", tipo: "moeda" },
            { titulo: "PTAX", tipo: "decimal" },
            { titulo: "Exposição (R$)", tipo: "moeda" },
            { titulo: "% carteira", tipo: "pct" },
          ],
          linhas: d.moeda.map((f) => [f.chave, f.qtd, d.saldoME.get(f.chave) ?? 0, f.chave === "USD" ? p.ptaxUSD : f.chave === "EUR" ? p.ptaxEUR : 1, f.valor, f.share]),
          total: ["TOTAL", d.moeda.reduce((s, f) => s + f.qtd, 0), "", "", d.total, 1],
          notas: [
            `PTAX de venda em ${fmtDate(p.dataBase)} (Premissas importadas do SAP): USD ${fmtDec(p.ptaxUSD, 4)} · EUR ${fmtDec(p.ptaxEUR, 4)}.`,
            "O fundo cambial é cotado em R$ (indexado ao USD) e fica em BRL; na regra de exposição cambial da política ele é somado aos time deposits.",
          ],
        },
        {
          nome: "Política",
          titulo: "R07 – Enquadramento na política de investimentos",
          subtitulo: escopoRotulo,
          colunas: [
            { titulo: "Regra", largura: 60 },
            { titulo: "Tipo", largura: 10 },
            { titulo: "Limite", tipo: "pct" },
            { titulo: "Valor (R$)", tipo: "moeda" },
            { titulo: "Participação", tipo: "pct" },
            { titulo: "Folga", tipo: "pct" },
            { titulo: "Semáforo", largura: 16 },
          ],
          linhas: d.politica.map((r) => [r.regra, r.tipo === "max" ? "Máximo" : "Mínimo", r.limite, r.valor, r.share, folgaRegra(r), SEMAFORO_TEXTO[r.status]]),
          notas: ["Semáforo: máximo – amarelo a partir de 80% do limite; mínimo – amarelo até 120% do limite; vermelho = desenquadrado."],
        },
        {
          nome: "Contratos",
          titulo: "R07 – Contratos da carteira consolidada na data-base",
          subtitulo: escopoRotulo,
          colunas: [
            { titulo: "Código", largura: 12 },
            { titulo: "Tipo de contrato", largura: 22 },
            { titulo: "Produto", largura: 28 },
            { titulo: "Contraparte", largura: 26 },
            { titulo: "Grupo econômico", largura: 20 },
            { titulo: "Rating", largura: 10 },
            { titulo: "Empresa", largura: 9 },
            { titulo: "Moeda", largura: 8 },
            { titulo: "Indexador", largura: 14 },
            { titulo: "Vencimento", tipo: "data" },
            { titulo: "Prazo remanescente (dias)", tipo: "inteiro" },
            { titulo: "Faixa de prazo", largura: 16 },
            { titulo: "Saldo na moeda", tipo: "moeda" },
            { titulo: "Exposição (R$)", tipo: "moeda" },
            { titulo: "% carteira", tipo: "pct" },
            { titulo: "Liquidez imediata", largura: 10 },
          ],
          linhas: [...contratos]
            .sort((a, b) => b.saldoCurva - a.saldoCurva)
            .map((c: ContratoMestre) => [
              c.codigo,
              c.tipo,
              c.produto,
              c.contraparte,
              c.grupo,
              c.rating,
              c.empresa,
              c.moeda,
              c.indexador,
              c.vencimento,
              c.prazoRemanescente,
              c.faixaPrazo,
              c.saldoME,
              c.saldoCurva,
              d.total > 0 ? c.saldoCurva / d.total : 0,
              c.liquidezImediata ? "Sim" : "Não",
            ]),
          total: ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", d.total, 1, ""],
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
          <HeaderKpi
            label="Maior exposição"
            value={d.grupos[0] ? fmtPct(d.grupos[0].share, 1) : "—"}
            state={d.grupos[0] ? semaforoState(d.grupos[0].status) : "neutral"}
            sub={d.grupos[0] ? `${d.grupos[0].grupo} · limite ${d.grupos[0].limite >= 1 ? "livre" : fmtPct(d.grupos[0].limite, 0)}` : undefined}
          />
          <HeaderKpi label="Grupos econômicos" value={String(d.grupos.length)} sub={`${contratos.length} contratos · ${fmtCompact(d.total)}`} />
          <HeaderKpi
            label="Enquadramento"
            value={`${regrasOk}/${totalRegras}`}
            state={regrasOk < totalRegras ? "negative" : emAtencao > 0 ? "critical" : "positive"}
            sub={emAtencao > 0 ? `regras e limites atendidos · ${emAtencao} em atenção` : "regras e limites atendidos"}
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

      <Card
        title="Exposição por grupo econômico (limite por rating)"
        subtitle="Carteira consolidada (Carteira-Mestre) · saldo bruto em R$ na data-base: curva, valor da cota ou saldo em moeda × PTAX"
        bodyClassName="px-0 pb-0"
      >
        <DataTable columns={colunas} rows={d.grupos} rowKey={(g) => g.grupo} showTotals defaultSort={{ key: "valor", dir: "desc" }} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Donut
          titulo="Por tipo de contrato"
          subtitulo="Renda fixa bancária, Tesouro Direto, fundos e time deposits"
          fatias={d.tipo}
          cor={(f) => COR_TIPO[f.chave as TipoContrato]}
        />
        <Donut
          titulo="Por moeda"
          subtitulo={`Time deposits convertidos pela PTAX de ${fmtDate(p.dataBase)}: USD ${fmtDec(p.ptaxUSD, 4)} · EUR ${fmtDec(p.ptaxEUR, 4)}`}
          fatias={d.moeda}
          cor={(f) => COR_MOEDA[f.chave as Moeda]}
          detalhe={(f) =>
            f.chave === "BRL"
              ? d.fundoCambial > 0
                ? `inclui ${fmtCompact(d.fundoCambial)} em fundo cambial (cotas em R$)`
                : undefined
              : `${fmtME(d.saldoME.get(f.chave) ?? 0, f.chave as Moeda)} na moeda`
          }
        />
        <Donut titulo="Por indexador" subtitulo="CDI, Selic, IPCA, prefixado, câmbio e renda variável" fatias={d.indexador} cor={(_f, i) => CHART_COLORS[i % CHART_COLORS.length]} />
        <Card title="Por prazo remanescente" subtitle="Fundos pelo prazo de resgate (D+n) · liquidez diária em “Até 30 dias” · R$ milhões">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text mb-1">
            {tiposPresentes.map((t) => (
              <span key={t.tipo} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: t.cor }} />
                {t.curto}
              </span>
            ))}
          </div>
          <div className="h-56 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.prazoPorTipo} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="faixa" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} unit=" mi" tickFormatter={(v: number) => fmtDec(v, 0)} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, n: string) => [fmtBRL(v * 1e6), CURTO_TIPO[n as TipoContrato] ?? n]}
                  labelFormatter={(_l, payload) => {
                    const x = payload?.[0]?.payload as { total: number; share: number; qtd: number } | undefined;
                    return x ? `${_l} · ${fmtCompact(x.total)} (${fmtPct(x.share, 1)}) · ${x.qtd} contratos` : String(_l);
                  }}
                />
                {tiposPresentes.map((t, i) => (
                  <Bar
                    key={t.tipo}
                    dataKey={t.tipo}
                    stackId="prazo"
                    fill={t.cor}
                    isAnimationActive={false}
                    radius={i === tiposPresentes.length - 1 ? [4, 4, 0, 0] : undefined}
                    label={
                      i === tiposPresentes.length - 1
                        ? (props: { x?: number; y?: number; width?: number; index?: number }) => {
                            const x = d.prazoPorTipo[props.index ?? 0];
                            if (!x || !(x.share as number)) return <g key={props.index} />;
                            return (
                              <text key={props.index} x={(props.x ?? 0) + (props.width ?? 0) / 2} y={(props.y ?? 0) - 5} textAnchor="middle" fontSize={11} fill="#1d2d3e" fontFamily="72, Arial">
                                {fmtPct(x.share as number, 0)}
                              </text>
                            );
                          }
                        : undefined
                    }
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card
          className="xl:col-span-2"
          title="Enquadramento na política de investimentos"
          subtitle="Participação na carteira consolidada × limite · semáforo: amarelo ≥ 80% do limite máximo (ou ≤ 120% do mínimo) · vermelho desenquadrado"
          bodyClassName="px-0 pb-0"
        >
          <DataTable<ResultadoRegra> columns={colunasPolitica} rows={d.politica} rowKey={(r) => r.id} />
        </Card>
        <Card title="Índice Herfindahl-Hirschman" subtitle="Soma dos quadrados das participações por grupo econômico">
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
          <div className="relative h-4 text-[11px] text-label tabular -mt-1">
            <span className="absolute left-0">0</span>
            <span className="absolute -translate-x-1/2" style={{ left: "30%" }}>
              1.500
            </span>
            <span className="absolute -translate-x-1/2" style={{ left: "50%" }}>
              2.500
            </span>
            <span className="absolute right-0">5.000+</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            <div>
              <dt className="text-label">Grupos econômicos</dt>
              <dd className="font-semibold text-text tabular">{d.grupos.length}</dd>
            </div>
            <div>
              <dt className="text-label">Equivalente em grupos iguais</dt>
              <dd className="font-semibold text-text tabular">{d.indice > 0 ? fmtDec(10000 / d.indice, 1) : "—"}</dd>
            </div>
            <div>
              <dt className="text-label">3 maiores grupos</dt>
              <dd className="font-semibold text-text tabular">{fmtPct(d.grupos.slice(0, 3).reduce((s, g) => s + g.share, 0), 1)}</dd>
            </div>
            <div>
              <dt className="text-label">Maior grupo</dt>
              <dd className="font-semibold text-text tabular">{d.grupos[0] ? fmtPct(d.grupos[0].share, 1) : "—"}</dd>
            </div>
          </dl>
          <p className="text-xs text-label mt-4 leading-relaxed">
            HHI &lt; 1.500: baixa concentração · 1.500–2.500: moderada · &gt; 2.500: alta. Calculado sobre as participações por grupo econômico
            (0–10.000); o Tesouro Nacional (risco soberano) entra como um grupo.
          </p>
        </Card>
      </div>
    </ReportPage>
  );
}

function Donut({
  titulo,
  subtitulo,
  fatias,
  cor,
  detalhe,
}: {
  titulo: string;
  subtitulo?: string;
  fatias: Fatia[];
  cor: (f: Fatia, i: number) => string;
  detalhe?: (f: Fatia) => ReactNode;
}) {
  return (
    <Card title={titulo} subtitle={subtitulo}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-36 h-36 shrink-0 self-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={fatias} dataKey="valor" nameKey="chave" innerRadius="58%" outerRadius="100%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
                {fatias.map((f, i) => (
                  <Cell key={f.chave} fill={cor(f, i)} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n) => [fmtCompact(v), n]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex-1 min-w-0 space-y-1.5">
          <li className="flex items-center gap-2 text-[11px] text-label border-b border-line-soft pb-1" aria-hidden>
            <span className="w-2.5 shrink-0" />
            <span className="flex-1" />
            <span className="w-7 text-right whitespace-nowrap">Qtd.</span>
            <span className="w-14 text-right whitespace-nowrap">R$ mi</span>
            <span className="w-12 text-right whitespace-nowrap">%</span>
          </li>
          {fatias.map((f, i) => (
            <li key={f.chave} className="flex items-start gap-2 text-[13px]">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1" style={{ backgroundColor: cor(f, i) }} />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-text">{f.chave}</span>
                {detalhe?.(f) && <span className="block text-xs text-label leading-snug">{detalhe(f)}</span>}
              </span>
              <span className="tabular text-label text-xs whitespace-nowrap mt-px w-7 text-right" title="Contratos">
                {f.qtd}
              </span>
              <span className="tabular text-text whitespace-nowrap w-14 text-right">{fmtMi(f.valor)}</span>
              <span className="tabular font-semibold text-text whitespace-nowrap w-12 text-right">{fmtPct(f.share, 1)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
