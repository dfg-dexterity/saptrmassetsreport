import { ArrowRight, Lock } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "../../shared/components/fiori/Button";
import { Card } from "../../shared/components/fiori/Card";
import { AXIS_STYLE, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { usePremissas } from "../../shared/context/MercadoContext";
import { CDI_MENSAL, FONTES_SAP, IMPORTACAO_SAP, ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import { addMonths, fmtDate, fmtMonthLong, fmtMonthShort, previousYearEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtDec, fmtPct } from "../../shared/lib/format";
import { useBenchmarks } from "../context/BenchmarkContext";
import { regraCarteiraVigente } from "../lib/benchmark";
import { relatorioPorId } from "../data/catalogo";
import { NOTA_PREMISSAS, REGIMES_IR, TABELA_IOF, TABELA_IRRF } from "../data/tributacao";
import { custoMedioDivida } from "../lib/indicadores";

const rel = relatorioPorId("premissas");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

/** Origem de cada parâmetro: só os dados de mercado vêm do SAP */
type Origem = "sap" | "usuario" | "derivado" | "constante";

const ORIGEM: Record<Origem, { rotulo: string; cor: string; bloqueado: boolean }> = {
  sap: { rotulo: "Importado do SAP", cor: "#556b82", bloqueado: true },
  usuario: { rotulo: "Seleção do usuário", cor: "#0070f2", bloqueado: false },
  derivado: { rotulo: "Derivado da data-base", cor: "#8b47d7", bloqueado: false },
  constante: { rotulo: "Constante de cálculo", cor: "#788fa6", bloqueado: true },
};

interface Parametro {
  id: string;
  rotulo: string;
  valor: (p: PremissasMercado) => string;
  numero: (p: PremissasMercado) => number | string;
  origem: Origem;
  fonte: string;
  usadoEm: string[];
}

const PARAMETROS: Parametro[] = [
  {
    id: "dataBase",
    rotulo: "Data-base do relatório",
    valor: (p) => `${fmtDate(p.dataBase)} (${fmtMonthLong(p.dataBase)})`,
    numero: (p) => fmtDate(p.dataBase),
    origem: "usuario",
    fonte: "Data de corte do fechamento, escolhida na barra superior (datas com dados importados do SAP)",
    usadoEm: ["Todos"],
  },
  {
    id: "abertura",
    rotulo: "Data de abertura do período",
    valor: (p) => fmtDate(previousYearEnd(p.dataBase)),
    numero: (p) => fmtDate(previousYearEnd(p.dataBase)),
    origem: "derivado",
    fonte: "31/12 do exercício anterior à data-base",
    usadoEm: ["R02", "R03"],
  },
  { id: "cdi", rotulo: "CDI a.a.", valor: (p) => fmtPct(p.cdi), numero: (p) => p.cdi * 100, origem: "sap", fonte: FONTES_SAP.cdi, usadoEm: ["R01", "R03", "R04", "R05", "R06"] },
  { id: "selic", rotulo: "Selic a.a.", valor: (p) => fmtPct(p.selic), numero: (p) => p.selic * 100, origem: "sap", fonte: FONTES_SAP.selic, usadoEm: ["R01", "R04"] },
  { id: "ipca12m", rotulo: "IPCA acumulado 12 meses", valor: (p) => fmtPct(p.ipca12m), numero: (p) => p.ipca12m * 100, origem: "sap", fonte: FONTES_SAP.ipca12m, usadoEm: ["R01", "R03"] },
  {
    id: "baseDiasCorridos",
    rotulo: "Base de dias corridos",
    valor: (p) => String(p.baseDiasCorridos),
    numero: (p) => p.baseDiasCorridos,
    origem: "constante",
    fonte: "Convenção do cálculo (ano de 365 dias)",
    usadoEm: ["R01", "R03"],
  },
  {
    id: "baseDiasUteis",
    rotulo: "Base de dias úteis",
    valor: (p) => String(p.baseDiasUteis),
    numero: (p) => p.baseDiasUteis,
    origem: "constante",
    fonte: "Convenção do cálculo (252 dias úteis – calendário ANBIMA)",
    usadoEm: ["R01", "R03", "R05"],
  },
];

export function PremissasApp() {
  const { premissas: p } = usePremissas();
  const { cadastro } = useBenchmarks();
  const navigate = useNavigate();

  const custoDivida = useMemo(() => custoMedioDivida(p), [p]);
  // Regra da carteira vigente na data-base (a de vigência mais recente, mesma lógica do cálculo do benchmark)
  const bmkCarteira = regraCarteiraVigente(cadastro, p.dataBase);

  // Histórico do CDI importado do SAP (24 meses até a data-base) + projeção de 12 meses com o último dado disponível
  const serieCDI = useMemo(() => {
    const mesBase = p.dataBase.slice(0, 7);
    const out: { mes: string; rotulo: string; historico: number | null; projecao: number | null }[] = [];
    for (let i = -23; i <= 12; i++) {
      const d = addMonths(`${mesBase}-01`, i);
      const k = d.slice(0, 7);
      const hist = i <= 0 ? (CDI_MENSAL[k] ?? null) : null;
      out.push({
        mes: k,
        rotulo: fmtMonthShort(d),
        historico: hist !== null ? hist * 100 : null,
        projecao: i >= 0 ? p.cdi * 100 : null,
      });
    }
    return out;
  }, [p]);

  const exportar = () =>
    exportarExcel(
      `Premissas_${p.dataBase}.xlsx`,
      [
        {
          nome: "Premissas",
          titulo: "Premissas – Aplicações Financeiras",
          subtitulo: `Premissas gerais importadas do SAP (${IMPORTACAO_SAP.sistema}) em ${fmtDate(IMPORTACAO_SAP.ultimaImportacao.slice(0, 10))}`,
          colunas: [
            { titulo: "Parâmetro", largura: 42 },
            { titulo: "Valor", largura: 16 },
            { titulo: "Origem", largura: 22 },
            { titulo: "Fonte", largura: 60 },
          ],
          linhas: [
            ...PARAMETROS.map((x) => [x.rotulo, x.numero(p), ORIGEM[x.origem].rotulo, x.fonte]),
            ["Custo médio ponderado da dívida (% a.a.)", custoDivida * 100, "Calculado", "Taxa efetiva média ponderada da carteira de captações (dívida) na data-base"],
            [
              "Benchmark da carteira (% do CDI)",
              (bmkCarteira?.pctCDI ?? 1) * 100,
              "Cadastro do usuário",
              bmkCarteira ? `Regra “${bmkCarteira.descricao}”, vigente desde ${fmtDate(bmkCarteira.vigenciaInicio)}` : "Sem regra de carteira vigente – 100% do CDI",
            ],
          ],
          notas: ["Taxas expressas em % a.a.", "Valores posteriores à data-base são projetados com o último dado disponível."],
        },
        {
          nome: "CDI mensal",
          titulo: "CDI – histórico importado do SAP e projeção",
          colunas: [{ titulo: "Mês", largura: 12 }, { titulo: "CDI (% a.a.)", tipo: "decimal" }, { titulo: "Origem", largura: 30 }],
          linhas: serieCDI.map((m) => [m.mes, m.historico ?? m.projecao ?? 0, m.historico !== null ? "Importado do SAP" : "Projeção (último dado disponível)"]),
        },
        {
          nome: "IRRF",
          titulo: "Tabela regressiva IRRF – Renda fixa (Lei 11.033/2004)",
          colunas: [{ titulo: "Faixa", largura: 22 }, { titulo: "Dias de", tipo: "inteiro" }, { titulo: "Dias até", tipo: "inteiro" }, { titulo: "Alíquota IRRF", tipo: "pct" }],
          linhas: TABELA_IRRF.map((f) => [f.faixa, f.de, f.ate, f.aliquota]),
        },
        {
          nome: "IOF",
          titulo: "Tabela regressiva IOF (Decreto 6.306/2007)",
          colunas: [{ titulo: "Dias corridos", tipo: "inteiro" }, { titulo: "% IOF s/ rendimento", tipo: "pct", largura: 20 }],
          linhas: [...TABELA_IOF.map((v, i) => [i + 1, v]), [30, 0]],
        },
      ],
      p.dataBase,
    );

  const importadoEm = new Date(IMPORTACAO_SAP.ultimaImportacao);

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="CDI a.a." value={fmtPct(p.cdi)} />
          <HeaderKpi label="Selic a.a." value={fmtPct(p.selic)} />
          <HeaderKpi label="IPCA 12m" value={fmtPct(p.ipca12m)} />
          <HeaderKpi label="Custo da dívida" value={fmtPct(custoDivida)} sub="carteira de captações (dívida)" />
        </>
      }
    >
      <MessageStrip>
        As premissas gerais são <strong>importadas do SAP</strong> ({IMPORTACAO_SAP.sistema}) e não podem ser editadas
        nesta aplicação. Última importação em {importadoEm.toLocaleDateString("pt-BR")} às{" "}
        {importadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}; último dado disponível em{" "}
        {fmtDate(ultimoDadoNaDataBase(p.dataBase))}. Valores posteriores a essa data são projetados com o último dado
        disponível.
      </MessageStrip>

      <Card title="Parâmetros gerais" subtitle="Somente leitura · alimentam os relatórios R01 a R07">
        <div className="overflow-x-auto fiori-scroll -mx-4">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-[13px] text-text">
                <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd]">Parâmetro</th>
                <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd] text-right w-48">Valor</th>
                <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd]">Origem / fonte</th>
                <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd]">Usado em</th>
              </tr>
            </thead>
            <tbody>
              {PARAMETROS.map((x) => (
                <tr key={x.id}>
                  <td className="px-4 py-2.5 border-b border-line-soft">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-text">{x.rotulo}</span>
                      <Tag color={ORIGEM[x.origem].cor}>
                        {ORIGEM[x.origem].bloqueado && <Lock className="w-2.5 h-2.5 mr-1" />}
                        {ORIGEM[x.origem].rotulo}
                      </Tag>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 border-b border-line-soft text-right tabular font-bold text-text whitespace-nowrap">{x.valor(p)}</td>
                  <td className="px-4 py-2.5 border-b border-line-soft text-label">{x.fonte}</td>
                  <td className="px-4 py-2.5 border-b border-line-soft">
                    <div className="flex flex-wrap gap-1">
                      {x.usadoEm.map((u) => (
                        <Tag key={u}>{u}</Tag>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2.5 border-b border-line-soft">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-text">Custo médio ponderado da dívida a.a.</span>
                    <Tag color="#8b47d7">Calculado</Tag>
                  </div>
                </td>
                <td className="px-4 py-2.5 border-b border-line-soft text-right tabular font-bold text-text">{fmtPct(custoDivida)}</td>
                <td className="px-4 py-2.5 border-b border-line-soft text-label">
                  Taxa efetiva média ponderada da carteira de captações (dívida), pelo saldo contábil na data-base
                </td>
                <td className="px-4 py-2.5 border-b border-line-soft">
                  <Tag>R06</Tag>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 border-b border-line-soft">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-text">Benchmark da carteira</span>
                    <Tag color="#049f9a">Cadastro</Tag>
                  </div>
                </td>
                <td className="px-4 py-2.5 border-b border-line-soft text-right tabular font-bold text-text whitespace-nowrap">
                  {fmtDec((bmkCarteira?.pctCDI ?? 1) * 100, 1)}% do CDI
                </td>
                <td className="px-4 py-2.5 border-b border-line-soft text-label">
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      Taxa de referência cadastrada pela tesouraria (regras por empresa, portfolio e produto)
                      {bmkCarteira ? ` · regra “${bmkCarteira.descricao}” vigente desde ${fmtDate(bmkCarteira.vigenciaInicio)}` : " · sem regra de carteira vigente na data-base (100% do CDI)"}
                    </span>
                    <Button size="sm" variant="transparent" icon={<ArrowRight className="w-4 h-4" />} onClick={() => navigate("/benchmark")}>
                      Cadastro
                    </Button>
                  </div>
                </td>
                <td className="px-4 py-2.5 border-b border-line-soft">
                  <div className="flex flex-wrap gap-1">
                    {["R01", "R03", "R05"].map((u) => (
                      <Tag key={u}>{u}</Tag>
                    ))}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="CDI: histórico importado do SAP × projeção" subtitle="% a.a. · a projeção repete o último dado disponível na data-base">
        <div className="h-64 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={serieCDI} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e5e5e5" />
              <XAxis dataKey="rotulo" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={44} domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(v: number) => `${fmtDec(v, 0)}%`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtDec(v, 2)}%`, n]} />
              <ReferenceLine
                x={fmtMonthShort(`${p.dataBase.slice(0, 7)}-01`)}
                stroke="#556b82"
                strokeDasharray="3 3"
                label={{ value: "Data-base", fill: "#556b82", fontSize: 11, position: "insideTopLeft" }}
              />
              <Line dataKey="historico" name="Importado do SAP" stroke="#0070f2" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="projecao" name="Projeção" stroke="#0070f2" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card className="xl:col-span-2" title="Tabela regressiva IRRF – Renda fixa" subtitle="Lei 11.033/2004">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[13px] text-text">
                <th className="text-left font-semibold py-2 border-b border-[#a8b2bd]">Faixa</th>
                <th className="text-right font-semibold py-2 border-b border-[#a8b2bd]">Dias de</th>
                <th className="text-right font-semibold py-2 border-b border-[#a8b2bd]">Dias até</th>
                <th className="text-right font-semibold py-2 border-b border-[#a8b2bd]">Alíquota</th>
              </tr>
            </thead>
            <tbody>
              {TABELA_IRRF.map((f) => (
                <tr key={f.faixa}>
                  <td className="py-2.5 border-b border-line-soft text-text">{f.faixa}</td>
                  <td className="py-2.5 border-b border-line-soft text-right tabular">{f.de}</td>
                  <td className="py-2.5 border-b border-line-soft text-right tabular">{f.ate.toLocaleString("pt-BR")}</td>
                  <td className="py-2.5 border-b border-line-soft text-right tabular font-bold">{fmtPct(f.aliquota, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="text-sm font-bold text-text mt-6 mb-2">Lista – Regime de tributação</h4>
          <ul className="divide-y divide-line-soft">
            {REGIMES_IR.map((r) => (
              <li key={r.regime} className="py-2 flex gap-3">
                <span className="w-24 shrink-0 font-semibold text-text">{r.regime}</span>
                <span className="text-label text-[13px]">{r.descricao}</span>
              </li>
            ))}
          </ul>
          <MessageStrip design="critical" className="mt-4">
            {NOTA_PREMISSAS}
          </MessageStrip>
        </Card>

        <Card className="xl:col-span-3" title="Tabela regressiva IOF" subtitle="Decreto 6.306/2007 · % sobre o rendimento por dias corridos">
          <div className="h-56 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...TABELA_IOF.map((v, i) => ({ dia: i + 1, v: v * 100 })), { dia: 30, v: 0 }]}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="dia" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={1} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} unit="%" width={44} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(0)}%`, "IOF s/ rendimento"]} labelFormatter={(l) => `D+${l}`} contentStyle={tooltipStyle} />
                <Bar dataKey="v" fill="#c87b00" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-10 gap-1.5 mt-3">
            {[...TABELA_IOF, 0].map((v, i) => (
              <div key={i} className="rounded-md bg-[#f5f6f7] px-1.5 py-1 text-center">
                <div className="text-[11px] text-label">D+{i + 1}</div>
                <div className="text-[13px] font-bold tabular text-text">{v ? `${Math.round(v * 100)}%` : "–"}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </ReportPage>
  );
}
