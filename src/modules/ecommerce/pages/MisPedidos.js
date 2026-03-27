import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "context/AuthContext";
import PortalInicio from "modules/ecommerce/components/PortalInicio";
import ListaPedidos from "modules/ecommerce/components/ListaPedidos";

export default function MisPedidos() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mostrarLista, setMostrarLista] = useState(false);

  useEffect(() => {
    if (!profile?.finnegansClienteCodigo) return;

    const q = query(
        collection(db, "pedidos_web"),
        where("clienteFinnegansId", "==", profile.finnegansClienteCodigo),
        orderBy("fecha", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setPedidos(data);
      setLoading(false);
    });

    return () => unsub();
  }, [profile?.id]);

  // Renderizado condicional limpio
  if (mostrarLista) {
    return (
      <ListaPedidos 
        pedidos={pedidos} 
        loading={loading} 
        onVolver={() => setMostrarLista(false)} 
      />
    );
  }

  // Pedidos que requieren atención inmediata del cliente
  const pedidosUrgentes = pedidos.filter(
    p => ["PREPARADO", "ERROR_STOCK"].includes(p.estado)
  ).length;

  return (
    <PortalInicio
      onVerPedidos={() => setMostrarLista(true)}
      onCrearPedido={() => navigate("/catalogo")}
      nombreUsuario={profile?.nombre || profile?.email}
      cantidadPedidos={pedidos.length}
      pedidosUrgentes={pedidosUrgentes}
    />
  );
}