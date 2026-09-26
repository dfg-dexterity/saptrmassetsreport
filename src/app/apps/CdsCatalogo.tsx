import clsx from "clsx";
import { ArrowRight, Database, KeyRound, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Card } from "../components/fiori/Card";
import { DataTable } from "../components/fiori/DataTable";
import { SearchField, SegmentedButton, TabBar } from "../components/fiori/Inputs";
import { HeaderKpi } from "../components/fiori/Kpi";
import { MessageStrip } from "../components/fiori/MessageStrip";
import { Tag } from "../components/fiori/ObjectStatus";
import { ReportPage } from "../components/shell/ReportPage";
import { MAPEAMENTO_R01, relatorioPorId } from "../data/catalogo";
import cds from "../data/cds.json";
import { usePremissas } from "../context/PremissasContext";
import { exportarExcel } from "../lib/exportar";
import { fmtInt } from "../lib/format";

const rel = relatorioPorId("cds");

interface Campo {
  pos: number;
  campo: string;
  tabelaBase: string;
  campoBase: string;
  chave: boolean;
  elementoDados: string;
  dominio: string;
  valoresFixos: boolean;
  tabelaValores: string | null;
  rotinaConversao: string | null;
  descricao: string;
}

interface Visao {
  nome: string;
  descricao: string | null;
  campos: Campo[];
}

const VISOES = cds as Visao[];
const NOMES = new Set(VISOES.map((v) => v.nome));

type Aba = "visoes" | "dominios" | "dependencias" | "mapeamento";
type TipoFiltro = "todas" | "C" | "I";

const tipoVisao = (nome: string) => (nome.startsWith("C") ? "Consumo" : "Interface");

