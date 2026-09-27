# Reporting Pack Tesouraria – Demos (SAP Fiori Horizon)

Aplicativos de demonstração dos relatórios da planilha **“DXT – CDS View + Pacote de Relatórios”** (Reporting Pack sobre
o SAP S/4HANA Treasury and Risk Management), no mesmo formato do demo *Gestão de Lote App* (Launchpad + aplicativos), com o
visual do **SAP Fiori mais recente – tema Horizon** (fonte SAP “72”, shell bar branca, tiles e cards arredondados, paleta e
cores semânticas do Horizon).

São **dois produtos separados**, cada um com a sua página, Launchpad, rotas e alertas:

| Produto | Página | Conteúdo |
| --- | --- | --- |
| **Aplicações Financeiras** | `index.html` | Premissas, benchmark (% do CDI), Carteira-Mestre, R01 a R12, Painel de KPIs, catálogo de CDS Views |
| **Captações Financeiras** (dívida) | `captacoes.html` | Premissas, C00 a C06, Painel de KPIs, catálogo de CDS Views |

> **Os dados são fictícios, do ambiente de teste da Dexterity.** As premissas gerais (CDI, Selic, IPCA, TJLP, TLP, PTAX) são
> importadas do SAP e ficam somente leitura; valores posteriores ao último dado disponível são projetados com esse
> último dado. Os dois produtos exibem esse aviso em todas as telas. Não há backend: o app é 100% estático.

## Aplicações Financeiras

| Seção do Índice | App (rota) | Aba de origem |
| --- | --- | --- |
| 1. Parametrização | **Premissas** (`/premissas`) – premissas gerais importadas do SAP (somente leitura): CDI, Selic, IPCA e PTAX USD/EUR, histórico × projeção do CDI, IRRF e IOF, títulos públicos (custódia B3, VNA, cupons), come-cotas e time deposits (IOF câmbio, ACT/360, IRPJ/CSLL) | Premissas |
| 1. Parametrização | **Benchmark (% do CDI)** (`/benchmark`) – cadastro de taxas de benchmark por carteira, empresa, portfolio ou tipo de produto, para todos os tipos de contrato (incluir, editar, excluir, vigência, validação de 50% a 200% do CDI) | Premissas – benchmark |
| 1. Parametrização | **Carteira-Mestre** (`/carteira-mestre`) – base consolidada de todos os contratos em R$ | Carteira-Mestre |
| 2. Posição | **R01 – Composição detalhada** (`/r01-composicao`) – renda fixa bancária por operação, benchmark × realizado, detalhe com origem nas CDS Views | DD-31 |
| 2. Posição | **R08 – Tesouro Direto** (`/r08-tesouro`) – LFT, LTN, NTN-F, NTN-B Principal e NTN-B: curva × mercado, MTM, cupons, custódia | R08-Tesouro |
| 2. Posição | **R10 – Time deposits** (`/r10-time-deposit`) – USD/EUR, PTAX, variação cambial, IOF câmbio, IRPJ/CSLL | R10-TimeDeposit |
| 2. Posição | **R11 – Moeda × tipo de contrato** (`/r11-moeda-tipo`) – matriz em R$ e em moeda original, sensibilidade cambial | R11-Moeda-Tipo |
| 2. Posição | **R07 – Concentração da carteira** (`/r07-concentracao`) – grupo econômico (limite por rating), tipo, indexador, moeda e prazo; HHI e semáforo da política | R07-Concentracao |
| 3. Movimentação | **R05 – Evolução mensal** (`/r05-evolucao`) – 12 meses da carteira consolidada, % do CDI × benchmark, saldo final conciliado com a Carteira-Mestre | R05-Evolucao |
| 4. Rentabilidade | **R03 – Rentabilidade realizada e real** (`/r03-rentabilidade`) – por operação de renda fixa e consolidado por tipo de contrato | R03-Rentab |
| 4. Rentabilidade | **R04 – Eficiência fiscal por prazo** (`/r04-prazo-fiscal`) – faixas do IR, economia ao aguardar, simulador | R04-Prazo-Fiscal |
| 4. Rentabilidade | **R09 – Fundos e come-cotas** (`/r09-fundos`) – cotas, taxas adm./perf., come-cotas mai/nov, IR complementar | R09-Fundos |
| 5. Indicadores | **Painel de KPIs** (`/kpis`) – saldo, % do CDI × benchmark, liquidez, duration, concentração, câmbio, tributos, carry, com metas, tendência de 12 meses e semáforo | Painel de KPIs |
| 5. Indicadores | **R06 – Endividamento × Aplicações** (`/r06-indicadores`) – DL/EBITDA, liquidez, cobertura, carry; dívida e custo vindos da carteira de captações | R06-Indicadores |
| 6. Fechamento | **R12 – Conciliação de fim de mês** (`/r12-conciliacao`) – TRM × FI-GL × extratos, roll-forward e checklist (TPM1, TPM44, TPM10) | R12-Conciliacao |
| 7. Notas explicativas | **R02 – Movimentação** (`/r02-movimentacao`) – quadro Controladora × Consolidado por tipo de contrato, minuta do texto da nota | DD-32 |
| 8. Base técnica | **Catálogo de CDS Views** (`/cds`) – campos, domínios, dependências DDL, mapeamento do R01 | Lista de CDS · DD27VVT · Domínios · DDLDEPENDENCY |

