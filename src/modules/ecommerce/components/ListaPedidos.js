import React, { useState } from "react";
import logo from "../../../logo-urualum.png";
import { useApp } from "context/AppContext";
import { useNavigate } from "react-router-dom";

export default function ListaPedidos({ pedidos, loading, onVolver }) {
  const navigate = useNavigate();
  const { agregarAlCarrito, limpiarCarrito } = useApp();
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);

  const renderEstadoPill = (estado) => {
    switch(estado) {
        case "NUEVO":          return <span className="pill pill--brand">🔵 Recibido</span>;
        case "EN PREPARACION": return <span className="pill pill--warn">🟡 En Preparación</span>;
        case "PREPARADO":      return <span className="pill pill--ok">🟢 ¡Listo para retirar!</span>;
        case "ERROR_STOCK":    return <span className="pill pill--error">🔴 Diferencia de Stock</span>;
        case "ENTREGADO":      return <span className="pill pill--info">✅ Entregado</span>;
        case "CANCELADO":      return <span className="pill pill--error">🚫 Cancelado</span>;
        default: return <span className="pill">{estado}</span>;
    }
  };

  // FUNCIÓN PARA REPETIR EL PEDIDO
  const handleRepetirPedido = (pedido) => {
    const confirmar = window.confirm("¿Deseas vaciar tu carrito actual y cargar los productos de este pedido?");
    if (confirmar) {
        limpiarCarrito();
        pedido.items.forEach(item => {
            agregarAlCarrito({
                codigo: item.codigo,
                descripcion: item.descripcion,
                cantidad: item.cantidad,
                precioUnitario: item.precioUnitario,
                precioTotal: item.precioUnitario * item.cantidad
            });
        });
        navigate("/carrito");
    }
  };

  return (
    <div className="container" style={{ paddingBottom: '40px' }}>
        <header className="topbar card" style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button 
                    onClick={onVolver} 
                    className="btn btn--secondary nav-back"
                >
                    ← Inicio
                </button>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderLeft: '1px solid #eee', paddingLeft: '12px' }}>
                    <img src={logo} alt="Urualum" style={{ height: '24px', width: 'auto' }} />
                    <h2 className="h2" style={{ margin: 0, color: 'var(--brand)', fontSize: '1rem' }}>
                        Mis Pedidos
                    </h2>
                </div>
            </div>
        </header>

        {loading ? (
            <div className="card empty-card">⏳ Sincronizando...</div>
        ) : pedidos.length === 0 ? (
            <div className="card empty-card"><h3 className="h2 muted">No hay compras registradas.</h3></div>
        ) : (
            <div className="orders-grid">
                {pedidos.map(p => (
                    <div key={p.id} onClick={() => setPedidoSeleccionado(p)} className="order-card card card--selectable">
                        <div className="order-head">
                            <div>
                                <h3 className="order-number">Pedido #{p.finnegansId}</h3>
                                <div className="meta-label">
                                    {p.fecha?.toDate().toLocaleDateString("es-UY", {day: '2-digit', month: 'short'})}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div className="h2" style={{ margin: '0 0 4px 0' }}>${p.total?.toFixed(2)}</div>
                                {renderEstadoPill(p.estado)}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        )}

        {/* MODAL DE DETALLE DE PEDIDO */}
        {pedidoSeleccionado && (
            <div className="modal-backdrop">
                <div className="modal-card modal">
                    <h3 className="modal-title">Detalle Pedido #{pedidoSeleccionado.finnegansId}</h3>
                    
                    <div className="card--preparacion" style={{ margin: '15px 0' }}>
                        <div className="meta-item">
                            <span className="meta-label">Estado actual:</span>
                            {renderEstadoPill(pedidoSeleccionado.estado)}
                        </div>
                    </div>

                    {/* 👇 AQUÍ ESTÁN LAS VALIDACIONES LIMPIAS Y CON TUS CLASES 👇 */}
                    {pedidoSeleccionado.estado === "PREPARADO" && (
                        <div className="banner banner--info">
                            <p className="font-bold">💡 ¡Tu pedido está listo en depósito!</p>
                            
                            {pedidoSeleccionado.metodoPago === "Transferencia" ? (
                                <div className="card--preparacion bg-soft">
                                    <span className="meta-label text-brand font-bold">🏦 Datos para Transferencia ({pedidoSeleccionado.bancoTransferencia}):</span>
                                    <div className="space-y-2">
                                        <p>Titular: <span className="font-bold">NICUICO, SA.</span></p>
                                        
                                        {pedidoSeleccionado.bancoTransferencia === "BROU" && (
                                            <>
                                                <p>Cuenta Pesos ($): <span className="font-bold">184-0844570 / 001818622-00001</span></p>
                                                <p>Cuenta Dólares (U$S): <span className="font-bold">184-0844588 / 001818622-00002</span></p>
                                            </>
                                        )}
                                        {pedidoSeleccionado.bancoTransferencia === "ITAU" && (
                                            <>
                                                <p>Cuenta Pesos ($): <span className="font-bold">7133510</span></p>
                                                <p>Cuenta Dólares (U$S): <span className="font-bold">7132404</span></p>
                                            </>
                                        )}
                                        {pedidoSeleccionado.bancoTransferencia === "SANTANDER" && (
                                            <>
                                                <p>Cuenta Pesos ($): <span className="font-bold">1174665</span> (Suc. 7)</p>
                                                <p>Cuenta Dólares (U$S): <span className="font-bold">5101083855</span></p>
                                            </>
                                        )}
                                    </div>
                                    <p className="font-bold text-error">
                                        📲 Por favor, envía el comprobante de pago al grupo de WhatsApp para que podamos liberar la mercadería.
                                    </p>
                                </div>
                            ) : (
                                <p className="font-bold text-brand">
                                    🛒 Por favor, acercate por el local para realizar el pago (Efectivo o Débito) y retirar la mercadería.
                                </p>
                            )}
                        </div>
                    )}

                    {pedidoSeleccionado.estado === "ERROR_STOCK" && (
                        <div className="banner banner--error">
                            <p className="font-bold">⚠️ Diferencia de stock en tu pedido</p>
                            {pedidoSeleccionado.notaError ? (
                                <p>{pedidoSeleccionado.notaError}</p>
                            ) : (
                                <p>Un asesor se contactará contigo a la brevedad.</p>
                            )}
                        </div>
                    )}

                    {pedidoSeleccionado.estado === "CANCELADO" && (
                        <div className="banner banner--error">
                            <p className="font-bold">🚫 Este pedido fue cancelado</p>
                            {pedidoSeleccionado.notaError && <p>{pedidoSeleccionado.notaError}</p>}
                        </div>
                    )}
                    {/* 👆 FIN DE LAS VALIDACIONES 👆 */}

                    <div className="space-y-2" style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '20px' }}>
                        {pedidoSeleccionado.items?.map((item, idx) => (
                            <div key={idx} className="qty-row" style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}>
                                <div style={{ flex: 1 }}>
                                    <div className="product-customer">{item.descripcion}</div>
                                    <div className="product-desc">Cód: {item.codigo}</div>
                                </div>
                                <div style={{ fontWeight: 'bold' }}>{item.cantidad} x ${item.precioUnitario}</div>
                            </div>
                        ))}
                    </div>

                    <div className="product-actions">
                        <button 
                            onClick={() => handleRepetirPedido(pedidoSeleccionado)}
                            className="btn btn--primary btn--full"
                            style={{ background: 'var(--ok)' }}
                        >
                            🔄 REPETIR ESTE PEDIDO
                        </button>
                        <button onClick={() => setPedidoSeleccionado(null)} className="btn btn--ghost btn--full">
                            Cerrar
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}