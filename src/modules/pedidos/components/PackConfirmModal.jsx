// src/modules/pedidos/components/PackConfirmModal.jsx
import { useEffect, useState } from "react";
import Modal from "./Modal";

export default function PackConfirmModal({ open, data, onCancel, onConfirm }) {
  // Calcular valores de forma segura aunque no haya `data`
  const maxUsable = Math.min(
    Number(data?.remaining ?? 0),
    Number(data?.packSize ?? 0)
  );

  // Mantener un estado local de cantidad SIEMPRE inicializado
  const [qty, setQty] = useState(0);

  // Sincronizar qty cuando cambia el modal/datos
  useEffect(() => {
    if (open && data) {
      const def = Math.min(
        Math.max(0, Number(data.defaultQty || 0)),
        maxUsable
      );
      setQty(def);
    } else {
      setQty(0); // si se cierra, reseteamos
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data?.key, data?.packSize, data?.remaining]);

  // Recién acá cortamos el render si no corresponde mostrarlo
  if (!open || !data) return null;

  return (
    <Modal open={open} onClose={onCancel} position="bottom">
      <h3 className="text-lg font-semibold mb-1">Paquete escaneado</h3>
      <p className="text-sm text-gray-600 mb-3">
        <b>{data.nombre}</b> · contiene <b>{data.packSize}</b> tiras. <br />
        ¿Cuántas querés retirar?
      </p>

      <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3 mb-2">
        <div className="text-xs text-gray-500">
          Falta del pedido: <b>{data.remaining}</b>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn--outline btn-sm"
            onClick={() => setQty((q) => Math.max(0, q - 1))}
            disabled={qty <= 0}
          >
            -
          </button>
          <div className="w-10 text-center font-semibold">{qty}</div>
          <button
            className="btn btn--outline btn-sm"
            onClick={() => setQty((q) => Math.min(maxUsable, q + 1))}
            disabled={qty >= maxUsable}
          >
            +
          </button>
        </div>
      </div>

      <div className="text-xs text-gray-500 mb-4">
        Máximo permitido: <b>{maxUsable}</b>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn--ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button
          className="btn"
          onClick={() => onConfirm(qty)}
          disabled={qty <= 0}
        >
          Confirmar
        </button>
      </div>
    </Modal>
  );
}
