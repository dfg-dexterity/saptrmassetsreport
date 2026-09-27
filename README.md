# Reporting Pack Tesouraria – Demos (SAP Fiori Horizon)

Aplicativos de demonstração dos relatórios da planilha **“DXT – CDS View + Pacote de Relatórios”** (Reporting Pack sobre
o SAP S/4HANA Treasury and Risk Management), no mesmo formato do demo *Gestão de Lote App* (Launchpad + aplicativos), com o
visual do **SAP Fiori mais recente – tema Horizon** (fonte SAP “72”, shell bar branca, tiles e cards arredondados, paleta e
cores semânticas do Horizon).

São **dois produtos separados**, cada um com a sua página, Launchpad, rotas e alertas:

| Produto | Página | Conteúdo |
| --- | --- | --- |
| **Aplicações Financeiras** | `index.html` | Premissas, benchmark (% do CDI), R01 a R07, catálogo de CDS Views |
| **Captações Financeiras** (dívida) | `captacoes.html` | Premissas, C00 a C06, catálogo de CDS Views |

> **Os dados são fictícios, do ambiente de teste da Dexterity.** As premissas gerais (CDI, Selic, IPCA, TJLP, TLP) são
> importadas do SAP e ficam somente leitura; valores posteriores ao último dado disponível são projetados com esse
> último dado. Os dois produtos exibem esse aviso em todas as telas. Não há backend: o app é 100% estático.

## Aplicações Financeiras

| Seção do Índice | App | Aba de origem |
| --- | --- | --- |
| 1. Parametrização | **Premissas** – premissas gerais importadas do SAP (somente leitura), histórico × projeção do CDI, tabelas de IRRF e IOF | Premissas |
| 1. Parametrização | **Benchmark (% do CDI)** – cadastro de taxas de benchmark por carteira, empresa, portfolio ou tipo de produto (incluir, editar, excluir, validação de 50% a 200% do CDI) | Premissas – benchmark |
| 2. Posição | **R01 – Composição detalhada** (filtros, totais, benchmark × realizado, detalhe da operação com origem nas CDS Views) | DD-31 |
| 2. Posição | **R07 – Concentração da carteira** (limite por grupo econômico, HHI, semáforo da política) | R07-Concentracao |
| 3. Movimentação | **R05 – Evolução mensal** (12 meses, % do CDI × benchmark, conciliação com R03 e R01) | R05-Evolucao |
| 4. Rentabilidade | **R03 – Rentabilidade realizada e real** (bruto, IOF, IRRF, líquido, % CDI, benchmark e excesso em R$, real) | R03-Rentab |
| 4. Rentabilidade | **R04 – Eficiência fiscal por prazo** (faixas do IR, economia ao aguardar, simulador) | R04-Prazo-Fiscal |
| 5. Indicadores | **R06 – Endividamento × Aplicações** (DL/EBITDA, liquidez, cobertura, carry; dívida e custo vindos da carteira de captações) | R06-Indicadores |
| 6. Notas explicativas | **R02 – Movimentação** (1A/1B/1C, Controladora × Consolidado, minuta do texto da nota) | DD-32 |
| 7. Base técnica | **Catálogo de CDS Views** (campos, domínios, dependências DDL, mapeamento do R01) | Lista de CDS · DD27VVT · Domínios · DDLDEPENDENCY |

O benchmark vale pela regra mais específica (tipo de produto › portfolio › empresa › carteira), com vigência. Nesta demo o
cadastro fica salvo no navegador de quem acessa.

## Captações Financeiras

| Seção | App | Aba de origem |
| --- | --- | --- |
| 1. Parametrização | **Premissas – Captações** – data-base, abertura, CDI, IPCA, TJLP, TLP e base de dias importados do SAP; indexadores e custo médio ponderado | Premissas |
| 2. Carteira e vencimentos | **C00 – Carteira de captações** (BNDES FINEM/FINAME direto e indireto, debêntures inclusive incentivadas, CRA, CRI, CCB; custo amortizado, CP/LP, CET) | C00-Carteira-Divida |
| 2. Carteira e vencimentos | **C02 – Vencimentos e CP/LP** (perfil de amortização, não circulante por ano, fluxos projetados) | C02-Cronograma |
| 3. Movimentação e custo | **C01 – Movimentação** (roll-forward e reconciliação com a DFC, CPC 03 item 44A) | C01-Movimentacao |
| 3. Movimentação e custo | **C03 – Encargos e custo da dívida** (juros, atualização monetária, custos de transação, CPC 20, custo médio ponderado) | C03-Encargos |
| 4. Covenants | **C04 – Covenants** (DL/EBITDA, ICSD, capitalização, EBITDA/despesa financeira, (DL + imóveis)/PL; waiver e reclassificação CPC 26) | C04-Covenants |
| 5. Fechamento e nota | **C05 – Fechamento e conciliação** (TRM × FI-GL, TRM × extratos, checagens, checklist TBB1/TPM44/TPM1) | C05-Fechamento |
| 5. Fechamento e nota | **C06 – Nota explicativa de captações** (composição, movimentação, vencimentos, características, custos, covenants, texto) | C06-NE-Captacoes |
| 6. Base técnica | **Catálogo de CDS Views** (Debt and Investment Management, Maturity Profile) | Lista de CDS |

