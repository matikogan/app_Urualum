import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions, db } from "../firebase";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import SelectorCantidad from "../components/SelectorCantidad";

export default function Carrito() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { 
      carrito, 
      limpiarCarrito,
      actualizarCantidadItem,
      subtotalCarrito, 
      eliminarDelCarrito,
      ivaCarrito, 
      totalConIva,
      nombreLista,
      clienteActivo 
  } = useApp();

  const [metodoEntrega, setMetodoEntrega] = useState("Retiro Ruta 8");
  const [metodoPago, setMetodoPago] = useState("Pago en el local");
  const [bancoTransferencia, setBancoTransferencia] = useState("BROU");
  const [observaciones, setObservaciones] = useState("");
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [pedidoIdFinal, setPedidoIdFinal] = useState("");
  const [itemABorrar, setItemABorrar] = useState(null); // Almacenamos el index del producto


  // 1. CONFIGURACIÓN DE LÍMITES POR CÓDIGO
  const PRODUCTOS_LIMITADOS = ['502001901', '502001902', '502001903', '502001904'];
  const LIMITE_MAXIMO = 20;

  const crearPedidoFinal = async () => {

        // 🔥 Obtenemos qué cliente y qué nombre usar
        const codigoFinal = clienteActivo?.finnegansClienteCodigo || profile?.finnegansClienteCodigo;
        const nombreFinal = clienteActivo?.nombre || profile?.nombre || profile?.email;

        if (carrito.length === 0) return alert("El carrito está vacío");
        if (!codigoFinal) return alert("Error: Cliente no vinculado.");
        if (!nombreLista) return alert("Error: No se detectó la lista.");

        setLoadingSubmit(true);
        try {
            // 1. Desglosamos los kits para Firebase (Vendedores)
            const itemsDesglosados = [];
            carrito.forEach(item => {
                if (item.esKit && item.componentes) {
                    item.componentes.forEach(comp => {
                        const cantTotalComp = comp.cantidadBase * item.cantidad;
                        itemsDesglosados.push({
                            codigo: comp.codigo,
                            descripcion: `[Kit] ${comp.desc}`,
                            cantidad: cantTotalComp,
                            // Aseguramos que el precio unitario sea número aquí también
                            precioUnitario: Number(comp.precioUnitario),
                            precioTotal: Number(comp.precioUnitario) * cantTotalComp
                        });
                    });
                } else {
                    itemsDesglosados.push(item);
                }
            });

            // 2. Preparamos el payload para Finnegans (API)
            // 🔥 LA CORRECCIÓN ESTÁ ACÁ: Forzamos a que sean números con 2 decimales 🔥
            const itemsFinnegans = itemsDesglosados.map(item => ({
                ProductoCodigo: item.codigo,
                Cantidad: Number(item.cantidad),
                // Number(...toFixed(2)) convierte el texto "133.15" en el número 133.15
                Precio: Number(Number(item.precioUnitario).toFixed(2)) 
            }));

            const infoPago = metodoPago === "Transferencia" ? `Transferencia (${bancoTransferencia})` : metodoPago;
            const descripcionPedido = `App Mobile V3 | Entrega: ${metodoEntrega} | Pago: ${infoPago} | Obs: ${observaciones}`;

            // Console logs para depuración (iguales a los de tu captura)
            console.log("PARTE 1 - ITEMS DESGLOSADOS (INTERNO):", itemsDesglosados);
            console.log("PARTE 2 - PAYLOAD A FINNEGANS:", itemsFinnegans);

            const fn = httpsCallable(functions, "finnegansCrearPedidoVenta");
            const res = await fn({
                ClienteCodigo: codigoFinal, // <-- Usamos la variable inteligente
                ListaPrecioCodigo: nombreLista, 
                Descripcion: descripcionPedido,
                Items: itemsFinnegans
            });
            
            const idFinnegans = res.data.pedidoGenerado?.documento || `WEB-${Date.now()}`;
            const depositoRuteo = metodoEntrega === "Retiro Isabela" ? "ISABELA" : "R8";

            // Guardamos en Firebase con trazabilidad
            await setDoc(doc(db, "pedidos_web", String(idFinnegans)), {
                clienteId: clienteActivo ? "VENDEDOR_APP" : profile.id, // Auditoría
                creadoPorVendedor: clienteActivo ? profile.email : null, // Quién lo armó
                clienteNombre: nombreFinal,
                finnegansId: idFinnegans,
                fecha: serverTimestamp(),
                items: itemsDesglosados, 
                subtotal: subtotalCarrito,
                iva: ivaCarrito,
                total: totalConIva,
                metodoEntrega,
                metodoPago, 
                bancoTransferencia: metodoPago === "Transferencia" ? bancoTransferencia : null,
                observaciones,
                estado: "NUEVO",
                depositoAsignado: depositoRuteo 
            });

            setPedidoIdFinal(idFinnegans);
            setShowSuccessModal(true);
            limpiarCarrito();
            
        } catch (error) {
            console.error("Error al crear pedido:", error);
            // Mostramos un mensaje más amigable si falla Finnegans
            alert(`❌ Hubo un error al comunicarse con el sistema central. Por favor, intentá nuevamente en unos minutos.\n\nDetalle técnico: ${error.message}`);
        } finally {
            setLoadingSubmit(false);
        }
    };

    if (carrito.length === 0 && !showSuccessModal) {
        return (
        <div className="container screen-center">
            <div className="card empty-card">
                <div className="h1">🛒</div>
                <h2 className="h2">Tu carrito está vacío</h2>
                <p className="muted">Aún no has agregado productos a tu pedido.</p>
                <button onClick={() => navigate("/catalogo")} className="btn btn--primary btn--full">
                    Ir al Catálogo de Productos
                </button>
            </div>
        </div>
        );
    }

    const handleCambioCantidad = (index, valor, codigo) => {
    // Definimos los productos con restricción de stock
    const PRODUCTOS_LIMITADOS = ['502001901', '502001902', '502001903', '502001904'];
    const LIMITE_MAXIMO = 20;

    let num = parseInt(valor);
    
    // Si el usuario borra el número, lo dejamos en blanco para que pueda escribir,
    // pero al actualizar el estado nos aseguramos de que sea al menos 1.
    if (valor === "") {
        actualizarCantidadItem(index, 0); // Esto permite limpiar el input para escribir
        return;
    }

    if (isNaN(num) || num < 1) num = 1;

    // Aplicamos el límite de 20 unidades para los códigos específicos
    if (PRODUCTOS_LIMITADOS.includes(codigo) && num > LIMITE_MAXIMO) {
        alert(`Atención: El producto ${codigo} tiene un límite de venta de ${LIMITE_MAXIMO} unidades por pedido.`);
        num = LIMITE_MAXIMO;
    }

    actualizarCantidadItem(index, num);
};

  return (
    <div className="container" style={{ overflowX: 'hidden' }}>
        <header className="topbar card">
            <h2 className="h2 text-brand">Resumen de Pedido</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                
                {/* BOTÓN VACIAR TODO: Corregido (sin index) */}
                <button 
                    className="btn--clear-all" 
                    onClick={() => {
                        if(window.confirm("¿Estás seguro que deseas vaciar todo el carrito?")) {
                            limpiarCarrito();
                        }
                    }}
                >
                    Vaciar Carrito
                </button>

                <button onClick={() => navigate("/catalogo")} className="btn btn--secondary btn-sm">
                    ← Seguir
                </button>
            </div>
        </header>

        <div className="ventas-grid">
        {/* Card de Productos */}
            <div className="card" style={{ width: '100%' }}>
                <h3 className="card-header">Tus Productos ({carrito.length})</h3>
                <div className="space-y-2">
                    {carrito.map((item, index) => (
                        <div key={index} className="card--compact" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            
                            {/* 1. Información del Producto con Precio Dinámico */}
                            <div style={{ flex: 1, minWidth: 0 }}> 
                                <div className="factura-heading" style={{ fontSize: '14px', lineHeight: '1.2', marginBottom: '4px' }}>
                                    {item.descripcion}
                                </div>
                                <div className="factura-sub" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span>Cod: {item.codigo}</span>
                                    
                                    {/* 🔥 Lógica visual del precio limpio 🔥 */}
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '2px' }}>
                                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--brand, #0f172a)' }}>
                                            ${Number(item.precioTotal).toFixed(2)}
                                        </span>
                                        
                                        {/* Solo mostramos el desglose si lleva más de 1 unidad para no ensuciar la vista */}
                                        {item.cantidad > 1 && (
                                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                                                ({item.cantidad} x ${Number(item.precioUnitario).toFixed(2)})
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* 2. Selector de Cantidad (Píldora) */}
                            <SelectorCantidad 
                                cantidad={item.cantidad} 
                                onChange={(val) => actualizarCantidadItem(index, val)} 
                                producto={item}
                            />

                            {/* 3. Botón de Eliminar */}
                            <button 
                                className="btn--remove" 
                                style={{ marginLeft: '4px' }} 
                                onClick={() => setItemABorrar(index)}
                            >
                                🗑️
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="card card--highlight" style={{ width: '100%', margin: 0 }}>
                <h3 className="card-header text-ok">Finalizar Compra</h3>
                
                <div className="meta">
                    <div className="meta-item">
                        <span className="meta-label">Subtotal (Neto)</span>
                        <span className="meta-value">${subtotalCarrito.toFixed(2)}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">IVA (22%)</span>
                        <span className="meta-value">${ivaCarrito.toFixed(2)}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">TOTAL A PAGAR</span>
                        <div className="h1 text-ink">
                            ${totalConIva.toFixed(2)}
                        </div>
                    </div>
                </div>

                <div className="form">
                    <div className="field-group">
                        <label className="label">🚚 Método de Entrega:</label>
                        <select className="input" value={metodoEntrega} onChange={(e) => setMetodoEntrega(e.target.value)}>
                            <option value="Retiro Ruta 8">Retiro en Local - Ruta 8</option>
                            <option value="Retiro Isabela">Retiro en Local - Isabela</option>
                            <option value="Envio Agencia">Envío por Agencia</option>
                            <option value="Envio Camion">Envío con Camión Propio</option>
                        </select>
                    </div>

                    <div className="field-group">
                        <label className="label">💳 Método de Pago:</label>
                        <select className="input" value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}>
                            <option value="Pago en el local">Pago en el local (Efectivo / Débito)</option>
                            <option value="Transferencia">Transferencia Bancaria</option>
                        </select>
                    </div>

                    {metodoPago === "Transferencia" && (
                        <div className="field-group">
                            <label className="label">🏦 Banco a transferir:</label>
                            <select className="input" value={bancoTransferencia} onChange={(e) => setBancoTransferencia(e.target.value)}>
                                <option value="BROU">BROU</option>
                                <option value="ITAU">Banco ITAU</option>
                                <option value="SANTANDER">Banco Santander</option>
                            </select>
                        </div>
                    )}

                    <div className="field-group">
                        <label className="label">📝 Observaciones:</label>
                        <textarea className="input textarea" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Instrucciones adicionales..." />
                    </div>

                    <div className="btn-center">
                        <button 
                            onClick={crearPedidoFinal} 
                            className="btn btn--primary" 
                            style={{ width: '100%', marginTop: '20px' }}
                        >
                            {loadingSubmit ? "⏳ ENVIANDO..." : "CONFIRMAR Y ENVIAR"}
                        </button>
                    </div>
                </div>
            </div>
      </div>

      {showSuccessModal && (
        <div className="modal-backdrop">
            <div className="modal-card modal text-center">
            <div className="icon-success">✓</div>
            <h2 className="h2 text-ok">¡Pedido Recibido!</h2>
            <p className="muted">Tu pedido ha sido enviado correctamente a administración.</p>
            <div className="card--preparacion bg-soft">
                <span className="meta-label">ID DE PEDIDO (FINNEGANS)</span>
                <div className="mono font-bold text-lg">{pedidoIdFinal}</div>
            </div>
            <button onClick={() => navigate("/inicio")} className="btn btn--primary btn--full btn--elevated">VOLVER AL INICIO</button>
            <button onClick={() => navigate("/mis-pedidos")} className="btn btn--secondary btn--full">VER MIS PEDIDOS</button>
            </div>
        </div>
        )}
        {/* MODAL DE CONFIRMACIÓN DE ELIMINACIÓN */}
        {itemABorrar !== null && (
            <div className="modal-backdrop">
                <div className="modal-card modal text-center">
                    <h3 className="modal-title">¿Eliminar producto?</h3>
                    <p className="muted">
                        Vas a quitar <strong>{carrito[itemABorrar]?.descripcion}</strong> del pedido.
                    </p>
                    <div className="product-actions">
                        <button 
                            className="btn btn--danger btn--full"
                            onClick={() => {
                                eliminarDelCarrito(itemABorrar);
                                setItemABorrar(null); // Cerramos el modal
                            }}
                        >
                            Sí, eliminar
                        </button>
                        <button 
                            className="btn btn--ghost btn--full"
                            onClick={() => setItemABorrar(null)}
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}