**Carteira-Mestre.** Todos os contratos – renda fixa bancária (R01), Tesouro Direto (R08), fundos (R09) e time deposits
(R10) – padronizados em R$ (`src/aplicacoes/lib/carteiraMestre.ts`). O **saldo bruto** é a curva na renda fixa e nos
títulos, o valor da cota nos fundos e o saldo em moeda × PTAX nos time deposits; é a base da movimentação, das
participações e do total do Launchpad. O **valor contábil** segue o CPC 48: curva no custo amortizado, mercado no valor
justo. A movimentação fecha pela identidade *saldo final = saldo inicial + aplicações + rendimentos − resgates brutos −
come-cotas* (o come-cotas reduz cotas, sem saída de caixa). R02, R03 (consolidado), R05, R06, R07, R11, R12, os KPIs e o
Launchpad usam essa base.

Motores dos novos tipos de contrato: **títulos públicos** (`lib/tesouro.ts`) – PU pelas convenções ANBIMA/Tesouro (252
dias úteis), VNA da LFT pela Selic e da NTN-B pelo IPCA, curva à taxa de compra × mercado à taxa indicativa mensal, cupons
com IR regressivo, custódia B3 e taxa do agente; **fundos** (`lib/fundos.ts`) – cota diária (% do CDI, CDI + spread,
série mensal de multimercado/Ibovespa ou cambial), taxas de administração e performance na cota, come-cotas no último dia
útil de maio e novembro (15% LP / 20% CP) e IR complementar no resgate; **time deposits** (`lib/timeDeposit.ts`) – juros
simples ACT/360 em moeda original, conversão pela PTAX venda BCB importada do SAP (após a data-base, a PTAX da
data-base), variação cambial acumulada e do mês, IOF câmbio de 0,38% e IRPJ/CSLL de 34%.

O benchmark vale pela regra mais específica (tipo de produto › portfolio › empresa › carteira) vigente em cada dia: o
rendimento de referência é capitalizado dia a dia (DI diário × % do benchmark), como os próprios papéis, e comparado com o
realizado de todos os tipos de contrato no R01 (desde a aplicação), R03 (período), R05 (mês a mês), R09, Painel de KPIs,
Launchpad e alertas. Nesta demo o cadastro fica salvo no navegador de quem acessa.

## Captações Financeiras

