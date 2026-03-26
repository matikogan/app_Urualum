import React, { useState, useEffect } from "react";
import { collection, query, orderBy, where, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../firebase";
import { useAuth } from "context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function PedidosWeb() {
  const { profile } = useAuth(); 
  const navigate = useNavigate(); 
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);
  const [stockPorProducto, setStockPorProducto] = useState({});
  const [loadingStock, setLoadingStock] = useState(false);

  useEffect(() => {
    if (!profile?.deposito) return;

    const q = query(
        collection(db, "pedidos_web"), 
        where("depositoAsignado", "==", profile.deposito),
        orderBy("fecha", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      setPedidos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, [profile?.deposito]);

  const abrirGestion = async (pedido) => {
    setPedidoSeleccionado(pedido);
    setLoadingStock(true);
    const nuevosStocks = {};

    try {
      const fnStock = httpsCallable(functions, "finnegansConsultarStock");
      
      const promesas = pedido.items.map(async (item) => {
        const payloadIsabela = { productoCodigo: item.codigo, deposito: "ISABELA" };
        
        const [resR8, resIsa] = await Promise.all([
          fnStock({ productoCodigo: item.codigo, deposito: "RUTA8" }).catch(() => ({ data: { stock: [] } })),
          fnStock(payloadIsabela).catch(() => ({ data: { stock: [] } }))
        ]);

        const stockR8 = resR8.data.stock?.[0];
        const stockIsa = resIsa.data.stock?.[0];

        nuevosStocks[item.codigo] = {
          r8: stockR8?.Cantidad || 0,
          isa: stockIsa?.Cantidad || 0,
          nombreFinnegans: stockR8?.ProductoNombre || stockIsa?.ProductoNombre || item.descripcion
        };
      });

      await Promise.all(promesas);
      setStockPorProducto(nuevosStocks);
    } catch (error) {
      console.error("Error consultando stocks:", error);
    } finally {
      setLoadingStock(false);
    }
  };

  const cambiarEstado = async (id, nuevoEstado) => {
    try {
      await updateDoc(doc(db, "pedidos_web", id), { estado: nuevoEstado });
      setPedidoSeleccionado(null); 
    } catch (error) {
      alert("Error al actualizar estado.");
    }
  };

  const renderEstadoPill = (estado) => {
    const clases = {
      "NUEVO": "pill--brand",
      "EN PREPARACION": "pill--warn",
      "PREPARADO": "pill--ok",
      "ERROR_STOCK": "pill--error",
      "ENTREGADO": "pill--info"
    };
    return <span className={`pill ${clases[estado] || 'pill--info'}`}>{estado || "NUEVO"}</span>;
  };

  if (loading) return <div className="container screen-center">⏳ Cargando buzón...</div>;

  return (
    <div className="container">
      <header className="topbar card">
        <button 
            onClick={() => navigate("/")} 
            className="btn btn--ghost" 
            style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '5px' }}
        >
            ⬅️ Volver
        </button>
        <h1 className="h1">📦 Buzón Web - {profile?.deposito}</h1>
        <span className="pill pill--brand">{pedidos.length} Pedidos</span>
      </header>

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ID Finnegans</th>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map(p => (
              <tr key={p.id} className={p.estado === "ENTREGADO" ? "muted" : ""}>
                <td className="font-bold">{p.finnegansId}</td>
                <td>{p.clienteNombre}</td>
                <td>{p.fecha?.toDate().toLocaleDateString()}</td>
                <td className="font-bold">${p.total?.toFixed(2)}</td>
                <td>{renderEstadoPill(p.estado)}</td>
                <td>
                  <button onClick={() => abrirGestion(p)} className="btn btn--secondary btn-sm">
                    Gestionar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

        {pedidoSeleccionado && (
        <div className="modal-backdrop">
            {/* Agregamos la clase modal-card--xl */}
            <div className="modal-card modal modal-card--xl">
            
            {/* HEADER FIJO */}
            <div className="modal-header-fixed">
                <h2 className="h2" style={{ margin: 0 }}>Gestionar Pedido #{pedidoSeleccionado.finnegansId}</h2>
                
                <div className="meta" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: '15px' }}>
                <div className="meta-item"><span className="meta-label">Cliente</span><span className="meta-value">{pedidoSeleccionado.clienteNombre}</span></div>
                <div className="meta-item"><span className="meta-label">Entrega</span><span className="meta-value">{pedidoSeleccionado.metodoEntrega}</span></div>
                <div className="meta-item">
                    <span className="meta-label">Pago</span>
                    <span className="meta-value font-bold">
                    {pedidoSeleccionado.metodoPago || "No especificado"} 
                    {pedidoSeleccionado.metodoPago === "Transferencia" && ` (${pedidoSeleccionado.bancoTransferencia})`}
                    </span>
                </div>
                </div>
            </div>

            {/* ÁREA DE SCROLL (Aquí es donde entran todos los productos) */}
            <div className="modal-scroll-area">
                <div className="card--preparacion">
                <h3 className="card-header">Líneas de Pedido y Stock Real</h3>
                <table className="table table-gestion">
                    <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 10 }}>
                    <tr>
                        <th>Producto</th>
                        <th>Cant. Pedida</th>
                        <th>Stock R8</th>
                        <th>Stock ISA</th>
                        <th>Validación</th>
                    </tr>
                    </thead>
                    <tbody>
                    {pedidoSeleccionado.items.map((item, i) => {
                        const stock = stockPorProducto[item.codigo];
                        const faltaEnR8 = !loadingStock && stock?.r8 < item.cantidad;
                        return (
                        <tr key={i}>
                            <td>
                            <div style={{ fontWeight: '700' }}>{loadingStock ? item.descripcion : (stock?.nombreFinnegans || item.descripcion)}</div>
                            <small className="muted">SKU: {item.codigo}</small>
                            </td>
                            <td className="font-bold" style={{ fontSize: '1.2rem' }}>{item.cantidad}</td>
                            <td style={{ color: faltaEnR8 ? 'var(--error)' : 'inherit' }}>
                                {loadingStock ? "..." : (stock?.r8 ?? "...")}
                            </td>
                            <td>{loadingStock ? "..." : (stock?.isa ?? "...")}</td>
                            <td>
                            {!loadingStock ? (
                                faltaEnR8 ? <span className="pill pill--error">INSUFICIENTE R8</span> : <span className="pill pill--ok">DISPONIBLE</span>
                            ) : "..."}
                            </td>
                        </tr>
                        );
                    })}
                    </tbody>
                </table>
                </div>

                {pedidoSeleccionado.observaciones && (
                <div className="banner banner--warn" style={{ marginTop: '20px' }}>
                    📝 <strong>Observaciones del Cliente:</strong> {pedidoSeleccionado.observaciones}
                </div>
                )}
            </div>

            {/* FOOTER DE BOTONES FIJO */}
            <div className="product-actions" style={{ flexDirection: 'row', gap: '12px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                <button onClick={() => setPedidoSeleccionado(null)} className="btn btn--ghost" style={{ flex: 1 }}>Cerrar</button>
                
                {pedidoSeleccionado.estado === "NUEVO" && (
                <button onClick={() => cambiarEstado(pedidoSeleccionado.id, "EN PREPARACION")} className="btn btn--primary bg-warn" style={{ flex: 2 }}>🟡 Comenzar Preparación</button>
                )}
                
                {pedidoSeleccionado.estado === "EN PREPARACION" && (
                <>
                    <button onClick={() => cambiarEstado(pedidoSeleccionado.id, "ERROR_STOCK")} className="btn btn--danger" style={{ flex: 1 }}>🔴 Reportar Error</button>
                    <button onClick={() => cambiarEstado(pedidoSeleccionado.id, "PREPARADO")} className="btn btn--primary bg-ok" style={{ flex: 2 }}>🟢 Marcar como Listo</button>
                </>
                )}
            </div>
            </div>
        </div>
        )}
    </div>
  );
}