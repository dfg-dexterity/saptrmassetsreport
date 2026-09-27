# Guia técnico – produto Captações Financeiras

Este guia orienta a implementação das telas do produto **Captações Financeiras** (demo do Reporting Pack com a identidade
visual da Dexterity). O produto é **separado** do produto Aplicações Financeiras: tem página própria (`captacoes.html`), rotas,
Launchpad e relatórios próprios, mas reutiliza os componentes compartilhados em `src/shared`.

## Regras gerais

- Interface 100% em português do Brasil, números no padrão pt-BR (use os formatadores de `src/shared/lib/format.ts`).
- Visual Dexterity (tema escuro do site, `src/styles/dexterity.css`): use **somente** os componentes de
  `src/shared/components/fiori` e as classes Tailwind com os tokens do tema (`text-text`, `text-suave`, `text-label`,
  `text-link`, `bg-page`, `bg-surface`, `bg-surface-2`, `bg-surface-3`, `border-line-soft`, `border-line`,
  `text-positive`, `text-critical`, `text-negative`, `bg-selected`, `font-display`, `font-mono` …). Cantos vivos (sem
  `rounded-full` fora de ponto de status e spinner), filete de 1px no lugar de sombra, cerceta como cor de ação (em
  texto, `text-link`), alta/baixa em cerceta/âmbar e vermelho só para limite excedido ou divergência. Nada de novas
  dependências npm.
- Gráficos com Recharts **sempre** com `isAnimationActive={false}` em `Bar`/`Line`/`Area`/`Pie` (a página precisa estar
  completa no primeiro quadro). Eixos com `tick={AXIS_STYLE}`; paleta `CHART_COLORS` / `CHART_SEMANTIC` de `Kpi.tsx`.
- Toda página de relatório usa `ReportPage` (`src/shared/components/shell/ReportPage.tsx`), que já traz a barra
  superior, o cabeçalho (título, atributos, KPIs, botões) e o aviso obrigatório de dados fictícios
  (`AVISO_DADOS`). Não duplique esse aviso dentro das páginas de relatório.
- Exportação: botão "Exportar Excel" via `onExport` do `ReportPage`, gerando as planilhas com
  `exportarExcel(nomeArquivo, planilhas, dataBase)` de `src/shared/lib/exportar.ts` (ver exemplos nas telas de
  Aplicações). Nunca chame `window.print()` nem crie links de download.
- Layout responsivo (funciona com 390 px de largura): grids com `grid-cols-1 lg:grid-cols-…`, tabelas largas dentro
  de `DataTable` ou `div.overflow-x-auto.fiori-scroll`. O corpo da página nunca pode rolar na horizontal.
- Não edite arquivos fora dos que foram atribuídos a você. Se precisar de um helper, crie-o dentro do seu arquivo.
- Verificação: `npx tsc --noEmit` a partir da raiz do repositório. Corrija **apenas** erros dos seus arquivos (outras
  pessoas podem estar editando `src/aplicacoes` ao mesmo tempo; ignore erros de lá).

## Telas de referência (produto Aplicações – copie os padrões)

| Padrão | Arquivo |
| --- | --- |
| Launchpad (shell, saudação, KPIs, seções com tiles, cards de alertas, central de alertas) | `src/aplicacoes/apps/Launchpad.tsx` |
| List report com barra de filtros, `DataTable` com totais, painel de detalhe lateral e exportação | `src/aplicacoes/apps/R01Composicao.tsx` |
| Quadro mensal (meses em colunas) + gráficos compostos | `src/aplicacoes/apps/R05Evolucao.tsx` |
| Nota explicativa com abas (`TabBar` no `headerExtra`), valores em R$ mil, minuta de texto com "Copiar" | `src/aplicacoes/apps/R02Movimentacao.tsx` |
| Donuts, barras e tabela de enquadramento com semáforo | `src/aplicacoes/apps/R07Concentracao.tsx` |
| Covenants, série trimestral e composição da dívida | `src/aplicacoes/apps/R06Indicadores.tsx` |
| Tabela de parâmetros | `src/aplicacoes/apps/PremissasApp.tsx` |

## Componentes compartilhados (`src/shared/components`)