Motor de cálculo da dívida: simulação diária por contrato (base 365 dias corridos), CDI/TJLP/TLP/IPCA + spread, custo
amortizado (CPC 48, custos de transação apropriados linearmente pelo prazo), circulante × não circulante (CPC 26, inclusive reclassificação por covenant
descumprido sem waiver na data do balanço – veja a data-base 31/12/2025), juros capitalizados em ativo qualificável (CPC 20)
e CET. Detalhes em [docs/GUIA-CAPTACOES.md](docs/GUIA-CAPTACOES.md).

## Destaques comuns

- **Data-base selecionável** (topo da página): todos os relatórios são recalculados para o fechamento escolhido.
- **Conciliações automáticas**: R03 = R05 = R01 = R02 nas aplicações; roll-forward, CP/LP e FI-GL nas captações.
- **Exportar Excel** em todos os relatórios (arquivo `.xlsx` real, com cabeçalho, totais e notas) e **Imprimir/PDF**.
- **Central de alertas** (sino na shell bar) própria de cada produto.
- Layout responsivo (desktop, tablet e celular).

## Rodando localmente

```bash
npm install
npm run dev        # http://localhost:5173 (Aplicações) e http://localhost:5173/captacoes.html (Captações)
npm run build      # gera a pasta dist/ com as duas páginas
npm run preview    # serve o build em http://localhost:4173
```

## Publicando no site

O build (`dist/`) é estático e usa **rotas com hash** (`/#/r01-composicao`) e caminhos relativos, então funciona em
qualquer subpasta do site, sem configuração de servidor:

1. `npm run build`
2. Copie o conteúdo de `dist/` para uma pasta do site, por exemplo `https://seusite.com.br/demos/trm-reporting/`.
3. Aplicações em `.../trm-reporting/`, Captações em `.../trm-reporting/captacoes.html`. Link direto ou incorporado:

```html
<iframe
  src="https://seusite.com.br/demos/trm-reporting/captacoes.html"
  title="Demo – Reporting Pack de Captações Financeiras"
  style="width:100%;height:900px;border:0;border-radius:16px"
  loading="lazy"
></iframe>
```

Links diretos para um relatório também funcionam, ex.: `.../captacoes.html#/c04-covenants`.

### Arquivo único

`npm run build:single` gera `dist-single/index.html` (Aplicações) e `dist-single/captacoes.html` (Captações): cada um é um
único arquivo HTML com JS, CSS e fontes embutidos, que abre direto no navegador, sem servidor.

Dentro do viewer de Artifacts do claude.ai o app detecta o ambiente sozinho: usa navegação em memória, entrega o Excel
pela confirmação de download do viewer e esconde o botão Imprimir (bloqueado nesse frame).

### GitHub Pages (opcional)

O workflow `.github/workflows/deploy.yml` compila o projeto a cada PR e publica no GitHub Pages a cada push na branch
`main`. Para ativar: *Settings → Pages → Build and deployment → Source: GitHub Actions*.

## Estrutura

```
src/
  shared/          tudo que os dois produtos usam
    components/    fiori/ (tile, card, tabela, filtros, status, KPI…) e shell/ (shell bar, Dynamic Page, "Sobre")
    context/       data-base e premissas importadas do SAP; informações do produto e alertas
    data/          mercado (premissas SAP, CDI mensal), empresas, dados corporativos, CDS Views
    lib/           calendário de dias úteis, taxas, formatação, exportação Excel
  aplicacoes/      produto Aplicações Financeiras (apps, dados, motor, benchmark)
  captacoes/       produto Captações Financeiras (apps, contratos, motor da dívida, covenants, fechamento)
```

Para trocar os dados de demonstração, edite `src/aplicacoes/data/carteira.ts` (aplicações), `src/captacoes/data/contratos.ts`
(captações), `src/shared/data/mercado.ts` (premissas SAP) e `src/shared/data/corporativo.ts` (EBITDA, PL, caixa). Em
produção, essas fontes são as CDS Views `IFINTRAN`, `IFINTRSMANAGE`, `IFINTRANSCNDN` e `CMATPROFILEQ` (ver os mapeamentos
no app *Catálogo de CDS Views*).

Créditos de terceiros em [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
