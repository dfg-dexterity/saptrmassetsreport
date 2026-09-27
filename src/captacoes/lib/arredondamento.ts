/**
 * Arredondamento controlado das tabelas em R$ mil (C01, C03, C06): cada linha e cada coluna somam os seus totais
 * exibidos, como nas notas explicativas.
 */

export interface TabelaArredondada {
  celulas: number[][];
  /** total de cada linha */
  linhas: number[];
  /** total de cada coluna */
  colunas: number[];
  geral: number;
}

/**
 * Arredonda uma tabela (valores já na unidade exibida, ex.: R$ mil) para inteiros de modo que cada linha some o seu
 * total, cada coluna some o seu total e os totais somem o total geral – o arredondamento controlado das notas
 * explicativas. Cada célula fica no piso ou no teto do valor exato (valores inteiros, como 25.000, não mudam) e os
 * ajustes vão para as células com resto mais próximo de 0,5 (fluxo de custo mínimo). `alvos` fixa totais já exibidos
 * em outras tabelas; se não houver solução com eles, são relaxados em ±1 como último recurso.
 */
export function arredondarTabela(
  valores: number[][],
  alvos: { linhas?: (number | undefined)[]; colunas?: (number | undefined)[]; geral?: number } = {},
): TabelaArredondada {
  const nL = valores.length;
  const nC = nL ? valores[0].length : 0;
  const somaL = valores.map((l) => l.reduce((s, v) => s + v, 0));
  const somaC = Array.from({ length: nC }, (_, j) => valores.reduce((s, l) => s + l[j], 0));
  const geral = alvos.geral ?? Math.round(somaL.reduce((s, v) => s + v, 0));

  // Nós: 0 = origem dos totais de linha, 1 = destino dos totais de coluna, linhas, colunas, fonte e sumidouro
  const L = (i: number) => 2 + i;
  const C = (j: number) => 2 + nL + j;
  const S = 2 + nL + nC;
  const T = S + 1;
  const excesso = new Array<number>(T + 1).fill(0);
  interface Var {
    x: number;
  }
  interface Arco {
    de: number;
    para: number;
    cap: number;
    custo: number;
    rev: number;
    v?: Var;
    d?: number;
  }
  const arcos: Arco[] = [];
  const adj: number[][] = Array.from({ length: T + 1 }, () => []);
  const arco = (de: number, para: number, cap: number, custo: number, v?: Var, d?: number) => {
    adj[de].push(arcos.length);
    arcos.push({ de, para, cap, custo, rev: arcos.length + 1, v, d });
    adj[para].push(arcos.length);
    arcos.push({ de: para, para: de, cap: 0, custo: -custo, rev: arcos.length - 1 });
  };
  /** Variável = fluxo de `de` para `para`; passos de ±1 com custos crescentes (convexos) */
  const variavel = (de: number, para: number, exato: number, alvo: number | undefined, peso: number): Var => {
    const x = alvo ?? Math.round(exato);
    const v: Var = { x };
    excesso[de] -= x;
    excesso[para] += x;
    const resto = exato - x;
    const passo = (d: number, custo: number) => (d > 0 ? arco(de, para, 1, custo, v, 1) : arco(para, de, 1, custo, v, -1));
    const ambos = (custo: number) => [1, -1].forEach((d) => passo(d, custo));
    const fracao = Math.abs(resto) > 1e-7;
    if (alvo !== undefined) {
      // total já exibido em outra tabela: só muda se não houver outra saída
      for (let k = 1; k <= 3; k++) ambos(1e7 * k);
    } else if (peso > 1) {
      // total: piso ou teto do valor exato; afastar-se mais, só como último recurso
      if (fracao) passo(resto > 0 ? 1 : -1, peso + 1 - 2 * Math.abs(resto));
      for (let k = 1; k <= 3; k++) ambos(1e5 * k);
    } else if (fracao) {
      // célula: piso ou teto; valores inteiros (ex.: 25.000 captados) nunca mudam
      passo(resto > 0 ? 1 : -1, peso + 1 - 2 * Math.abs(resto));
      ambos(1e5);
    }
    return v;
  };

  const vl = somaL.map((s, i) => variavel(0, L(i), s, alvos.linhas?.[i], 50));
  const vc = somaC.map((s, j) => variavel(C(j), 1, s, alvos.colunas?.[j], 50));
  const cel = valores.map((l, i) => l.map((a, j) => variavel(L(i), C(j), a, undefined, 1)));
  excesso[0] += geral;
  excesso[1] -= geral;
  for (let n = 0; n < S; n++) {
    if (excesso[n] > 0) arco(S, n, excesso[n], 0);
    else if (excesso[n] < 0) arco(n, T, -excesso[n], 0);
  }

  // Caminhos mínimos sucessivos (Bellman-Ford; a tabela tem poucas dezenas de nós)
  for (let it = 0; it < 1000; it++) {
    const dist = new Array<number>(T + 1).fill(Infinity);
    const via = new Array<number>(T + 1).fill(-1);
    dist[S] = 0;
    for (let rodada = 0; rodada <= T; rodada++) {
      let mudou = false;
      for (let k = 0; k < arcos.length; k++) {
        const a = arcos[k];
        if (a.cap > 0 && dist[a.de] + a.custo < dist[a.para] - 1e-9) {
          dist[a.para] = dist[a.de] + a.custo;
          via[a.para] = k;
          mudou = true;
        }
      }
      if (!mudou) break;
    }
    if (dist[T] === Infinity) break;
    let f = Infinity;
    for (let n = T; n !== S; n = arcos[via[n]].de) f = Math.min(f, arcos[via[n]].cap);
    for (let n = T; n !== S; n = arcos[via[n]].de) {
      const a = arcos[via[n]];
      a.cap -= f;
      arcos[a.rev].cap += f;
    }
  }
  for (const a of arcos) if (a.v && a.d) a.v.x += a.d * (arcos[a.rev].cap);

  return { celulas: cel.map((l) => l.map((v) => v.x)), linhas: vl.map((v) => v.x), colunas: vc.map((v) => v.x), geral };
}

/** Rateia `alvo` entre as parcelas arredondadas (maior resto), sem alterar parcelas inteiras */
export function ratear(valores: number[], alvo?: number): number[] {
  const alvoFinal = alvo ?? Math.round(valores.reduce((s, v) => s + v, 0));
  return arredondarTabela([valores], { linhas: [alvoFinal], geral: alvoFinal }).celulas[0];
}

/**
 * Saldos em R$ mil que fecham e se repetem em todas as tabelas (C01 e C06): total arredondado; modalidades e, dentro
 * delas, contratos pelo maior resto (ordem alfabética, para o resultado não depender da ordem de exibição).
 */
export function saldosMil(itens: { grupo: string; id: string; saldo: number }[]) {
  const grupos = [...new Set(itens.map((x) => x.grupo))].sort();
  const total = Math.round(itens.reduce((s, x) => s + x.saldo, 0) / 1000);
  const doGrupo = (g: string) => itens.filter((x) => x.grupo === g).sort((a, b) => a.id.localeCompare(b.id));
  const porGrupo = ratear(grupos.map((g) => doGrupo(g).reduce((s, x) => s + x.saldo, 0) / 1000), total);
  const contratos = new Map<string, number>();
  grupos.forEach((g, i) => {
    const xs = doGrupo(g);
    ratear(xs.map((x) => x.saldo / 1000), porGrupo[i]).forEach((v, j) => contratos.set(xs[j].id, v));
  });
  return { total, grupos: new Map(grupos.map((g, i) => [g, porGrupo[i]])), contratos };
}
