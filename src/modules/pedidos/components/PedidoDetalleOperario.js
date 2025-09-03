import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, increment } from "firebase/firestore";
import { db } from "../../../firebase";
import QrScanner from "../../../components/QrScanner";


export default function PedidoDetalleOperario() {
  const { id } = useParams();
  const [pedido, setPedido] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [stockTiras, setStockTiras] = useState([]);
  const [tirasPreparadas, setTirasPreparadas] = useState({});
  const [paquetesEscaneados, setPaquetesEscaneados] = useState([]);


  const todosLosProductosCompletos = pedido.productos.every((prod) => {
  const preparadas = tirasPreparadas[prod.codigo]?.cantidad || 0;
  return preparadas >= prod.cantidad;
});


  // 🔄 Cargar pedido
  useEffect(() => {
    const fetchPedido = async () => {
      const docRef = doc(db, "pedidosAsignados", id);
      const snap = await getDoc(docRef);
      if (snap.exists()) setPedido(snap.data());
    };

    const fetchCatalogo = async () => {
      const snap = await getDocs(collection(db, "catalogoProductos"));
      setCatalogo(snap.docs.map(doc => doc.data()));
    };

    const fetchStock = async () => {
      const snap = await getDocs(collection(db, "stock_tiras"));
      setStockTiras(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };

    fetchPedido();
    fetchCatalogo();
    fetchStock();
  }, [id]);

  const agregarTirasPreparadas = (codigo, cantidad, restante = 0, paqueteId = null) => {
    setTirasPreparadas(prev => {
      const actual = prev[codigo]?.cantidad || 0;
      const nuevos = {
        ...prev,
        [codigo]: {
          cantidad: actual + cantidad,
          restante: paqueteId ? restante : 0,
          paqueteId: paqueteId || null
        }
      };
      return nuevos;
    });

    if (paqueteId) {
      setPaquetesEscaneados(prev => [...prev, paqueteId]);
    }
  };

  const confirmarPreparacion = async () => {
  for (const codigo in tirasPreparadas) {
    const { cantidad, restante, paqueteId } = tirasPreparadas[codigo];

    // Descontar del stock_tiras si existía stock
    const stockDoc = stockTiras.find(s => s.codigo === codigo);
    if (stockDoc) {
      const ref = doc(db, "stock_tiras", stockDoc.id);
      await updateDoc(ref, {
        cantidad: increment(-cantidad)
      });
    }

    // Si hubo un paquete escaneado y sobran tiras -> Agregar las sobrantes
    if (paqueteId && restante > 0) {
      await setDoc(doc(db, "stock_tiras", `${codigo}_${Date.now()}`), {
        codigo,
        cantidad: restante
      });
    }
  }

  // 👇 Nuevo paso: actualizar estado del pedido
  try {
    const pedidoRef = doc(db, "pedidosAsignados", id);
    await updateDoc(pedidoRef, {
      estado: "preparado"
    });
    alert("✅ Pedido marcado como preparado y stock actualizado.");
  } catch (err) {
    console.error("Error al actualizar estado del pedido:", err);
    alert("⚠️ Error al actualizar el estado del pedido.");
  }
};


  if (!pedido) return <p style={{ padding: 20 }}>Cargando pedido...</p>;

  const obtenerFinish = (codigo) => {
    return catalogo.find(p => p.codUru === codigo)?.finish || "—";
  };

  const obtenerCustomerNo = (codigo) => {
    return catalogo.find(p => p.codUru === codigo)?.customerNo || "—";
  };

  const stockDisponible = (codigo) => {
    return stockTiras.find(s => s.codigo === codigo)?.cantidad || 0;
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Pedido asignado</h2>
      <p><strong>ID:</strong> {pedido.id}</p>
      <p><strong>Cliente:</strong> {pedido.cliente}</p>
      <p><strong>Fecha:</strong> {pedido.fecha}</p>

      <h3>Productos:</h3>
      <ul>
        {pedido.productos.map((prod) => {
          const preparadas = tirasPreparadas[prod.codigo]?.cantidad || 0;
          const completo = preparadas >= prod.cantidad;
          return (
            <li key={prod.codigo} style={{ marginBottom: 10 }}>
              <strong>{obtenerCustomerNo(prod.codigo)}</strong> – {obtenerFinish(prod.codigo)} <br />
              Pedido: {prod.cantidad} | Preparado: {preparadas}{" "}
              {completo && <span style={{ color: "green", fontWeight: "bold" }}>✔️</span>} <br />
              Stock sueltas disponible: {stockDisponible(prod.codigo)}
            </li>
          );
        })}
      </ul>

      <h3>Escanear paquete</h3>
      <QrScanner
        onScan={(data) => {
          try {
            const parsed = JSON.parse(data);
            const { codUru, bundles, pieces } = parsed;
            const pedidoProd = pedido.productos.find(p => p.codigo === codUru);
            if (!pedidoProd) return alert("📦 Este paquete no corresponde a este pedido.");

            const yaPreparadas = tirasPreparadas[codUru]?.cantidad || 0;
            const faltan = pedidoProd.cantidad - yaPreparadas;

            if (faltan <= 0) return alert("✅ Este producto ya está completo.");

            const usar = Math.min(faltan, pieces);
            const restante = pieces - usar;

            agregarTirasPreparadas(codUru, usar, restante, parsed.id || Date.now());
          } catch (err) {
            console.error("Error escaneando:", err);
            alert("❌ QR inválido");
          }
        }}
      />

      <button
  onClick={confirmarPreparacion}
  disabled={!todosLosProductosCompletos}
  style={{
    marginTop: 20,
    background: todosLosProductosCompletos ? "green" : "gray",
    color: "white",
    padding: "10px 20px",
    cursor: todosLosProductosCompletos ? "pointer" : "not-allowed",
    opacity: todosLosProductosCompletos ? 1 : 0.7,
  }}
>
  Confirmar pedido preparado
</button>

    </div>
  );
}