- `fiori/Card.tsx`: `Card({title, subtitle, actions, icon, status, className, bodyClassName})`, `SectionTitle`, `Field({label})`.
- `fiori/DataTable.tsx`: `DataTable<T>({columns: Column<T>[], rows, rowKey, onRowClick?, selectedKey?, showTotals?, defaultSort?, maxHeight?, navigation?})`.
  `Column<T>`: `{key, header, align?: "left"|"right"|"center", render?, value? (ordenação), total? (linha de totais), sticky?, minWidth?, headerTitle?}`.
- `fiori/Inputs.tsx`: `FilterField({label})`, `Select({value, onChange, options})`, `SearchField`, `NumberInput`, `SegmentedButton({value, onChange, items})`, `TabBar({value, onChange, items})`.
- `fiori/Kpi.tsx`: `HeaderKpi({label, value, unit?, state?, sub?})` (use no `kpis` do `ReportPage`), `MicroBar({value, max, color, marker})`, `CHART_COLORS`, `CHART_SEMANTIC`, `AXIS_STYLE`.
- `fiori/ObjectStatus.tsx`: `ObjectStatus({state: "positive"|"critical"|"negative"|"information"|"neutral", inverted?, icon?})`, `semaforoState(s)`, `Tag({color?})`.
- `fiori/MessageStrip.tsx`: `MessageStrip({design: "information"|"positive"|"critical"|"negative"})`.
- `fiori/GenericTile.tsx`: tile do Launchpad (`title, subtitle, icon, iconColor, value, unit, state, footer, footerState, wide, chart, onClick`).
- `fiori/Button.tsx`: `Button({variant: "emphasized"|"default"|"transparent"|…, icon, size})`.
- `shell/ShellBar.tsx`: `ShellBar({appTitle?, back?, search?})` – usada diretamente só no Launchpad.
- `shell/ReportPage.tsx`: `ReportPage({relatorio, kpis?, headerExtra?, onExport?, actions?, children})`.

## Contextos e dados

- `usePremissas()` (`src/shared/context/MercadoContext.tsx`): `{premissas, definirDataBase}`. `premissas` =
  `PremissasMercado` (`dataBase`, `cdi`, `selic`, `ipca12m`, `tjlp`, `tlpReal`, `baseDiasCorridos`, `baseDiasUteis`),
  importadas do SAP. `DATAS_BASE` = datas-base disponíveis.
- `useProduto()` (`src/shared/context/ProdutoContext.tsx`): `{nome, descricao, secoes, alertas, …}`.
- `src/shared/data/mercado.ts`: `AVISO_DADOS`, `IMPORTACAO_SAP` (`sistema`, `ultimaImportacao`, `ultimoDadoDisponivel`),
  `FONTES_SAP`, `CDI_MENSAL`, `premissasNaDataBase(data)`.
- `src/shared/data/empresas.ts`: `EMPRESAS`, `EMPRESA_CONTROLADORA` ("1000"), `ESCOPOS` (filtro de empresa).
- `src/shared/data/corporativo.ts`: `DADOS_CORPORATIVOS` (caixa, EBITDA LTM, PL, ativo total, imóveis a pagar por trimestre), `GERACAO_CAIXA_ICSD`.
- `src/shared/lib/dates.ts`: `fmtDate`, `fmtMonthShort`, `fmtMonthLong`, `fmtQuarter`, `addDays`, `addMonths`, `diffDays`, `previousYearEnd`, `previousMonthEnd`, `lastMonthEnds(data, n)`, `endOfMonth`.
- `src/shared/lib/format.ts`: `fmtBRL(v, decimais?)`, `fmtNum(v, {parens, dash})`, `fmtMil` (R$ mil de nota explicativa), `fmtCompact` ("R$ 68,4 mi"), `fmtMi`, `fmtPct(frac, casas)`, `fmtX(v)`, `fmtInt`, `fmtDec`.

## Captações – dados e motor (`src/captacoes`)

- `data/catalogo.ts`: `SECOES_CAPTACOES`, `RELATORIOS_CAPTACOES`, `relatorioCaptacao(id)` (ids: `premissas`, `c00`,
  `c01`, `c02`, `c03`, `c04`, `c05`, `c06`, `cds`), `MAPEAMENTO_C00`.
