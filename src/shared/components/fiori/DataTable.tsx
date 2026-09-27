import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
  /** valor usado para ordenação e exportação */
  value?: (row: T) => number | string | null | undefined;
  total?: (rows: T[]) => ReactNode;
  sortable?: boolean;
  sticky?: boolean;
  minWidth?: number;
  headerTitle?: string;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  totalLabel?: string;
  showTotals?: boolean;
  emptyText?: string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  maxHeight?: number;
  rowClassName?: (row: T) => string | undefined;
  navigation?: boolean;
}

/** Tabela no padrão .dx-tabela: cabeçalho mono sobre filete cerceta, números em IBM Plex Mono, ordenação e totais */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  totalLabel = "Total",
  showTotals,
  emptyText = "Nenhum dado encontrado",
  defaultSort,
  maxHeight,
  rowClassName,
  navigation,
}: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(defaultSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return rows;
    const get = col.value;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return sort.dir === "asc" ? r : -r;
    });
  }, [rows, sort, columns]);

  const toggle = (c: Column<T>) => {
    if (c.sortable === false || !c.value) return;
    setSort((s) => {
      if (!s || s.key !== c.key) return { key: c.key, dir: c.align === "right" ? "desc" : "asc" };
      if (s.dir === (c.align === "right" ? "desc" : "asc")) return { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" };
      return null;
    });
  };

  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <div className="overflow-auto fiori-scroll" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-[2]">
          <tr>
            {columns.map((c, i) => {
              const ativo = sort?.key === c.key;
              const clicavel = c.sortable !== false && !!c.value;
              return (
                <th
                  key={c.key}
                  scope="col"
                  title={c.headerTitle}
                  aria-sort={ativo ? (sort!.dir === "asc" ? "ascending" : "descending") : clicavel ? "none" : undefined}
                  onClick={() => toggle(c)}
                  style={{ minWidth: c.minWidth }}
                  className={clsx(
                    "bg-surface-2 px-3 py-2.5 text-text border-b-2 border-brand whitespace-nowrap select-none transition-colors",
                    align(c.align),
                    clicavel && "cursor-pointer hover:text-link",
                    c.sticky && "sticky left-0 z-[3]",
                    i === 0 && "pl-4",
                  )}
                >
                  <span className={clsx("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                    {c.header}
                    {ativo &&
                      (sort!.dir === "asc" ? (
                        <ArrowUp className="w-3.5 h-3.5 text-link" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-link" />
                      ))}
                  </span>
                </th>
              );
            })}
            {navigation && <th className="bg-surface-2 border-b-2 border-brand w-8" />}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length + (navigation ? 1 : 0)} className="py-12 text-center text-label">
                {emptyText}
              </td>
            </tr>
          )}
          {sorted.map((row) => {
            const k = rowKey(row);
            const sel = selectedKey === k;
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(
                  "group",
                  onRowClick && "cursor-pointer",
                  sel ? "bg-selected" : "bg-surface hover:bg-hover",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={clsx(
                      "px-3 py-2 border-b border-line-soft align-middle",
                      align(c.align),
                      c.align === "right" ? "tabular whitespace-nowrap text-text" : "text-suave",
                      c.sticky && clsx("sticky left-0 z-[1]", sel ? "bg-selected" : "bg-surface group-hover:bg-hover"),
                      i === 0 && "pl-4",
                      i === 0 && sel && "shadow-[inset_3px_0_0_#009994]",
                      c.className,
                    )}
                  >
                    {c.render ? c.render(row) : String(c.value?.(row) ?? "")}
                  </td>
                ))}
                {navigation && (
                  <td className="border-b border-line-soft pr-3 text-right">
                    <ChevronRight className="w-4 h-4 text-label inline" />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        {showTotals && sorted.length > 0 && (
          <tfoot className="sticky bottom-0 z-[2]">
            <tr>
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={clsx(
                    "bg-surface-3 px-3 py-2.5 font-semibold text-text border-t border-line whitespace-nowrap",
                    align(c.align),
                    c.align === "right" && "tabular",
                    c.sticky && "sticky left-0 z-[3]",
                    i === 0 && "pl-4",
                  )}
                >
                  {i === 0 && !c.total ? totalLabel : c.total ? c.total(sorted) : ""}
                </td>
              ))}
              {navigation && <td className="bg-surface-3 border-t border-line" />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
