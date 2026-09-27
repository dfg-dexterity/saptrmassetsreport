import { ShieldCheck, X } from "lucide-react";
import { useEffect } from "react";
import { useProduto } from "../../context/ProdutoContext";
import { AVISO_DADOS } from "../../data/mercado";
import { Button } from "../fiori/Button";

/** sap.m.Dialog – informações sobre a demonstração do produto */
export function SobreDialog({ onClose }: { onClose: () => void }) {
  const produto = useProduto();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#1d2d3e]/40" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sobre-titulo"
        className="w-full max-w-lg bg-white rounded-2xl shadow-fiori-lg overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-line-soft">
          <h2 id="sobre-titulo" className="text-base font-bold text-text">
            Sobre esta demonstração
          </h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-link hover:bg-hover" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="px-5 py-4 space-y-4 text-sm text-text leading-relaxed">
          <p>
            Demonstração interativa do <strong>Reporting Pack de {produto.nome}</strong> desenvolvido pela Dexterity IT
            Solutions sobre o <strong>SAP S/4HANA Treasury and Risk Management</strong>, no padrão visual SAP Fiori (tema
            Horizon).
          </p>
          <ul className="space-y-3">
            {produto.sobre.map((item, i) => (
              <li key={i} className="flex gap-3">
                <item.icone className="w-5 h-5 shrink-0 mt-0.5" style={{ color: item.cor }} />
                <span>{item.texto}</span>
              </li>
            ))}
            <li className="flex gap-3">
              <ShieldCheck className="w-5 h-5 text-positive shrink-0 mt-0.5" />
              <span>{AVISO_DADOS}</span>
            </li>
          </ul>
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3 bg-[#f5f6f7] border-t border-line-soft">
          <Button variant="emphasized" onClick={onClose}>
            Fechar
          </Button>
        </footer>
      </div>
    </div>
  );
}
