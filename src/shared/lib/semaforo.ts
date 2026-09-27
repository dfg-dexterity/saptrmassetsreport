/** Estado de enquadramento usado em limites, políticas e covenants */
export type Semaforo = "ok" | "atencao" | "excedido";

export const SEMAFORO_TEXTO: Record<Semaforo, string> = {
  ok: "Enquadrado",
  atencao: "Atenção",
  excedido: "Desenquadrado",
};
