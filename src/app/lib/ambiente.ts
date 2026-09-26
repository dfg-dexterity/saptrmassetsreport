/**
 * Ambiente de execução.
 *
 * Publicado como Artifact no claude.ai, a página roda num frame restrito onde `window.claude.use` já existe antes
 * do nosso script: downloads diretos e `window.print()` são bloqueados e arquivos só podem ser entregues pela
 * capacidade `downloads`. Em qualquer outra hospedagem (site, GitHub Pages, arquivo local) `window.claude` não
 * existe e o app usa o comportamento normal do navegador.
 */

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

function runtime(): ClaudeRuntime | null {
  try {
    const c = (window as unknown as { claude?: ClaudeRuntime }).claude;
    return c && typeof c.use === "function" ? c : null;
  } catch {
    return null;
  }
}

export const EM_ARTIFACT = runtime() !== null;

export interface DownloadsCapability {
  save(req: { filename: string; data: Blob | ArrayBuffer | string }): Promise<{ status: "saved" | "delivered" }>;
}

let downloads: Promise<DownloadsCapability | null> | null = null;

/** Capacidade `downloads` do viewer; `null` quando a visualização não permite salvar arquivos. */
export function obterDownloads(): Promise<DownloadsCapability | null> {
  if (!downloads) {
    const r = runtime();
    downloads = r ? (r.use("downloads") as Promise<DownloadsCapability | null>).catch(() => null) : Promise.resolve(null);
  }
  return downloads;
}