| Seção | App | Aba de origem |
| --- | --- | --- |
| 1. Parametrização | **Premissas – Captações** – data-base, abertura, CDI, IPCA, TJLP, TLP e base de dias importados do SAP; indexadores e custo médio ponderado | Premissas |
| 2. Carteira e vencimentos | **C00 – Carteira de captações** (BNDES FINEM/FINAME direto e indireto, debêntures inclusive incentivadas, CRA, CRI, CCB; custo amortizado, CP/LP, CET) | C00-Carteira-Divida |
| 2. Carteira e vencimentos | **C02 – Vencimentos e CP/LP** (perfil de amortização, não circulante por ano, fluxos projetados) | C02-Cronograma |
| 3. Movimentação e custo | **C01 – Movimentação** (roll-forward e reconciliação com a DFC, CPC 03 item 44A) | C01-Movimentacao |
| 3. Movimentação e custo | **C03 – Encargos e custo da dívida** (juros, atualização monetária, custos de transação, CPC 20, custo médio ponderado) | C03-Encargos |
| 4. Covenants | **Painel de KPIs – Captações** (`/kpis`) – dívida bruta e líquida, custo médio × CDI, prazo médio, parcela de curto prazo, concentração por credor e indexador, covenants e folga, com metas, tendência e semáforo | Painel de KPIs |
| 4. Covenants | **C04 – Covenants** (DL/EBITDA, ICSD, capitalização, EBITDA/despesa financeira, (DL + imóveis)/PL; waiver e reclassificação CPC 26) | C04-Covenants |
| 5. Fechamento e nota | **C05 – Fechamento e conciliação** (TRM × FI-GL, TRM × extratos, checagens, checklist TBB1/TPM44/TPM1) | C05-Fechamento |
| 5. Fechamento e nota | **C06 – Nota explicativa de captações** (composição, movimentação, vencimentos, características, custos, covenants, texto) | C06-NE-Captacoes |
| 6. Base técnica | **Catálogo de CDS Views** (Debt and Investment Management, Maturity Profile) | Lista de CDS |

Motor de cálculo da dívida: simulação diária por contrato com as convenções de mercado – juros compostos até cada
pagamento; CDI e spread de debêntures, CRA, CRI e CCB em 252 dias úteis (Fator DI); BNDES em 365 dias corridos, com a
parcela da TJLP acima de 6% a.a. capitalizada no saldo devedor e a TLP real fixada na contratação; atualização monetária
pelo IPCA; datas de pagamento no dia útil seguinte. Custo amortizado (CPC 48, custos de transação apropriados
linearmente pelo prazo), circulante × não circulante (CPC 26, inclusive reclassificação por covenant descumprido sem
waiver na data do balanço – veja a data-base 31/12/2025), encargos capitalizados em ativo qualificável (CPC 20) e CET.
Até a data-base valem as séries históricas importadas do SAP (CDI, IPCA, TJLP, TLP); depois dela, o último dado
disponível. Detalhes em [docs/GUIA-CAPTACOES.md](docs/GUIA-CAPTACOES.md).

## Destaques comuns

- **Data-base selecionável** (topo da página): todos os relatórios são recalculados para o fechamento escolhido.
- **Conciliações automáticas**: R05 = R02 = Carteira-Mestre e roll-forward / FI-GL (R12) nas aplicações; roll-forward, CP/LP e FI-GL nas captações.
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

Para trocar os dados de demonstração, edite `src/aplicacoes/data/carteira.ts` (renda fixa bancária), `tesouro.ts`,
`fundos.ts` e `timeDeposits.ts` (demais aplicações), `src/captacoes/data/contratos.ts`
(captações), `src/shared/data/mercado.ts` (premissas SAP) e `src/shared/data/corporativo.ts` (EBITDA, PL, caixa). Em
produção, essas fontes são as CDS Views `IFINTRAN`, `IFINTRSMANAGE`, `IFINTRANSCNDN` e `CMATPROFILEQ` (ver os mapeamentos
no app *Catálogo de CDS Views*).

Créditos de terceiros em [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
