// src/modules/pedidos/components/PackErrorModal.jsx
import Modal from "./Modal.js";

export default function PackErrorModal({ open, esperado, escaneado, onClose }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} position="center">
      <h3 className="text-lg font-semibold mb-1">Paquete incorrecto</h3>
      <p className="text-sm text-gray-600 mb-3">
        Este QR no corresponde al producto del pedido.
      </p>
      <div className="text-sm bg-red-50 text-red-700 rounded-lg p-3 mb-3">
        <div><b>Esperado:</b> {esperado || "—"}</div>
        <div><b>Escaneado:</b> {escaneado || "—"}</div>
      </div>
      <div className="text-right">
        <button className="btn" onClick={onClose}>Entendido</button>
      </div>
    </Modal>
  );
}
