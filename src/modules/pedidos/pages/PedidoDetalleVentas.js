// Redirige al detalle unificado de pedido (pedidoDetalle.js)
// que ya maneja la vista CONTROLADO para ventas con despacho completo.
import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

export default function PedidoDetalleVentas() {
  const { id: encodedId } = useParams();
  const id = decodeURIComponent(encodedId || "");
  const navigate = useNavigate();

  useEffect(() => {
    if (id) navigate(`/pedidos/${encodeURIComponent(id)}`, { replace: true });
  }, [id, navigate]);

  return null;
}
