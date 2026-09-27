import { toast } from "sonner";
import { EM_ARTIFACT, obterDownloads } from "./ambiente";
import { fmtDate } from "./dates";

export type TipoColuna = "texto" | "moeda" | "pct" | "data" | "inteiro" | "decimal";

export interface ColunaExport {
  titulo: string;
  tipo?: TipoColuna;
  largura?: number;
}

export interface PlanilhaExport {
  nome: string;
  titulo: string;
  subtitulo?: string;
  colunas: ColunaExport[];
  linhas: (string | number | null | undefined)[][];
  total?: (string | number | null | undefined)[];
  notas?: string[];
}

const FORMATO: Record<TipoColuna, string | undefined> = {
  texto: undefined,
  moeda: "#,##0.00;(#,##0.00)",
  pct: "0.00%",
  data: "dd/mm/yyyy",
  inteiro: "#,##0",
  decimal: "#,##0.00",
};

function isoParaData(v: string): Date {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Gera um .xlsx real (write-excel-file, carregado sob demanda) com título, cabeçalho e totais formatados */
export async function exportarExcel(arquivo: string, planilhas: PlanilhaExport[], dataBase: string) {
  try {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const sheets = planilhas.map((pl) => {
      const n = pl.colunas.length;
      const pad = (row: object[]) => [...row, ...Array(Math.max(0, n - row.length)).fill(null)];
      const data: unknown[][] = [];
      data.push(pad([{ value: pl.titulo, fontWeight: "bold", fontSize: 14, textColor: "#1D2D3E" }]));
      data.push(
        pad([
          {
            value: `${pl.subtitulo ? pl.subtitulo + " · " : ""}Data-base: ${fmtDate(dataBase)} · Dados fictícios (demo)`,
            textColor: "#556B82",
          },
        ]),
      );
      data.push(pad([]));
      data.push(
        pl.colunas.map((c) => ({
          value: c.titulo,
          fontWeight: "bold",
          textColor: "#FFFFFF",
          backgroundColor: "#0070F2",
          align: c.tipo && c.tipo !== "texto" ? "right" : "left",
        })),
      );
      const cell = (v: string | number | null | undefined, c: ColunaExport, bold = false) => {
        if (v === null || v === undefined || v === "") return null;
        const tipo = c.tipo ?? "texto";
        if (tipo === "data" && typeof v === "string") {
          return { value: isoParaData(v), type: Date, format: FORMATO.data, fontWeight: bold ? "bold" : undefined };
        }
        if (typeof v === "number") {
          return { value: v, type: Number, format: FORMATO[tipo], fontWeight: bold ? "bold" : undefined };
        }
        return { value: String(v), type: String, fontWeight: bold ? "bold" : undefined };
      };
      for (const linha of pl.linhas) data.push(pl.colunas.map((c, i) => cell(linha[i], c)));
      if (pl.total) {
        data.push(
          pl.colunas.map((c, i) => ({
            ...(cell(pl.total![i], c, true) ?? { value: "" }),
            backgroundColor: "#EFF1F2",
            topBorderStyle: "thin",
            topBorderColor: "#A8B2BD",
          })),
        );
      }
      if (pl.notas?.length) {
        data.push(pad([]));
        for (const nota of pl.notas) data.push(pad([{ value: nota, textColor: "#556B82", fontStyle: "italic" }]));
      }
      return {
        sheet: pl.nome.slice(0, 31),
        data,
        columns: pl.colunas.map((c) => ({ width: c.largura ?? (c.tipo === "texto" || !c.tipo ? 22 : 16) })),
        stickyRowsCount: 4,
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const planilha = writeXlsxFile(sheets as any, { fontFamily: "Arial", fontSize: 10 });
    if (EM_ARTIFACT) {
      await salvarNoViewer(arquivo, await planilha.toBlob());
      return;
    }
    await planilha.toFile(arquivo);
    toast.success(`Arquivo ${arquivo} gerado`);
  } catch (e) {
    console.error(e);
    toast.error("Não foi possível gerar o arquivo Excel");
  }
}

/** No viewer do claude.ai o arquivo é entregue pela capacidade `downloads` (o usuário confirma o salvamento). */
async function salvarNoViewer(arquivo: string, blob: Blob) {
  const downloads = await obterDownloads();
  if (!downloads) {
    toast.error("A exportação para Excel não está disponível nesta visualização");
    return;
  }
  try {
    const r = await downloads.save({ filename: arquivo, data: blob });
    if (r.status === "saved") toast.success(`Arquivo ${arquivo} salvo`);
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "declined") toast.info("Download cancelado");
    else if (code === "rate_limited") toast.info("Já existe um download aguardando confirmação");
    else toast.error("Não foi possível salvar o arquivo nesta visualização");
  }
}