- `data/contratos.ts`: `CONTRATOS: ContratoDivida[]` (11 ativos em 31/03/2026 + 1 liquidado), `taxaContratadaDivida(c)`,
  `GRUPO_MODALIDADE` (modalidade → "BNDES" | "Debêntures" | "CRA" | "CRI" | "CCB"), `EMPRESAS_DIVIDA`.
  Campos: `id, transacao, empresa, modalidade, instrumento, credor, agente, formaBNDES?, indexador, spread,
  spreadAgente?, dataCaptacao, vencimento, valorCaptado, custosTransacao, amortizacoes[{data, pct}], datasJuros,
  descricaoAmortizacao, descricaoJuros, garantias, covenants[], finalidade, lastro?, capitalizacaoCPC20?{ate, ativo},
  portfolio, linhaCredito?`.
- `lib/divida.ts` (motor, custo amortizado; CDI/títulos em 252 dias úteis, BNDES em 365 dias corridos, TJLP > 6% capitalizada, datas no dia útil seguinte):
  - `posicoesDivida(contratos, data, p, reclassificados?)` → `PosicaoDivida[]` com `principalNominal`,
    `principalAtualizado`, `atualizacaoMonetaria`, `jurosAPagar`, `custosAApropriar`, `saldoContabil`,
    `principalCirculante`, `custosCirculante`, `circulante`, `naoCirculante`, `reclassificado`, `taxaEfetivaAA`
    (juros + correção, a.a.), `cet` (custo efetivo total com custos de transação), `prazoMedioAnos`,
    `proximoPagamento {data, principal, juros} | null`, `diasAteVencimento`.
  - `totalDivida(pos)`, `custoMedioPonderado(pos)` (alimenta Premissas e R06), `prazoMedioCarteira(pos)`.
  - `movimentacaoDivida(contratos, inicio, fim, p)` → `{linhas: MovContrato[], total}` com `saldoInicial, captacoes,
    custosTransacao (−), juros, atualizacaoMonetaria, apropriacaoCustos, pagamentoPrincipal (−), pagamentoJuros (−),
    saldoFinal, capitalizados`; `diferencaRollforward(total)` ≈ 0.
  - `encargosDivida(contratos, inicio, fim, p)` → por contrato: `saldoMedio, juros, atualizacaoMonetaria,
    apropriacaoCustos, total, capitalizados, despesaFinanceira, taxaPeriodo, taxaAnualizada`.
  - `eventosFuturos(c, data, p)` / `cronograma(contratos, data, p)` → pagamentos projetados (principal e juros) com o
    último dado disponível; `perfilAmortizacao(pos, data)` → `{circulante, porAno: Map<ano, principal>}`.
  - `servicoDivida(contratos, inicio, fim, p)`, `ativoEm(c, data)`, `saldoContabil(c, data, p)`.
- `lib/covenants.ts`: `apurarCovenants(dataBase)` → `ApuracaoCovenant[]` (`cov`, `dataApuracao`, `valor`, `status`
  "ok"|"atencao"|"excedido", `folga`, `waiver`, `waiverVigente`, `reclassifica`, `historico[{data, valor}]`);
  `reclassificadosEm(dataBase)`; `indicadoresEm(fimDeTrimestre)` (dívida bruta, caixa, aplicações, DL, EBITDA,
  encargos LTM, PL, ativo, imóveis, dlEbitda, ebitdaDespFin, capitalizacao, dlImoveisPl); `icsdDoAno(ano)`;
  `trimestresAte(data)`. Definições em `data/covenants.ts` (`COVENANTS_DIVIDA`, `WAIVERS`).
- `lib/fechamento.ts`: `conciliacaoGL(pos, dataBase)`, `conciliacaoExtratos(pos, dataBase)`,
  `checagensIntegridade(pos, dataBase, p, gl, extratos)`, `checklistFechamento(dataBase, checagens)`; parametrização em
  `data/fechamento.ts` (`CONTAS_CONTABEIS`, `TOLERANCIA_CONCILIACAO`, `CHECKLIST_FECHAMENTO`, `grupoContabil`).
- `context/useDivida.ts`: `useDivida(escopo)` → `{premissas, contratos, posicoes (já com reclassificação CPC 26),
  reclassificados, abertura (31/12 do exercício anterior)}`, `useCovenants()`, `ESCOPOS`, `contratosDoEscopo(escopo)`.

Datas-base disponíveis: 31/10/2025 a 31/03/2026 (padrão 31/03/2026). Em 31/12/2025 o ICSD de 2025 (≈1,26x < 1,30x) está
descumprido e o waiver só foi obtido em 20/01/2026 → os contratos BNDES (BND-01, BND-02) têm o não circulante
reclassificado para o circulante nessa data-base (CPC 26, item 74). Em 31/03/2026 o waiver já está vigente.
