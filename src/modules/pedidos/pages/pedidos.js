import React, { useContext, useEffect, useState } from "react";
import { AppContext } from "context/AppContext";
import { useNavigate } from "react-router-dom";
import { useAuth } from "context/AuthContext";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../firebase";

export default function Pedidos() {
  const { cargarPedidosPendientes } = useContext(AppContext);
  const [pedidosAsignados, setPedidosAsignados] = useState([]);
  const [pedidoAsignado, setPedidoAsignado] = useState(null);
  const navigate = useNavigate();
  const { profile } = useAuth();

  const irAlDetalle = (pedido) => {
    if (profile?.role === "operario") {
      navigate(`/pedidos-operario/${pedido.id}`);
    } else {
      navigate(`/pedidos/${pedido.id}`);
    }
  };

  // 🔄 Traer todos los pedidos asignados si es Encargado
  useEffect(() => {
    if (profile?.role !== "Encargado") return;

    const fetchPedidosAsignados = async () => {
      try {
        const snap = await getDocs(collection(db, "pedidosAsignados"));
        const docs = snap.docs.map((doc) => doc.data());
        setPedidosAsignados(docs);
      } catch (err) {
        console.error("❌ Error trayendo pedidos asignados:", err);
      }
    };

    fetchPedidosAsignados();
  }, [profile]);

  // 🔄 Traer pedido asignado si es operario
  useEffect(() => {
    if (profile?.role !== "operario") return;

    const fetchPedidoAsignado = async () => {
      try {
        const q = query(
          collection(db, "pedidosAsignados"),
          where("operarioId", "==", profile.id)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const pedido = snap.docs[0].data();
          setPedidoAsignado(pedido);
        }
      } catch (err) {
        console.error("❌ Error trayendo pedido operario:", err);
      }
    };

    fetchPedidoAsignado();
  }, [profile]);

  const renderListaPedidos = (estado) => {
    const filtrados = pedidosAsignados.filter(p => p.estado === estado);
    if (filtrados.length === 0) return <p>No hay pedidos en este estado.</p>;

    return (
      <ul>
        {filtrados.map((p) => (
          <li key={p.id} onClick={() => irAlDetalle(p)} style={{ cursor: "pointer" }}>
            {p.id} – {p.cliente} – {p.fecha} – <strong>{p.estado}</strong>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Pedidos</h2>

      {profile?.role === "Encargado" && (
        <>
          <h3>🟠 Pendientes de asignar</h3>
          {renderListaPedidos("pendiente")}

          <h3>🟡 Asignados (pendientes de preparación)</h3>
          {renderListaPedidos("asignado")}

          <h3>🟢 Preparados (pendientes de control)</h3>
          {renderListaPedidos("preparado")}

          <h3>🔵 Controlados</h3>
          {renderListaPedidos("controlado")}
        </>
      )}

      {profile?.role === "operario" && (
        <div onClick={() => irAlDetalle(pedidoAsignado)} style={{ cursor: "pointer" }}>
          <h3>Pedido asignado</h3>
          {pedidoAsignado ? (
            <div>
              <p><strong>ID:</strong> {pedidoAsignado.id}</p>
              <p><strong>Cliente:</strong> {pedidoAsignado.cliente}</p>
              <p><strong>Fecha:</strong> {pedidoAsignado.fecha}</p>
              <ul>
                {pedidoAsignado.productos.map((p, i) => (
                  <li key={i}>
                    {p.codigo} – Cant: {p.cantidad}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>No tenés ningún pedido asignado.</p>
          )}
        </div>
      )}

      {!profile?.role && (
        <p>No tenés permisos para ver esta sección.</p>
      )}
    </div>
  );
}