export function CdsCatalogo() {
  const { premissas: p } = usePremissas();
  const [aba, setAba] = useState<Aba>("visoes");
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<TipoFiltro>("todas");
  const [sel, setSel] = useState<string>("IFINTRAN");
  const [buscaCampo, setBuscaCampo] = useState("");

  const dominios = useMemo(() => {
    const map = new Map<string, { dominio: string; elementos: Set<string>; valoresFixos: boolean; tabelaValores: string | null; usos: number; exemplo: string }>();
    for (const v of VISOES)
      for (const c of v.campos) {
        if (!c.dominio) continue;
        const d = map.get(c.dominio) ?? { dominio: c.dominio, elementos: new Set<string>(), valoresFixos: false, tabelaValores: null, usos: 0, exemplo: c.descricao };
        d.elementos.add(c.elementoDados);
        d.valoresFixos ||= c.valoresFixos;
        d.tabelaValores ||= c.tabelaValores;
        d.usos++;
        map.set(c.dominio, d);
      }
    return [...map.values()].sort((a, b) => b.usos - a.usos);
  }, []);

  const dependencias = useMemo(
    () =>
      VISOES.map((v) => {
        const bases = [...new Set(v.campos.map((c) => c.tabelaBase).filter(Boolean))];
        return { visao: v.nome, descricao: v.descricao, bases };
      }),
    [],
  );

  const t = busca.trim().toLowerCase();
  const lista = VISOES.filter(
    (v) => (tipo === "todas" || v.nome.startsWith(tipo)) && (!t || v.nome.toLowerCase().includes(t) || (v.descricao ?? "").toLowerCase().includes(t)),
  );
  const visao = VISOES.find((v) => v.nome === sel) ?? VISOES[0];
  const tc = buscaCampo.trim().toLowerCase();
  const campos = visao.campos.filter((c) => !tc || [c.campo, c.descricao, c.elementoDados, c.campoBase].some((s) => s.toLowerCase().includes(tc)));
  const totalCampos = VISOES.reduce((s, v) => s + v.campos.length, 0);
  const tabelasBase = new Set(VISOES.flatMap((v) => v.campos.map((c) => c.tabelaBase)));

  const exportar = () =>
    exportarExcel(
      `Catalogo_CDS_Views.xlsx`,
      [
        {
          nome: "Lista de CDS",
          titulo: "Catálogo de CDS Views – SAP S/4HANA TRM/FI",
          colunas: [{ titulo: "Visão", largura: 22 }, { titulo: "Descrição", largura: 50 }, { titulo: "Tipo", largura: 12 }, { titulo: "Campos", tipo: "inteiro" }],
          linhas: VISOES.map((v) => [v.nome, v.descricao ?? "", tipoVisao(v.nome), v.campos.length]),
        },
        {
          nome: "DD27VVT",
          titulo: "Campos das CDS Views",
          colunas: [
            { titulo: "Visão", largura: 20 },
            { titulo: "Posição", tipo: "inteiro", largura: 8 },
            { titulo: "Campo visão", largura: 34 },
            { titulo: "Tabela de base", largura: 18 },
            { titulo: "Campo base", largura: 24 },
            { titulo: "Chave", largura: 7 },
            { titulo: "Elemento de dados", largura: 28 },
            { titulo: "Domínio", largura: 24 },
            { titulo: "Valores fixos", largura: 10 },
            { titulo: "Tabela de valores", largura: 16 },
            { titulo: "Descrição breve", largura: 44 },
          ],
          linhas: VISOES.flatMap((v) => v.campos.map((c) => [v.nome, c.pos, c.campo, c.tabelaBase, c.campoBase, c.chave ? "X" : "", c.elementoDados, c.dominio, c.valoresFixos ? "X" : "", c.tabelaValores ?? "", c.descricao])),
        },
        {
          nome: "Domínios",
          titulo: "Domínios utilizados",
          colunas: [{ titulo: "Domínio", largura: 28 }, { titulo: "Elementos de dados", largura: 50 }, { titulo: "Valores fixos", largura: 12 }, { titulo: "Tabela de valores", largura: 18 }, { titulo: "Usos", tipo: "inteiro" }],
          linhas: dominios.map((d) => [d.dominio, [...d.elementos].join(", "), d.valoresFixos ? "X" : "", d.tabelaValores ?? "", d.usos]),
        },
        {
          nome: "DDLDEPENDENCY",
          titulo: "Dependências DDL (visão → fontes)",
          colunas: [{ titulo: "Visão", largura: 22 }, { titulo: "Fonte", largura: 22 }, { titulo: "Fonte é CDS catalogada", largura: 22 }],
          linhas: dependencias.flatMap((d) => d.bases.map((b) => [d.visao, b, NOMES.has(b) ? "Sim" : ""])),
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
          <HeaderKpi label="CDS Views" value={String(VISOES.length)} sub={`${VISOES.filter((v) => v.nome.startsWith("C")).length} consumo · ${VISOES.filter((v) => v.nome.startsWith("I")).length} interface`} />
          <HeaderKpi label="Campos" value={fmtInt(totalCampos)} />
          <HeaderKpi label="Domínios" value={fmtInt(dominios.length)} />
          <HeaderKpi label="Tabelas / fontes" value={fmtInt(tabelasBase.size)} />
        </>
      }
      headerExtra={
        <div className="border-b border-line-soft -mb-5">
          <TabBar
            value={aba}
            onChange={setAba}
            items={[
              { value: "visoes", label: "Visões e campos", count: VISOES.length },
              { value: "dominios", label: "Domínios", count: dominios.length },
              { value: "dependencias", label: "Dependências DDL" },
              { value: "mapeamento", label: "Mapeamento R01" },
            ]}
          />
        </div>
      }
    >
      <MessageStrip>
        Metadados extraídos do dicionário de dados do SAP (DD27V – campos de visões, DDLDEPENDENCY – dependências). A demo
        traz um subconjunto do catálogo com as visões de Tesouraria (dados de mercado, posição, transações financeiras e
        limites de contraparte).
      </MessageStrip>

      {aba === "visoes" && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-5">
          <Card title="Lista de CDS" subtitle={`${lista.length} de ${VISOES.length} visões`} bodyClassName="px-0 pb-0">
            <div className="px-4 pb-3 space-y-2">
              <SearchField value={busca} onChange={setBusca} placeholder="Nome ou descrição" />
              <SegmentedButton
                value={tipo}
                onChange={setTipo}
                items={[
                  { value: "todas", label: "Todas" },
                  { value: "C", label: "Consumo (C)" },
                  { value: "I", label: "Interface (I)" },
                ]}
              />
            </div>
            <ul className="max-h-[560px] overflow-y-auto fiori-scroll border-t border-line-soft">
              {lista.map((v) => (
                <li key={v.nome}>
                  <button
                    type="button"
                    onClick={() => setSel(v.nome)}
                    className={clsx(
                      "w-full text-left px-4 py-2.5 border-b border-line-soft flex items-center gap-3",
                      v.nome === visao.nome ? "bg-selected shadow-[inset_3px_0_0_#0064d9]" : "hover:bg-[#f2f4f6]",
                    )}
                  >
                    <Database className={clsx("w-4 h-4 shrink-0", v.nome.startsWith("C") ? "text-[#5d36ff]" : "text-[#049f9a]")} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[13px] font-semibold text-text">{v.nome}</span>
                      <span className="block text-xs text-label truncate">{v.descricao ?? "—"}</span>
                    </span>
                    <span className="text-xs text-label tabular">{v.campos.length}</span>
                  </button>
                </li>
              ))}
              {lista.length === 0 && <li className="px-4 py-8 text-center text-sm text-label">Nenhuma visão encontrada</li>}
            </ul>
          </Card>

          <Card
            title={<span className="font-mono">{visao.nome}</span>}
            subtitle={visao.descricao ?? "Sem descrição"}
            status={<Tag color={visao.nome.startsWith("C") ? "#5d36ff" : "#049f9a"}>{tipoVisao(visao.nome)}</Tag>}
            bodyClassName="px-0 pb-0"
            className="min-w-0 overflow-hidden"
          >
            <div className="px-4 pb-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <div className="text-[13px] text-label">
                {visao.campos.length} campos · {visao.campos.filter((c) => c.chave).length} chave(s) · fontes:{" "}
                {[...new Set(visao.campos.map((c) => c.tabelaBase))].map((b) => (
                  <button
                    key={b}
                    type="button"
                    disabled={!NOMES.has(b)}
                    onClick={() => setSel(b)}
                    className={clsx("font-mono mr-1.5", NOMES.has(b) ? "text-link hover:underline" : "text-text")}
                  >
                    {b}
                  </button>
                ))}
              </div>
              <SearchField value={buscaCampo} onChange={setBuscaCampo} placeholder="Filtrar campos" className="sm:w-60" />
            </div>
            <DataTable<Campo>
              columns={[
                { key: "pos", header: "#", align: "right", value: (c) => c.pos },
                {
                  key: "campo",
                  header: "Campo visão",
                  value: (c) => c.campo,
                  render: (c) => (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[12px] font-semibold">
                      {c.chave && <KeyRound className="w-3.5 h-3.5 text-[#c87b00]" aria-label="Campo chave" />}
                      {c.campo}
                    </span>
                  ),
                },
                { key: "desc", header: "Descrição breve", value: (c) => c.descricao, minWidth: 200 },
                {
                  key: "base",
                  header: "Tabela/campo base",
                  value: (c) => `${c.tabelaBase}.${c.campoBase}`,
                  render: (c) => (
                    <span className="font-mono text-[12px] text-label">
                      {c.tabelaBase}.<span className="text-text">{c.campoBase}</span>
                    </span>
                  ),
                },
                { key: "el", header: "Elemento de dados", value: (c) => c.elementoDados, render: (c) => <span className="font-mono text-[12px]">{c.elementoDados}</span> },
                {
                  key: "dom",
                  header: "Domínio",
                  value: (c) => c.dominio,
                  render: (c) => (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono text-[12px]">{c.dominio}</span>
                      {c.valoresFixos && <Tag color="#0070f2">valores fixos</Tag>}
                    </span>
                  ),
                },
                { key: "tv", header: "Tabela de valores", value: (c) => c.tabelaValores ?? "", render: (c) => <span className="font-mono text-[12px]">{c.tabelaValores ?? ""}</span> },
              ]}
              rows={campos}
              rowKey={(c) => `${c.pos}-${c.campo}`}
              maxHeight={560}
            />
          </Card>
        </div>
      )}

      {aba === "dominios" && (
        <Card title="Domínios e valores fixos" subtitle="Domínios SAP usados pelos campos catalogados" bodyClassName="px-0 pb-0">
          <DataTable
            columns={[
              { key: "d", header: "Domínio", value: (d) => d.dominio, render: (d) => <span className="font-mono text-[12px] font-semibold">{d.dominio}</span> },
              { key: "e", header: "Elementos de dados", value: (d) => [...d.elementos].join(", "), render: (d) => <span className="font-mono text-[12px] text-label">{[...d.elementos].slice(0, 4).join(", ")}{d.elementos.size > 4 ? ` +${d.elementos.size - 4}` : ""}</span> },
              { key: "x", header: "Exemplo de uso", value: (d) => d.exemplo },
              { key: "vf", header: "Valores fixos", align: "center", value: (d) => (d.valoresFixos ? 1 : 0), render: (d) => (d.valoresFixos ? <Tag color="#0070f2">Sim</Tag> : <span className="text-label">–</span>) },
              { key: "tv", header: "Tabela de valores", value: (d) => d.tabelaValores ?? "", render: (d) => <span className="font-mono text-[12px]">{d.tabelaValores ?? ""}</span> },
              { key: "u", header: "Usos", align: "right", value: (d) => d.usos },
            ]}
            rows={dominios}
            rowKey={(d) => d.dominio}
            defaultSort={{ key: "u", dir: "desc" }}
            maxHeight={640}
          />
        </Card>
      )}

      {aba === "dependencias" && (
        <Card title="Dependências DDL" subtitle="Fontes de cada CDS View (tabelas e visões base) – clique em uma fonte catalogada para abrir">
          <ul className="divide-y divide-line-soft">
            {dependencias.map((d) => (
              <li key={d.visao} className="py-2.5 flex flex-col md:flex-row md:items-center gap-2">
                <div className="md:w-72 shrink-0">
                  <div className="font-mono text-[13px] font-semibold text-text">{d.visao}</div>
                  <div className="text-xs text-label truncate">{d.descricao ?? "—"}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-label hidden md:block shrink-0" />
                <div className="flex flex-wrap gap-1.5">
                  {d.bases.map((b) =>
                    NOMES.has(b) ? (
                      <button
                        key={b}
                        type="button"
                        onClick={() => {
                          setSel(b);
                          setAba("visoes");
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-[#5d36ff]/40 bg-[#5d36ff]/5 px-2 py-0.5 font-mono text-[12px] text-[#5d36ff] hover:bg-[#5d36ff]/10"
                      >
                        <Database className="w-3 h-3" /> {b}
                      </button>
                    ) : (
                      <span key={b} className="inline-flex items-center gap-1 rounded-md border border-line bg-[#f5f6f7] px-2 py-0.5 font-mono text-[12px] text-text">
                        <Table2 className="w-3 h-3 text-label" /> {b}
                      </span>
                    ),
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {aba === "mapeamento" && (
        <Card title="Mapeamento R01 – Composição detalhada" subtitle="Colunas do relatório (aba DD-31) × campos das CDS Views" bodyClassName="px-0 pb-0">
          <DataTable
            columns={[
              { key: "id", header: "ID", value: (m) => m.id, render: (m) => <span className="font-mono text-[12px] font-semibold">{m.id}</span> },
              { key: "col", header: "Coluna do relatório", value: (m) => m.coluna, render: (m) => <span className="font-semibold">{m.coluna}</span> },
              {
                key: "v",
                header: "CDS View",
                value: (m) => m.visao ?? "",
                render: (m) => (m.visao ? <span className="font-mono text-[12px] text-[#5d36ff]">{m.visao}</span> : <Tag>Calculado</Tag>),
              },
              { key: "c", header: "Campo", value: (m) => m.campo ?? "", render: (m) => <span className="font-mono text-[12px]">{m.campo ?? ""}</span> },
              {
                key: "r",
                header: "Descrição / regra",
                value: (m) => m.regra ?? "",
                minWidth: 280,
                render: (m) => {
                  if (m.regra) return <span className="text-label">{m.regra}</span>;
                  const c = VISOES.find((v) => v.nome === m.visao)?.campos.find((x) => x.campo === m.campo);
                  return <span className="text-text">{c ? `${c.descricao} (${c.tabelaBase}.${c.campoBase})` : "—"}</span>;
                },
              },
            ]}
            rows={MAPEAMENTO_R01}
            rowKey={(m) => m.id}
          />
        </Card>
      )}
    </ReportPage>
  );
}
