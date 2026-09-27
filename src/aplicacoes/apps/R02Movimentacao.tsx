import { Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../shared/components/fiori/Button";
import { Card } from "../../shared/components/fiori/Card";
import { TabBar } from "../../shared/components/fiori/Inputs";
import { HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { EMPRESA_CONTROLADORA, OPERACOES, type Operacao, type Produto } from "../data/carteira";
import { usePremissas } from "../../shared/context/MercadoContext";
import { fmtDate, previousYearEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { movimentacao, posicoesEm, type Movimentacao, type Posicao } from "../lib/finance";
import { fmtCompact, fmtDec, fmtMil } from "../../shared/lib/format";

const rel = relatorioPorId("r02");

const TIPOS: { tipo: string; produtos: Produto[] }[] = [
  { tipo: "Certificados de Depósito Bancário (CDB)", produtos: ["CDB"] },
  { tipo: "Operações compromissadas", produtos: ["Compromissada"] },
  { tipo: "Letras Financeiras (LF)", produtos: ["LF"] },
  { tipo: "Letras de Crédito (LCI/LCA)", produtos: ["LCI", "LCA"] },
  { tipo: "Cotas de fundos de investimento RF", produtos: ["Fundo RF"] },
  { tipo: "Títulos públicos federais", produtos: ["Tesouro Selic", "Tesouro Prefixado"] },
  { tipo: "Debêntures, CRI e CRA", produtos: ["Debênture", "CRI", "CRA"] },
];

type Aba = "mov" | "comp" | "cplp" | "nota";

const ctrlOps = OPERACOES.filter((o) => o.empresa === EMPRESA_CONTROLADORA);

function remuneracao(pos: Posicao[]): string {
  const grupos = new Map<string, { peso: number; taxa: number }>();
  for (const x of pos) {
    const g = grupos.get(x.op.indexador) ?? { peso: 0, taxa: 0 };
    g.peso += x.valorBruto;
    g.taxa += x.op.taxa * x.valorBruto;
    grupos.set(x.op.indexador, g);
  }
  return [...grupos.entries()]
    .map(([idx, g]) => {
      const t = g.taxa / g.peso;
      if (idx === "CDI") return `${fmtDec(t * 100, 1)}% do CDI`;
      if (idx === "Pré") return `${fmtDec(t * 100, 2)}% a.a. (pré)`;
      return `${idx} + ${fmtDec(t * 100, 2)}% a.a.`;
    })
    .join(" · ");
}

export function R02Movimentacao() {
  const { premissas: p } = usePremissas();
  const [aba, setAba] = useState<Aba>("mov");
  const inicio = previousYearEnd(p.dataBase);

  const d = useMemo(() => {
    const movCtrl = movimentacao(ctrlOps, inicio, p.dataBase, p);
    const movCons = movimentacao(OPERACOES, inicio, p.dataBase, p);
    const posCtrl = posicoesEm(ctrlOps, p.dataBase, p);
    const posCons = posicoesEm(OPERACOES, p.dataBase, p);
    const antCtrl = posicoesEm(ctrlOps, inicio, p);
    const antCons = posicoesEm(OPERACOES, inicio, p);
    const soma = (pos: Posicao[], prods: Produto[]) => pos.filter((x) => prods.includes(x.op.produto)).reduce((s, x) => s + x.valorBruto, 0);
    const composicao = TIPOS.map((t) => ({
      tipo: t.tipo,
      ctrl: soma(posCtrl, t.produtos),
      ctrlAnt: soma(antCtrl, t.produtos),
      cons: soma(posCons, t.produtos),
      consAnt: soma(antCons, t.produtos),
    })).filter((l) => l.ctrl || l.ctrlAnt || l.cons || l.consAnt);
    const cplp = TIPOS.map((t) => {
      const pos = posCons.filter((x) => t.produtos.includes(x.op.produto));
      return {
        tipo: t.tipo,
        remuneracao: pos.length ? remuneracao(pos) : "",
        circulante: pos.filter((x) => x.circulante).reduce((s, x) => s + x.valorBruto, 0),
        naoCirculante: pos.filter((x) => !x.circulante).reduce((s, x) => s + x.valorBruto, 0),
      };
    }).filter((l) => l.circulante || l.naoCirculante);
    const cdi = posCons.filter((x) => x.op.indexador === "CDI");
    const mediaCDI = cdi.reduce((s, x) => s + x.op.taxa * x.valorBruto, 0) / Math.max(1, cdi.reduce((s, x) => s + x.valorBruto, 0));
    return { movCtrl, movCons, composicao, cplp, mediaCDI, posCons };
  }, [p, inicio]);

  const linhasMov: { rotulo: string; v: (m: Movimentacao) => number; forte?: boolean }[] = [
    { rotulo: `Saldo em ${fmtDate(inicio)}`, v: (m) => m.saldoInicial, forte: true },
    { rotulo: "(+) Rendimentos", v: (m) => m.rendimentos },
    { rotulo: "(+) Novas aplicações", v: (m) => m.aplicacoes },
    { rotulo: "(−) Resgates", v: (m) => -m.resgatesLiquidos },
    { rotulo: "(−) IRRF", v: (m) => -m.irrf },
    { rotulo: "(−) IOF", v: (m) => -m.iof },
    { rotulo: `Saldo em ${fmtDate(p.dataBase)}`, v: (m) => m.saldoFinal, forte: true },
  ];

  const circ = d.cplp.reduce((s, l) => s + l.circulante, 0);
  const naoCirc = d.cplp.reduce((s, l) => s + l.naoCirculante, 0);

  const textoNota = [
    `Aplicações financeiras`,
    ``,
    `As aplicações financeiras da Companhia são mantidas para atender compromissos de curto prazo e investimentos, sendo mensuradas ao custo amortizado ou ao valor justo, conforme o modelo de negócios e as características dos fluxos de caixa contratuais (CPC 48 / IFRS 9).`,
    ``,
    `Em ${fmtDate(p.dataBase)}, o saldo consolidado de aplicações financeiras era de R$ ${fmtMil(d.movCons.saldoFinal)} mil (R$ ${fmtMil(d.movCons.saldoInicial)} mil em ${fmtDate(inicio)}), dos quais R$ ${fmtMil(d.movCtrl.saldoFinal)} mil na Controladora. No período, os rendimentos apropriados totalizaram R$ ${fmtMil(d.movCons.rendimentos)} mil, com novas aplicações de R$ ${fmtMil(d.movCons.aplicacoes)} mil e resgates líquidos de R$ ${fmtMil(d.movCons.resgatesLiquidos)} mil.`,
    ``,
    `As aplicações pós-fixadas são remuneradas à média ponderada de ${fmtDec(d.mediaCDI * 100, 1)}% da variação do CDI. Do saldo consolidado, R$ ${fmtMil(circ)} mil estão classificados no ativo circulante e R$ ${fmtMil(naoCirc)} mil no não circulante.`,
    ``,
    `A exposição da Companhia a riscos de taxa de juros e a análise de sensibilidade dos ativos financeiros estão divulgadas na nota explicativa de instrumentos financeiros (CPC 40).`,
  ].join("\n");

  const exportar = () =>
    exportarExcel(
      `R02_Nota_Aplicacoes_${p.dataBase}.xlsx`,
      [
        {
          nome: "1B - Movimentação",
          titulo: "RELATÓRIO 1B – Movimentação das Aplicações Financeiras",
          subtitulo: "Saldo Inicial → (+) Rendimentos → (+) Aplicações → (−) Resgates → (−) IRRF → Saldo Final · R$ mil",
          colunas: [{ titulo: "Movimentação", largura: 36 }, { titulo: "Controladora (R$ mil)", tipo: "inteiro", largura: 20 }, { titulo: "Consolidado (R$ mil)", tipo: "inteiro", largura: 20 }],
          linhas: linhasMov.map((l) => [l.rotulo, l.v(d.movCtrl) / 1000, l.v(d.movCons) / 1000]),
          notas: [`Nota: as aplicações pós-fixadas são remuneradas à média de ${fmtDec(d.mediaCDI * 100, 1)}% do CDI.`],
        },
        {
          nome: "1A - Composição",
          titulo: "RELATÓRIO 1A – Aplicações: Controladora vs Consolidado · R$ mil",
          colunas: [
            { titulo: "Tipo de aplicação", largura: 40 },
            { titulo: `Controladora ${fmtDate(p.dataBase)}`, tipo: "inteiro", largura: 18 },
            { titulo: `Controladora ${fmtDate(inicio)}`, tipo: "inteiro", largura: 18 },
            { titulo: `Consolidado ${fmtDate(p.dataBase)}`, tipo: "inteiro", largura: 18 },
            { titulo: `Consolidado ${fmtDate(inicio)}`, tipo: "inteiro", largura: 18 },
          ],
          linhas: d.composicao.map((l) => [l.tipo, l.ctrl / 1000, l.ctrlAnt / 1000, l.cons / 1000, l.consAnt / 1000]),
          total: [
            "Total aplicações financeiras",
            d.composicao.reduce((s, l) => s + l.ctrl, 0) / 1000,
            d.composicao.reduce((s, l) => s + l.ctrlAnt, 0) / 1000,
            d.composicao.reduce((s, l) => s + l.cons, 0) / 1000,
            d.composicao.reduce((s, l) => s + l.consAnt, 0) / 1000,
          ],
        },
        {
          nome: "1C - CP x LP",
          titulo: "RELATÓRIO 1C – Circulante vs Não Circulante + Remuneração (Consolidado) · R$ mil",
          colunas: [{ titulo: "Tipo de aplicação", largura: 40 }, { titulo: "Remuneração média", largura: 36 }, { titulo: "Circulante", tipo: "inteiro" }, { titulo: "Não circulante", tipo: "inteiro" }, { titulo: "Total", tipo: "inteiro" }],
          linhas: d.cplp.map((l) => [l.tipo, l.remuneracao, l.circulante / 1000, l.naoCirculante / 1000, (l.circulante + l.naoCirculante) / 1000]),
          total: ["TOTAL", "", circ / 1000, naoCirc / 1000, (circ + naoCirc) / 1000],
        },
        {
          nome: "Texto da nota",
          titulo: "Minuta do texto da nota explicativa",
          colunas: [{ titulo: "Texto", largura: 120 }],
          linhas: textoNota.split("\n").map((l) => [l]),
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
          <HeaderKpi label="Consolidado" value={fmtCompact(d.movCons.saldoFinal)} sub={fmtDate(p.dataBase)} />
          <HeaderKpi label="Controladora" value={fmtCompact(d.movCtrl.saldoFinal)} />
          <HeaderKpi label="Rendimentos no exercício" value={fmtCompact(d.movCons.rendimentos)} state="positive" sub="consolidado" />
          <HeaderKpi label="Remuneração média" value={`${fmtDec(d.mediaCDI * 100, 1)}%`} sub="do CDI (pós-fixados)" />
        </>
      }
      headerExtra={
        <div className="border-b border-line-soft -mb-5">
          <TabBar
            value={aba}
            onChange={setAba}
            items={[
              { value: "mov", label: "1B · Movimentação" },
              { value: "comp", label: "1A · Controladora × Consolidado" },
              { value: "cplp", label: "1C · Circulante × Não circulante" },
              { value: "nota", label: "Texto da nota" },
            ]}
          />
        </div>
      }
    >
      {aba === "mov" && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <Card className="xl:col-span-3" title="Movimentação das aplicações financeiras" subtitle="Saldo inicial → (+) Rendimentos → (+) Aplicações → (−) Resgates → (−) IRRF → Saldo final">
            <NotaTabela
              cabecalho={["Controladora", "Consolidado"]}
              linhas={linhasMov.map((l) => ({ rotulo: l.rotulo, valores: [l.v(d.movCtrl), l.v(d.movCons)], forte: l.forte }))}
            />
            <p className="text-[13px] text-text mt-4">
              <strong>Nota:</strong> as aplicações pós-fixadas são remuneradas à média de {fmtDec(d.mediaCDI * 100, 1)}% do CDI e
              mantidas para atender compromissos de investimentos.
            </p>
          </Card>
          <Card className="xl:col-span-2" title="Resgates e novas aplicações do exercício" subtitle="Consolidado">
            <ListaOps titulo="Novas aplicações" ops={d.movCons.novasAplicacoes} valor={(o) => o.principal} />
            <div className="h-4" />
            <ListaOps titulo="Resgates (líquidos)" ops={d.movCons.resgates.map((r) => r.op)} valor={(o) => d.movCons.resgates.find((r) => r.op === o)!.liquido} />
          </Card>
        </div>
      )}

      {aba === "comp" && (
        <Card title="Aplicações: Controladora vs Consolidado" subtitle="Composição por tipo de aplicação (modelo ITR/DFP)">
          <NotaTabela
            grupos={["Controladora", "Consolidado"]}
            cabecalho={[fmtDate(p.dataBase), fmtDate(inicio), fmtDate(p.dataBase), fmtDate(inicio)]}
            linhas={[
              ...d.composicao.map((l) => ({ rotulo: l.tipo, valores: [l.ctrl, l.ctrlAnt, l.cons, l.consAnt] })),
              {
                rotulo: "Total aplicações financeiras",
                forte: true,
                valores: [
                  d.composicao.reduce((s, l) => s + l.ctrl, 0),
                  d.composicao.reduce((s, l) => s + l.ctrlAnt, 0),
                  d.composicao.reduce((s, l) => s + l.cons, 0),
                  d.composicao.reduce((s, l) => s + l.consAnt, 0),
                ],
              },
            ]}
          />
        </Card>
      )}

      {aba === "cplp" && (
        <Card title="Aplicações: Circulante vs Não Circulante + Remuneração" subtitle="Consolidado · remuneração média ponderada contratada">
          <div className="overflow-x-auto fiori-scroll">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-[13px]">
                  <th className="text-left font-semibold py-2 border-b border-[#a8b2bd]">Tipo de aplicação</th>
                  <th className="text-left font-semibold py-2 border-b border-[#a8b2bd]">Remuneração média</th>
                  <th className="text-right font-semibold py-2 border-b border-[#a8b2bd]">Circulante</th>
                  <th className="text-right font-semibold py-2 border-b border-[#a8b2bd]">Não circulante</th>
                  <th className="text-right font-semibold py-2 border-b border-[#a8b2bd]">Total</th>
                </tr>
              </thead>
              <tbody>
                {d.cplp.map((l) => (
                  <tr key={l.tipo}>
                    <td className="py-2.5 border-b border-line-soft">{l.tipo}</td>
                    <td className="py-2.5 border-b border-line-soft text-label">{l.remuneracao}</td>
                    <td className="py-2.5 border-b border-line-soft text-right tabular">{fmtMil(l.circulante)}</td>
                    <td className="py-2.5 border-b border-line-soft text-right tabular">{fmtMil(l.naoCirculante)}</td>
                    <td className="py-2.5 border-b border-line-soft text-right tabular font-semibold">{fmtMil(l.circulante + l.naoCirculante)}</td>
                  </tr>
                ))}
                <tr className="font-bold bg-[#f5f6f7]">
                  <td className="py-2.5 px-0">Total</td>
                  <td />
                  <td className="py-2.5 text-right tabular">{fmtMil(circ)}</td>
                  <td className="py-2.5 text-right tabular">{fmtMil(naoCirc)}</td>
                  <td className="py-2.5 text-right tabular">{fmtMil(circ + naoCirc)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="text-xs text-label mt-4 space-y-1">
            <li>(i) Circulante: vencimento em até 12 meses, liquidez diária ou mensuradas a VJR.</li>
            <li>(ii) Equivalentes de caixa com liquidez diária são mensurados ao valor justo por meio do resultado.</li>
            <li>(iii) A análise de exposição a riscos de taxas de juros é divulgada na nota de instrumentos financeiros.</li>
          </ul>
        </Card>
      )}

      {aba === "nota" && (
        <Card
          title="Minuta do texto da nota explicativa"
          subtitle="Gerada automaticamente com os números da data-base – revise antes de publicar"
          actions={
            <Button
              icon={<Copy className="w-4 h-4" />}
              onClick={() => {
                const selecionarTexto = () => {
                  const el = document.getElementById("texto-nota");
                  const sel = window.getSelection();
                  if (!el || !sel) return;
                  const range = document.createRange();
                  range.selectNodeContents(el);
                  sel.removeAllRanges();
                  sel.addRange(range);
                  toast.info("Texto selecionado – use Ctrl+C para copiar");
                };
                try {
                  navigator.clipboard.writeText(textoNota).then(() => toast.success("Texto copiado"), selecionarTexto);
                } catch {
                  selecionarTexto();
                }
              }}
            >
              Copiar
            </Button>
          }
        >
          <article id="texto-nota" className="max-w-3xl text-[15px] leading-relaxed text-text space-y-3">
            {textoNota.split("\n\n").map((par, i) => (i === 0 ? <h3 key={i} className="text-lg font-bold">{par}</h3> : <p key={i}>{par}</p>))}
          </article>
        </Card>
      )}

      <MessageStrip>
        Valores em R$ mil. Período do exercício: {fmtDate(inicio)} a {fmtDate(p.dataBase)}. Resgates apresentados líquidos
        de IRRF e IOF retidos na fonte, que aparecem em linhas próprias (CPC 40 / CPC 48 / CVM 475).
      </MessageStrip>
    </ReportPage>
  );
}

function NotaTabela({
  cabecalho,
  grupos,
  linhas,
}: {
  cabecalho: string[];
  grupos?: string[];
  linhas: { rotulo: string; valores: number[]; forte?: boolean }[];
}) {
  return (
    <div className="overflow-x-auto fiori-scroll">
      <table className="w-full text-sm min-w-[520px]">
        <thead>
          {grupos && (
            <tr className="text-[13px]">
              <th />
              {grupos.map((g) => (
                <th key={g} colSpan={cabecalho.length / grupos.length} className="text-center font-bold py-1.5 border-b border-line-soft">
                  {g}
                </th>
              ))}
            </tr>
          )}
          <tr className="text-[13px]">
            <th className="text-left font-semibold py-2 border-b border-[#a8b2bd]">R$ mil</th>
            {cabecalho.map((c, i) => (
              <th key={i} className="text-right font-semibold py-2 pl-4 border-b border-[#a8b2bd] whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className={l.forte ? "font-bold bg-[#f5f6f7]" : ""}>
              <td className={l.forte ? "py-2.5 pl-2 border-y border-[#a8b2bd]" : "py-2 pl-2 border-b border-line-soft"}>{l.rotulo}</td>
              {l.valores.map((v, i) => (
                <td key={i} className={`text-right tabular pl-4 pr-2 ${l.forte ? "py-2.5 border-y border-[#a8b2bd]" : "py-2 border-b border-line-soft"}`}>
                  {fmtMil(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListaOps({ titulo, ops, valor }: { titulo: string; ops: Operacao[]; valor: (o: Operacao) => number }) {
  return (
    <div>
      <div className="text-[13px] font-bold text-text mb-1">
        {titulo} <span className="text-label font-normal">({ops.length})</span>
      </div>
      {ops.length === 0 ? (
        <p className="text-sm text-label">Nenhuma no período.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {ops.map((o) => (
            <li key={o.transacao} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
              <span className="min-w-0 truncate">
                <span className="font-semibold text-text">{o.produto}</span> <span className="text-label">· {o.contraparte} · {o.empresa}</span>
              </span>
              <span className="tabular text-text whitespace-nowrap">{fmtCompact(valor(o))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
