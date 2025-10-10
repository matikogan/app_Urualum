// src/modules/pedidos/components/Modal.js
export default function Modal({ open, onClose, children, position = "center" }) {
  if (!open) return null;

  const posClass =
    position === "bottom"
      ? "items-end"
      : "items-center";

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/50"
         style={{ backdropFilter: "blur(1px)" }}
         onClick={onClose}>
      <div className={`w-full max-w-md ${posClass}`} onClick={(e)=>e.stopPropagation()}>
        <div className="bg-white rounded-2xl shadow-xl w-[92%] mx-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}

