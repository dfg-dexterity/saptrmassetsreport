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

/** Tabela responsiva no padrão sap.m.Table (Horizon) com ordenação e linha de totais */
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
                  onClick={() => toggle(c)}
                  style={{ minWidth: c.minWidth }}
                  className={clsx(
                    "bg-white px-3 py-2.5 font-semibold text-text text-[13px] border-b border-[#a8b2bd] whitespace-nowrap select-none",
                    align(c.align),
                    clicavel && "cursor-pointer hover:bg-hover",
                    c.sticky && "sticky left-0 z-[3]",
                    i === 0 && "pl-4",
                  )}
                >
                  <span className={clsx("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                    {c.header}
                    {ativo &&
                      (sort!.dir === "asc" ? (
                        <ArrowUp className="w-3.5 h-3.5 text-brand" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-brand" />
                      ))}
                  </span>
                </th>
              );
            })}
            {navigation && <th className="bg-white border-b border-[#a8b2bd] w-8" />}
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
                  sel ? "bg-selected" : "bg-white hover:bg-[#f2f4f6]",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={clsx(
                      "px-3 py-2.5 border-b border-line-soft text-text align-middle",
                      align(c.align),
                      c.align === "right" && "tabular whitespace-nowrap",
                      c.sticky && clsx("sticky left-0 z-[1]", sel ? "bg-selected" : "bg-white group-hover:bg-[#f2f4f6]"),
                      i === 0 && "pl-4",
                      i === 0 && sel && "shadow-[inset_3px_0_0_#0064d9]",
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
                    "bg-[#f5f6f7] px-3 py-2.5 font-bold text-text border-t border-[#a8b2bd] whitespace-nowrap",
                    align(c.align),
                    c.align === "right" && "tabular",
                    c.sticky && "sticky left-0 z-[3]",
                    i === 0 && "pl-4",
                  )}
                >
                  {i === 0 && !c.total ? totalLabel : c.total ? c.total(sorted) : ""}
                </td>
              ))}
              {navigation && <td className="bg-[#f5f6f7] border-t border-[#a8b2bd]" />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
