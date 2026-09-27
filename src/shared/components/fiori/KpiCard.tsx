import clsx from "clsx";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { ObjectStatus, type ValueState } from "./ObjectStatus";

const COR: Record<ValueState, string> = {
  positive: "#256f3a",
  critical: "#b44f00",
  negative: "#aa0808",
  information: "#0070f2",
  neutral: "#1d2d3e",
};

const COR_GRAFICO: Record<ValueState, string> = {
  positive: "#30914c",
  critical: "#e26300",
  negative: "#f53232",
  information: "#0070f2",
  neutral: "#758ca4",
};

export interface KpiIndicadorLateral {
  label: string;
  value: ReactNode;
  state?: ValueState;
}

export interface KpiTendencia {
  /** texto da variação (ex.: "+0,4 p.p. no mês") */
  texto: string;
  direcao: "up" | "down" | "flat";
  /** a variação é boa para a empresa? define a cor da seta */
  favoravel: boolean | null;
}

/**
 * Cartão analítico com cabeçalho numérico (sap.f.Card – Numeric Header): título, valor principal com unidade e cor de
 * estado, seta de tendência, indicadores laterais (meta, desvio), micrográfico de 12 meses e rodapé com status e
 * navegação para o relatório de origem.
 */
export function KpiCard({
  titulo,
  subtitulo,
  valor,
  unidade,
  state = "neutral",
  tendencia,
  laterais,
  serie,
  referencia,
  status,
  rota,
  origem,
  detalhe,
  className,
}: {
  titulo: string;
  subtitulo?: string;
  valor: ReactNode;
  unidade?: string;
  state?: ValueState;
  tendencia?: KpiTendencia;
  laterais?: KpiIndicadorLateral[];
  /** série para o micrográfico (ex.: 12 fins de mês) */
  serie?: { x: string; y: number }[];
  /** linha de referência no micrográfico (meta ou limite) */
  referencia?: number;
  status?: { state: ValueState; texto: string };
  rota?: string;
  /** código do relatório de origem (ex.: "R05") exibido no rodapé */
  origem?: string;
  detalhe?: ReactNode;
  className?: string;
}) {
  const Seta = tendencia?.direcao === "up" ? ArrowUpRight : tendencia?.direcao === "down" ? ArrowDownRight : ArrowRight;
  const corSeta =
    tendencia?.favoravel === null || tendencia?.direcao === "flat"
      ? "text-label"
      : tendencia?.favoravel
        ? "text-positive"
        : "text-negative";
  const corLinha = COR_GRAFICO[state === "neutral" ? "information" : state];
  // domínio com margem mínima (1% do valor) para não exagerar variações ínfimas; a meta estende o domínio
  const dominio = (() => {
    if (!serie || serie.length < 2) return undefined;
    const ys = serie.map((d) => d.y).concat(referencia !== undefined ? [referencia] : []);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const pad = Math.max((max - min) * 0.15, Math.max(Math.abs(min), Math.abs(max)) * 0.01, 1e-9);
    return [min - pad, max + pad] as [number, number];
  })();
  const idGrad = `kpi-${titulo.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <section className={clsx("bg-white rounded-[var(--radius-card)] shadow-fiori print-flat flex flex-col min-w-0", className)}>
      <header className="px-4 pt-3.5">
        <h3 className="text-[15px] font-bold text-text leading-snug">{titulo}</h3>
        {subtitulo && <p className="text-[13px] text-label leading-snug mt-0.5">{subtitulo}</p>}
      </header>

      <div className="px-4 pt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[2rem] leading-none font-light tabular whitespace-nowrap" style={{ color: COR[state] }}>
              {valor}
            </span>
            {unidade && <span className="text-sm text-label whitespace-nowrap">{unidade}</span>}
            {tendencia && <Seta className={clsx("w-5 h-5 self-center shrink-0", corSeta)} aria-hidden />}
          </div>
          {tendencia && <div className={clsx("text-xs mt-1 whitespace-nowrap", corSeta)}>{tendencia.texto}</div>}
        </div>
        {laterais && laterais.length > 0 && (
          <dl className="text-right shrink-0 space-y-1">
            {laterais.map((l) => (
              <div key={l.label}>
                <dt className="text-[11px] text-label leading-tight whitespace-nowrap">{l.label}</dt>
                <dd className="text-[13px] font-semibold tabular leading-tight whitespace-nowrap" style={{ color: COR[l.state ?? "neutral"] }}>
                  {l.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {serie && serie.length > 1 && (
        <div className="h-14 mt-2 px-1" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serie} margin={{ top: 4, right: 8, bottom: 2, left: 8 }}>
              <defs>
                <linearGradient id={idGrad} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={corLinha} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={corLinha} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <YAxis hide domain={dominio ?? ["auto", "auto"]} />
              {referencia !== undefined && (
                <ReferenceLine y={referencia} stroke="#1d2d3e" strokeDasharray="3 3" strokeWidth={1} ifOverflow="extendDomain" />
              )}
              <Area
                type="monotone"
                dataKey="y"
                stroke={corLinha}
                strokeWidth={1.75}
                fill={`url(#${idGrad})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {detalhe && <div className="px-4 pt-2 text-xs text-label leading-relaxed">{detalhe}</div>}

      <footer className="mt-auto px-4 py-2.5 mt-3 border-t border-line-soft flex items-center justify-between gap-2 min-h-[2.5rem]">
        {status ? (
          <ObjectStatus state={status.state}>{status.texto}</ObjectStatus>
        ) : (
          <span />
        )}
        {rota && (
          <Link to={rota} className="text-[13px] text-link hover:underline inline-flex items-center gap-0.5 no-print whitespace-nowrap">
            {origem ?? "Detalhes"}
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </footer>
    </section>
  );
}
