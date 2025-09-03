import React, { useContext, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AppContext } from "../../../context/AppContext";
import { getDoc, doc } from "firebase/firestore";
import { db } from "../../../firebase";

const PedidoDetalle = () => {
  const { id } = useParams();
  const { pedidosPendientes, catalogoProductos } = useContext(AppContext);
  const [pedido, setPedido] = useState(null);
  const [catalogoMap, setCatalogoMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cargarPedido = async () => {
      // 1. Buscar en pedidosPendientes (estado local)
      let encontrado = pedidosPendientes.find((p) => p.id === id);

      if (!encontrado) {
        // 2. Si no está en local, buscar en Firestore (colección pedidosAsignados)
        const pedidoRef = doc(db, "pedidosAsignados", id);
        const pedidoSnap = await getDoc(pedidoRef);

        if (pedidoSnap.exists()) {
          encontrado = pedidoSnap.data();
        }
      }

      setPedido(encontrado || null);
      setLoading(false);
    };

    cargarPedido();
  }, [id, pedidosPendientes]);

  useEffect(() => {
    // Crear un mapa del catálogo para acceder rápido por código
    const map = {};
    catalogoProductos.forEach((prod) => {
      map[prod.codigo] = prod;
    });
    setCatalogoMap(map);
  }, [catalogoProductos]);

  if (loading) return <p>Cargando...</p>;

  if (!pedido) return <p>No se encontró el pedido.</p>;

  return (
    <div style={{ padding: "1rem" }}>
      <h2>Detalle del Pedido</h2>
      <p><strong>ID:</strong> {pedido.id}</p>
      <p><strong>Cliente:</strong> {pedido.cliente}</p>
      <p><strong>Fecha:</strong> {pedido.fecha}</p>
      <p><strong>Estado:</strong> {pedido.estado}</p>
      <h4>Productos:</h4>
      <ul>
        {pedido.productos.map((prod, index) => {
          const info = catalogoMap[prod.codigo] || {};
          return (
            <li key={index}>
              <p><strong>Customer No:</strong> {info.customerNo || "-"}</p>
              <p><strong>Color / Finish:</strong> {info.finish || "-"}</p>
              <p><strong>Cantidad:</strong> {prod.cantidad}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PedidoDetalle;
