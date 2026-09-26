import { Pencil, RotateCcw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "../components/fiori/Button";
import { Card } from "../components/fiori/Card";
import { NumberInput, Select } from "../components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi } from "../components/fiori/Kpi";
import { MessageStrip } from "../components/fiori/MessageStrip";
import { Tag } from "../components/fiori/ObjectStatus";
import { ReportPage } from "../components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { NOTA_PREMISSAS, PREMISSAS_PADRAO, REGIMES_IR, TABELA_IOF, TABELA_IRRF, type Premissas } from "../data/premissas";
import { DATAS_BASE, usePremissas } from "../context/PremissasContext";
import { fmtDate, fmtMonthLong } from "../lib/dates";
import { exportarExcel } from "../lib/exportar";
import { fmtPct } from "../lib/format";

const rel = relatorioPorId("premissas");

type CampoPct = "cdi" | "selic" | "ipca12m" | "custoDivida";

const PARAMETROS: { campo: keyof Premissas; rotulo: string; fonte: string; usadoEm: string[]; editavel: boolean }[] = [
  { campo: "dataBase", rotulo: "Data-base do relatório", fonte: "Data de corte (substituir pela data do fechamento)", usadoEm: ["Todos"], editavel: true },
  { campo: "cdi", rotulo: "CDI a.a.", fonte: "B3/CETIP (TCURR/índice TRM)", usadoEm: ["R03", "R04", "R05", "R06"], editavel: true },
  { campo: "selic", rotulo: "Selic a.a.", fonte: "BCB/Copom", usadoEm: ["R01", "R04"], editavel: true },
  { campo: "ipca12m", rotulo: "IPCA acumulado 12 meses", fonte: "IBGE", usadoEm: ["R01", "R03"], editavel: true },
  { campo: "baseDiasCorridos", rotulo: "Base de dias corridos", fonte: "Constante", usadoEm: ["R01", "R03"], editavel: false },
  { campo: "baseDiasUteis", rotulo: "Base de dias úteis", fonte: "Constante (dias úteis ANBIMA)", usadoEm: ["R01", "R03", "R05"], editavel: false },
  {
    campo: "custoDivida",
    rotulo: "Custo médio da dívida a.a. (CDI + spread)",
    fonte: "Taxa média ponderada da carteira de dívida",
    usadoEm: ["R06"],
    editavel: true,
  },
];

export function PremissasApp() {
  const { premissas: p, atualizar, restaurar, alterado } = usePremissas();

  const exportar = () =>
    exportarExcel(
      `Premissas_${p.dataBase}.xlsx`,
      [
        {
          nome: "Premissas",
          titulo: "Premissas – Aplicações Financeiras",
          subtitulo: "Parâmetros gerais",
          colunas: [
            { titulo: "Parâmetro", largura: 42 },
            { titulo: "Valor", tipo: "decimal", largura: 14 },
            { titulo: "Fonte / Observação", largura: 50 },
          ],
          linhas: PARAMETROS.map((x) => {
            const v = p[x.campo];
            if (x.campo === "dataBase") return [x.rotulo, fmtDate(String(v)), x.fonte];
            return [x.rotulo, typeof v === "number" && v < 1 ? v * 100 : (v as number), x.fonte];
          }),
          notas: ["Taxas expressas em % a.a."],
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

  const setPct = (campo: CampoPct, v: number) => atualizar({ [campo]: v / 100 } as Partial<Premissas>);

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      actions={
        <Button
          variant="default"
          icon={<RotateCcw className="w-4 h-4" />}
          disabled={!alterado}
          onClick={() => {
            restaurar();
            toast.success("Premissas restauradas para os valores da planilha base");
          }}
        >
          <span className="hidden sm:inline">Restaurar padrão</span>
        </Button>
      }
      kpis={
        <>
          <HeaderKpi label="CDI a.a." value={fmtPct(p.cdi)} />
          <HeaderKpi label="Selic a.a." value={fmtPct(p.selic)} />
          <HeaderKpi label="IPCA 12m" value={fmtPct(p.ipca12m)} />
          <HeaderKpi label="Custo da dívida" value={fmtPct(p.custoDivida)} />
        </>
      }
    >
      <MessageStrip>
        Campos com <Tag color="#0070f2">Editável</Tag> correspondem às células amarelas (inputs) da planilha. Qualquer
        alteração recalcula imediatamente todos os relatórios desta demo; os valores ficam salvos neste navegador.
      </MessageStrip>

      <Card title="Parâmetros gerais" subtitle="Alimentam os relatórios R01 a R07">
        <div className="overflow-x-auto fiori-scroll -mx-4">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[13px] text-text">
                <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd]">Parâmetro</th>
                <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd] w-52">Valor</th>
                <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd]">Fonte / Observação</th>
                <th className="font-semibold px-4 py-2 border-b border-[#a8b2bd]">Usado em</th>
              </tr>
            </thead>
            <tbody>
              {PARAMETROS.map((x) => (
                <tr key={x.campo} className="border-b border-line-soft">
                  <td className="px-4 py-2.5 border-b border-line-soft">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text">{x.rotulo}</span>
                      {x.editavel && (
                        <Tag color="#0070f2">
                          <Pencil className="w-2.5 h-2.5 mr-1" />
                          Editável
                        </Tag>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 border-b border-line-soft">
                    {x.campo === "dataBase" ? (
                      <Select
                        ariaLabel="Data-base"
                        value={p.dataBase}
                        onChange={(v) => atualizar({ dataBase: v })}
                        options={DATAS_BASE.map((d) => ({ value: d, label: `${fmtDate(d)} (${fmtMonthLong(d)})` }))}
                      />
                    ) : x.editavel ? (
                      <NumberInput
                        ariaLabel={x.rotulo}
                        value={Math.round((p[x.campo] as number) * 10000) / 100}
                        onChange={(v) => setPct(x.campo as CampoPct, v)}
                        suffix="% a.a."
                        step={0.05}
                        min={0}
                        max={100}
                      />
                    ) : (
                      <span className="tabular text-text">{String(p[x.campo])}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 border-b border-line-soft text-label">
                    {x.fonte}
                    {x.editavel && x.campo !== "dataBase" && p[x.campo] !== PREMISSAS_PADRAO[x.campo] && (
                      <span className="ml-2 text-xs text-critical font-semibold">
                        (padrão {fmtPct(PREMISSAS_PADRAO[x.campo] as number)})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 border-b border-line-soft">
                    <div className="flex flex-wrap gap-1">
                      {x.usadoEm.map((u) => (
                        <Tag key={u}>{u}</Tag>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-label mt-3">
          CDI e Selic históricos (até a data-base) seguem a série mensal do mercado; os valores acima são usados para
          projeções (R04), carry (R06) e para o mês corrente em diante.
        </p>
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
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(0)}%`, "IOF s/ rendimento"]}
                  labelFormatter={(l) => `D+${l}`}
                  contentStyle={{ borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial" }}
                />
                <Bar dataKey="v" fill="#c87b00" radius={[3, 3, 0, 0]} />
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
