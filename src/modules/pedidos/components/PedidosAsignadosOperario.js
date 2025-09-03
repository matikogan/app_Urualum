import React, { useEffect, useState } from "react";
import { useAuth } from "context/AuthContext";
import { db } from "../../../firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function PedidosAsignadosOperario() {
  const { profile } = useAuth();
  const [pedidos, setPedidos] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPedidos = async () => {
      if (!profile?.id) return;

      try {
        const q = query(
          collection(db, "pedidosAsignados"),
          where("operarioId", "==", profile.id)
        );
        const snap = await getDocs(q);
        const pedidosData = snap.docs.map((doc) => doc.data());
        setPedidos(pedidosData);
      } catch (err) {
        console.error("Error al traer pedidos asignados:", err);
      }
    };

    fetchPedidos();
  }, [profile]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Mis Pedidos Asignados</h2>

      {pedidos.length === 0 ? (
        <p>No tenés ningún pedido asignado.</p>
      ) : (
        <ul>
          {pedidos.map((pedido) => (
            <li key={pedido.id} onClick={() => navigate(`/operario/pedido/${pedido.id}`)} style={{ cursor: "pointer", marginBottom: 12 }}>
              <strong>ID:</strong> {pedido.id} <br />
              <strong>Cliente:</strong> {pedido.cliente} <br />
              <strong>Fecha:</strong> {pedido.fecha} <br />
              <strong>Estado:</strong> {pedido.estado}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
