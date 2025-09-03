// src/context/AppContext.js
import React, { createContext, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "firebase.js";

export const AppContext = createContext();

export const AppProvider = ({ children }) => {
  // --- Packing list ---
  const [packingByCode, setPackingByCode] = useState({});
  const cargarPackingList = async () => {
    const snap = await getDocs(collection(db, "packing_list"));
    const mapa = {};
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const key = String(d.codigo || doc.id || "").trim();
      mapa[key] = {
        customer_no: d.customer_no ?? null,
        finish: d.finish ?? null,
        bundles: Number(d.bundles || 0),
        pcs: Number(d.pcs || 0),
        qty_per_bundle:
          Number(d.qty_per_bundle || 0) ||
          (d.bundles ? Math.round((Number(d.pcs || 0)) / Number(d.bundles || 1)) : 0),
        lote: d.lote ?? null,
      };
    });
    setPackingByCode(mapa);
  };

  // --- Recepción de importación ---
  const [facturaSeleccionada, setFacturaSeleccionada] = useState(null);
  const [paquetesEscaneados, setPaquetesEscaneados] = useState([]);
  const agregarPaquete = (nuevoPaquete) =>
    setPaquetesEscaneados(prev => [...prev, nuevoPaquete]);
  const limpiarDatos = () => {
    setFacturaSeleccionada(null);
    setPaquetesEscaneados([]);
  };

  // --- Pedidos de venta (mock) ---
  const [pedidosPendientes, setPedidosPendientes] = useState([]);
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);

  const cargarPedidosPendientes = async () => {
    const pedidosMock = [
      {
        id: "PED-001",
        cliente: "Cliente A",
        fecha: "2025-08-25",
        productos: [
          { codigo: "502001891", cantidad: 5 },
          { codigo: "502001901", cantidad: 3 }
        ]
      },
      {
        id: "PED-002",
        cliente: "Cliente B",
        fecha: "2025-08-24",
        productos: [
          { codigo: "502001911", cantidad: 10 }
        ]
      }
    ];
    setPedidosPendientes(pedidosMock);
  };

  const cargarDetallePedido = async (orderId) => {
    const pedido = pedidosPendientes.find(p => p.id === orderId);
    if (pedido) {
      setPedidoSeleccionado(pedido);
    } else {
      console.warn("Pedido no encontrado:", orderId);
    }
  };

  // --- Preparación ---
  const [paquetesPreparados, setPaquetesPreparados] = useState([]);
  const [tirasManual, setTirasManual] = useState({});
  const [tirasSueltasStock, setTirasSueltasStock] = useState({});

  const agregarPaquetePreparado = (paq) =>
    setPaquetesPreparados(prev => [...prev, paq]);

  const agregarTirasSueltas = (productoCodigo, cantidad) =>
    setTirasManual(prev => ({
      ...prev,
      [productoCodigo]: (prev[productoCodigo] || 0) + cantidad
    }));

  const limpiarPreparacion = () => {
    setPaquetesPreparados([]);
    setTirasManual({});
  };

  const agregarTirasAlStockVirtual = (codigo, cantidad, nroPaquete) => {
    setTirasSueltasStock(prev => {
      const nuevas = [...(prev[codigo] || []), { cantidad, desdePaquete: nroPaquete }];
      return { ...prev, [codigo]: nuevas };
    });
  };

  const consumirTirasDelStock = (codigo, cantidad) => {
    setTirasSueltasStock(prev => {
      const disponibles = [...(prev[codigo] || [])];
      let restante = cantidad;
      const nuevas = [];
      for (let lote of disponibles) {
        if (restante <= 0) { nuevas.push(lote); continue; }
        if (lote.cantidad <= restante) restante -= lote.cantidad;
        else { nuevas.push({ ...lote, cantidad: lote.cantidad - restante }); restante = 0; }
      }
      return { ...prev, [codigo]: nuevas };
    });
  };

  return (
    <AppContext.Provider
      value={{
        // packing
        packingByCode,
        cargarPackingList,

        // recepción
        facturaSeleccionada,
        setFacturaSeleccionada,
        paquetesEscaneados,
        setPaquetesEscaneados,
        agregarPaquete,
        limpiarDatos,

        // despacho
        pedidosPendientes,
        cargarPedidosPendientes,
        pedidoSeleccionado,
        cargarDetallePedido,

        // preparación
        paquetesPreparados,
        agregarPaquetePreparado,
        tirasManual,
        agregarTirasSueltas,
        limpiarPreparacion,

        // stock virtual
        tirasSueltasStock,
        agregarTirasAlStockVirtual,
        consumirTirasDelStock,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
