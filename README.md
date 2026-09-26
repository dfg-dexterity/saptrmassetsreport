# Reporting Pack de Aplicações Financeiras – Demo (SAP Fiori Horizon)

Aplicativo de demonstração dos relatórios da planilha **“DXT – CDS View + Pacote de Relatórios”** (Reporting Pack de
Aplicações Financeiras sobre o SAP S/4HANA Treasury and Risk Management), no mesmo formato do demo *Gestão de Lote App*
(Launchpad + aplicativos), com o visual do **SAP Fiori mais recente – tema Horizon** (fonte SAP “72”, shell bar branca,
tiles e cards arredondados, paleta e cores semânticas do Horizon).

> Todos os dados são **fictícios**. Não há backend: o app é 100% estático e pode ser publicado em qualquer servidor.

## O que tem na demo

| Seção do Índice | App | Aba de origem |
| --- | --- | --- |
| 1. Parametrização | **Premissas** – data-base, CDI, Selic, IPCA, custo da dívida, tabelas de IRRF e IOF (editáveis) | Premissas |
| 2. Posição | **R01 – Composição detalhada** (filtros, totais, detalhe da operação com origem nas CDS Views) | DD-31 |
| 2. Posição | **R07 – Concentração da carteira** (limite por grupo econômico, HHI, semáforo da política) | R07-Concentracao |
| 3. Movimentação | **R05 – Evolução mensal** (12 meses, % do CDI, conciliação com R03 e R01) | R05-Evolucao |
| 4. Rentabilidade | **R03 – Rentabilidade realizada e real** (bruto, IOF, IRRF, líquido, % CDI, real) | R03-Rentab |
| 4. Rentabilidade | **R04 – Eficiência fiscal por prazo** (faixas do IR, economia ao aguardar, simulador) | R04-Prazo-Fiscal |
| 5. Indicadores | **R06 – Endividamento × Aplicações** (DL/EBITDA, liquidez, cobertura, carry, covenants) | R06-Indicadores |
| 6. Notas explicativas | **R02 – Movimentação** (1A/1B/1C, Controladora × Consolidado, minuta do texto da nota) | DD-32 |
| 7. Base técnica | **Catálogo de CDS Views** (campos, domínios, dependências DDL, mapeamento do R01) | Lista de CDS · DD27VVT · Domínios · DDLDEPENDENCY |

Destaques:

- **Tudo é calculado a partir das Premissas**: altere a data-base (topo da página) ou o CDI/IPCA/custo da dívida e todos os
  relatórios são recalculados (rendimentos por dias úteis com calendário ANBIMA, IR regressivo, IOF, valor justo, CP/LP).
- **Conciliação automática**: rendimentos do R03 = soma do R05; saldo final do R05 = posição do R01 = saldo do R02.
- **Exportar Excel** em todos os relatórios (arquivo `.xlsx` real, com cabeçalho, totais e notas) e **Imprimir/PDF**.
- **Central de alertas** (sino na shell bar): limites de concentração, covenants, vencimentos, IOF e janelas de IR.
- Layout responsivo (desktop, tablet e celular).

## Rodando localmente

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # gera a pasta dist/
npm run preview    # serve o build em http://localhost:4173
```

## Publicando no site

O build (`dist/`) é estático e usa **rotas com hash** (`/#/r01-composicao`) e caminhos relativos, então funciona em
qualquer subpasta do site, sem configuração de servidor:

1. `npm run build`
2. Copie o conteúdo de `dist/` para uma pasta do site, por exemplo `https://seusite.com.br/demos/trm-reporting/`.
3. Link direto ou incorporado em uma página:

```html
<iframe
  src="https://seusite.com.br/demos/trm-reporting/"
  title="Demo – Reporting Pack de Aplicações Financeiras"
  style="width:100%;height:900px;border:0;border-radius:16px"
  loading="lazy"
></iframe>
```

Links diretos para um relatório também funcionam, ex.: `.../demos/trm-reporting/#/r07-concentracao`.

### GitHub Pages (opcional)

O workflow `.github/workflows/deploy.yml` compila o projeto a cada PR e publica no GitHub Pages a cada push na branch
`main`. Para ativar: *Settings → Pages → Build and deployment → Source: GitHub Actions*.

## Estrutura

```
src/app/
  apps/            um arquivo por aplicativo (Launchpad, Premissas, R01…R07, CdsCatalogo)
  components/
    fiori/         componentes no padrão SAP Horizon (tile, card, tabela, filtros, status, KPI…)
    shell/         shell bar, página de relatório (Dynamic Page), diálogo "Sobre"
  context/         premissas globais (persistidas no navegador) e hooks de dados/alertas
  data/            premissas, carteira fictícia, endividamento, catálogo de relatórios e CDS
  lib/             calendário de dias úteis, motor financeiro, indicadores, exportação Excel
```

Para trocar os dados de demonstração, edite `src/app/data/carteira.ts` (operações) e `src/app/data/endividamento.ts`
(dívida, EBITDA, covenants). Em produção, essas fontes são as CDS Views `IFINTRAN`, `IFINTRSMANAGE` e `IFINTRANSCNDN`
(ver o mapeamento no app *Catálogo de CDS Views → Mapeamento R01*).

Créditos de terceiros em [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
