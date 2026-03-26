import React, { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions, db } from "../firebase";
import { doc, getDoc, collection, getDocs, query, where, limit } from "firebase/firestore";
import { calcularPrecioFinal } from "../utils/priceCalculator";

export default function TestFinnegans() {
  // --- ESTADOS DE USUARIO ---
  const [usuarioApp, setUsuarioApp] = useState(null);
  const [reglasPrecios, setReglasPrecios] = useState(null);
  const [nombreLista, setNombreLista] = useState("");

  // --- NAVEGACIÓN JERÁRQUICA (3 NIVELES) ---
  const [nivel1, setNivel1] = useState(null); 
  const [nivel2, setNivel2] = useState(null); 
  const [nivel3, setNivel3] = useState(null); 
  const [productosFiltrados, setProductosFiltrados] = useState([]);
  const [loadingProd, setLoadingProd] = useState(false);

  // --- SELECCIÓN ACTUAL ---
  const [productoSeleccionado, setProductoSeleccionado] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [precioCalculado, setPrecioCalculado] = useState(0);
  const [stockInfo, setStockInfo] = useState(null);
  const [loadingStock, setLoadingStock] = useState(false);
  const [loadingPrecio, setLoadingPrecio] = useState(false);

  // --- CARRITO Y CHECKOUT (NUEVOS ESTADOS) ---
  const [carrito, setCarrito] = useState([]);
  const [metodoEntrega, setMetodoEntrega] = useState("Retiro Ruta 8");
  const [observaciones, setObservaciones] = useState("");
  
  const [logs, setLogs] = useState([]);
  const addLog = (msg) => setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);

  // ============================================================
  // CONFIGURACIÓN DEL MENÚ
  // ============================================================
  const MENU_ESTRUCTURA = [
    { 
      nombre: "Perfiles Aluminio", 
      subcategorias: [
        { nombre: "Serie 25", colores: ["Anodizado", "Blanco", "Madera", "Anolok"] },
        { nombre: "Puerta / Serie 30", colores: ["Anodizado", "Blanco", "Madera", "Anolok", "Sin Anodizar"] },
        { nombre: "Modena", colores: ["Anodizado"] },
        { nombre: "RSV-400", colores: ["Blanco"] },
        { nombre: "RSV-600", colores: ["Blanco"] },
        { nombre: "Serie 20", colores: ["Anodizado", "Blanco", "Madera", "Anolok", "Sin Acabado"] },
        { nombre: "Americana", colores: ["Anodizado"] },
        { nombre: "Perfil U", colores: ["Anodizado", "Blanco", "Anolok"] },
        { nombre: "Angulo", colores: ["Anodizado", "Blanco", "Anolok"] },
        { nombre: "Baranda", colores: ["Anodizado"] },
        { nombre: "Mampara", colores: ["Anodizado", "Blanco", "Anolok", "Madera"] },
        { nombre: "Pbb", colores: ["Anodizado", "Blanco"] },
        { nombre: "Varios", colores: ["Anodizado", "Blanco", "Madera", "Anolok"] },
        { nombre: "Tubo", colores: ["Anodizado", "Blanco", "Anolok", "Madera", "Small"] },
        { nombre: "Serie 30 SMALL", colores: ["Anodizado", "Madera", "Anolok", "Blanco", "Sin anodizar"] },
        { nombre: "Serie 25 SMALL", colores: ["Anodizado", "Madera", "Anolok", "Blanco"] },
        { nombre: "Serie 20 SMALL", colores: ["Anodizado", "Madera", "Anolok", "Blanco"] },
        { nombre: "Tubo SMALL", colores: ["Anodizado", "Anolok", "Blanco"] },
        { nombre: "Angulos SMALL", colores: ["Anodizado", "Blanco", "Anolok"] },
        { nombre: "Perfil U SMALL", colores: ["Anodizado", "Anolok", "Blanco"] }
      ] 
    },
    { 
      nombre: "Accesorio Aluminio", 
      subcategorias: [
        { nombre: "Bisagra", colores: [] },
        { nombre: "Burlete", colores: [] },
        { nombre: "Cerraduras, Cierres y Manijas", colores: [] },
        { nombre: "Felpa", colores: [] },
        { nombre: "Rodamiento", colores: [] },
        { nombre: "Varios", colores: [] },
        { nombre: "Insumos DVH", colores: [] },
        { nombre: "Plasticos", colores: [] },
        { nombre: "Tejido Mosquitero", colores: [] }
      ] 
    },
    { nombre: "Accesorio PVC", subcategorias: [{ nombre: "50 LIK", colores: [] }, { nombre: "Bayindir", colores: [] }, { nombre: "50 LIK / Bayindir", colores: [] }] },
    { nombre: "Chapa de aluminio", subcategorias: [{ nombre: "Lisa", colores: [] }, { nombre: "Antideslizante", colores: [] }] },
    { nombre: "Perfiles PVC", subcategorias: [{ nombre: "Bayindir", colores: ["Blanco", "Negro", "Madera", "Antracita"] }, { nombre: "50 LIK", colores: ["Blanco", "Negro", "Madera", "Antracita"] }, { nombre: "50 LIK / Bayindir", colores: ["Blanco", "Negro", "Madera", "Antracita"] }, { nombre: "Refuerzo", colores: [] }] },
    { nombre: "Claroflex", subcategorias: [] },
    { nombre: "Cortinas", subcategorias: [] },
    { nombre: "Mosquitero Enrollable", subcategorias: [] },
    { nombre: "Vidrio", subcategorias: [{ nombre: "Laminados", colores: [] }, { nombre: "Float", colores: [] }] },
    { nombre: "Varios", subcategorias: [{ nombre: "Maquinas Varias", colores: [] }] },
    { nombre: "Kit", subcategorias: [{ nombre: "Puerta / Serie 30", colores: ["Anodizado", "Blanco", "Madera", "Anolok"] }, { nombre: "Serie 20", colores: [] }, { nombre: "Americana", colores: [] }, { nombre: "Cerraduras", colores: [] }, { nombre: "Accesorios", colores: [] }, { nombre: "Serie 25", colores: [] }] },
    { nombre: "Armado Obras", subcategorias: [{ nombre: "Aluminio", colores: [] }, { nombre: "PVC", colores: [] }, { nombre: "Maquinas PVC", colores: [] }, { nombre: "Piso de Agencia", colores: [] }, { nombre: "Cortinas de Enrollar", colores: [] }, { nombre: "Compras Grales", colores: [] }] }
  ];

  // ============================================================
  // 1. LOGIN Y REGLAS
  // ============================================================
  const simularLoginSilvia = async () => {
    try {
        const UID_CANDIDATO = "4kzt7WwST8V5luyOtv0y6F87ZOC3"; 
        const userSnap = await getDoc(doc(db, "users", UID_CANDIDATO));
        if(userSnap.exists()) {
            const u = userSnap.data();
            setUsuarioApp(u);
            if(u.finnegansClienteCodigo) cargarDatosClienteYReglas(u.finnegansClienteCodigo);
        }
    } catch(e) { alert(e.message); }
  };

  const cargarDatosClienteYReglas = async (codigoFinn) => {
    try {
        const fn = httpsCallable(functions, "finnegansGetCliente");
        const res = await fn({ codigo: codigoFinn });
        const cli = res.data.cliente;
        const listaCod = cli?.ListaPrecioDefaultCodigo;
        
        if(listaCod) {
            setNombreLista(listaCod);
            const docSnap = await getDoc(doc(db, "config_lista_precios", listaCod));
            if(docSnap.exists()) setReglasPrecios(docSnap.data().rules);
        } else {
            console.warn("Cliente sin lista default");
        }
    } catch (e) { console.error("Error reglas:", e); }
  };

  // =====================================================
  // 2. NAVEGACIÓN Y CARGA
  // =====================================================
  const clickNivel1 = (nombre) => {
    setNivel1(nombre); setNivel2(null); setNivel3(null); setProductosFiltrados([]); setProductoSeleccionado(null);
    const catObj = MENU_ESTRUCTURA.find(c => c.nombre === nombre);
    if (!catObj.subcategorias || catObj.subcategorias.length === 0) cargarProductos(nombre, null, null);
  };
  const clickNivel2 = (subObjeto) => {
    setNivel2(subObjeto.nombre); setNivel3(null); setProductoSeleccionado(null);
    if (!subObjeto.colores || subObjeto.colores.length === 0) cargarProductos(nivel1, subObjeto.nombre, null);
  };
  const clickNivel3 = (color) => {
      setNivel3(color); cargarProductos(nivel1, nivel2, color);
  };
  const volverAtras = () => {
    if (productoSeleccionado) setProductoSeleccionado(null);
    else if (nivel3) { setNivel3(null); setProductosFiltrados([]); }
    else if (nivel2) { setNivel2(null); setProductosFiltrados([]); }
    else setNivel1(null); 
  };

  const cargarProductos = async (padre, rama1, rama2) => {
    try {
        setLoadingProd(true);
        let restricciones = [where("padre", "==", padre)];
        if (rama1) restricciones.push(where("rama1", "==", rama1));
        if (rama2) restricciones.push(where("rama2", "==", rama2));

        const q = query(collection(db, "catalogoProductos"), ...restricciones, limit(50));
        const querySnapshot = await getDocs(q);
        setProductosFiltrados(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err) {
        console.error(err);
        if(err.message.includes("index")) alert("⚠️ FALTA ÍNDICE EN FIRESTORE.");
    } finally { setLoadingProd(false); }
  };

  // =====================================================
  // 3. SELECCIÓN DE PRODUCTO (Precio y Stock)
  // =====================================================
  const seleccionarProducto = async (prodFirestore) => {
    const codFinn = prodFirestore.codUru || prodFirestore.codigo;
    if (!codFinn) return alert("Producto sin código");

    setProductoSeleccionado(prodFirestore);
    setStockInfo(null);
    setPrecioCalculado(0);
    setCantidad(1); // Reseteamos cantidad al elegir nuevo producto
    
    setLoadingStock(true);
    httpsCallable(functions, "finnegansConsultarStock")({ productoCodigo: codFinn, deposito: "RUTA8" })
      .then(res => setStockInfo(res.data.stock?.[0] || { Cantidad: 0, Unidad: "Un." }))
      .finally(() => setLoadingStock(false));

    setLoadingPrecio(true);
    try {
        const fn = httpsCallable(functions, "finnegansGetProductoDetalle");
        const res = await fn({ codigo: codFinn });
        const precioBase = Number(res.data.producto.PrecioBase || 0);
        const final = calcularPrecioFinal(precioBase, reglasPrecios, codFinn);
        setPrecioCalculado(final);
    } catch(e) { console.error(e); } 
    finally { setLoadingPrecio(false); }
  };

  // =====================================================
  // 4. LÓGICA DEL CARRITO
  // =====================================================
  const agregarAlCarrito = () => {
      if(!productoSeleccionado || precioCalculado <= 0 || cantidad <= 0) return;

      const codFinn = productoSeleccionado.codUru || productoSeleccionado.codigo;
      
      const nuevoItem = {
          codigo: codFinn,
          descripcion: productoSeleccionado.descripcion || codFinn,
          cantidad: Number(cantidad),
          precioUnitario: precioCalculado,
          precioTotal: precioCalculado * Number(cantidad)
      };

      setCarrito([...carrito, nuevoItem]);
      addLog(`🛒 Agregado: ${nuevoItem.cantidad}x ${nuevoItem.descripcion}`);
      
      // Limpiamos selección para permitir seguir comprando
      setProductoSeleccionado(null);
  };

  const eliminarDelCarrito = (index) => {
      const nuevoCarrito = carrito.filter((_, i) => i !== index);
      setCarrito(nuevoCarrito);
  };

  // 4. LÓGICA DEL CARRITO (Cálculos de IVA)
  // =====================================================
  
  // Calcula el Subtotal (Bruto)
  const subtotalCarrito = carrito.reduce((acc, item) => acc + item.precioTotal, 0);
  
  // Calcula el IVA (22%)
  const ivaCarrito = subtotalCarrito * 0.22;
  
  // Total Final a Pagar
  const totalConIva = subtotalCarrito + ivaCarrito;

  // =====================================================
  // 5. ENVÍO DEL PEDIDO A FINNEGANS
  // =====================================================
  const crearPedidoFinal = async () => {
      if(carrito.length === 0) return alert("El carrito está vacío");
      if(!nombreLista) return alert("Error: No se detectó la lista de precios del cliente.");

      try {
          addLog(`🚀 Enviando pedido con ${carrito.length} líneas...`);
          
          // Formateamos los items exactamente como los espera Finnegans
          const itemsFinnegans = carrito.map(item => ({
              ProductoCodigo: item.codigo,
              Cantidad: item.cantidad,
              Precio: item.precioUnitario
          }));

          // Armamos la descripción con los datos logísticos
          const descripcionPedido = `App Mobile V3 | Entrega: ${metodoEntrega} | Obs: ${observaciones}`;

          const fn = httpsCallable(functions, "finnegansCrearPedidoVenta");
          const res = await fn({
              ClienteCodigo: usuarioApp.finnegansClienteCodigo,
              ListaPrecioCodigo: nombreLista, 
              Descripcion: descripcionPedido,
              Items: itemsFinnegans
          });
          
          addLog(`✅ ¡Pedido Creado! ID: ${res.data.pedidoGenerado?.id}`);
          alert(`✅ Pedido Creado Exitosamente. ID: ${res.data.pedidoGenerado?.id}`);
          
          // Limpiamos el carrito tras el éxito
          setCarrito([]);
          setObservaciones("");
          
      } catch (error) {
          console.error(error);
          alert(`❌ Error al crear pedido: ${error.message}`);
          addLog(`❌ Error API: ${error.message}`);
      }
  };

  // =====================================================
  // UI HELPERS
  // =====================================================
  const btnStyle = (bg) => ({ padding: 15, background: bg, color: "white", border: "none", borderRadius: 8, fontSize: 16, cursor: "pointer", textAlign: "left" });
  const objNivel1 = MENU_ESTRUCTURA.find(c => c.nombre === nivel1);
  const subcategorias = objNivel1?.subcategorias || [];
  const objNivel2 = subcategorias.find(s => s.nombre === nivel2);
  const colores = objNivel2?.colores || [];

  return (
    <div style={{ padding: 20, maxWidth: 1000, margin: "0 auto", fontFamily: "sans-serif" }}>
      <h2>Simulador de App Urualum (Multiproducto)</h2>

      {!usuarioApp && (
          <button onClick={simularLoginSilvia} style={{padding:15, width:"100%", background:"#faad14", border:"none", borderRadius:8, cursor:"pointer", fontSize:16}}>
              🔐 Ingresar como Silvia
          </button>
      )}

      {usuarioApp && (
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start"}}>
            
            {/* =========================================
                COLUMNA IZQUIERDA: CATÁLOGO Y NAVEGACIÓN
                ========================================= */}
            <div style={{background: "#f9f9f9", padding: 15, borderRadius: 8, border: "1px solid #ddd"}}>
                <div style={{marginBottom: 10, padding: 10, background: "#e6f7ff", borderRadius: 8, border: "1px solid #91d5ff"}}>
                👤 <strong>{usuarioApp.nombre}</strong> {reglasPrecios && "✅ Dto. Activo"}
                </div>

                {nivel1 && (
                    <button onClick={volverAtras} style={{marginBottom:15, cursor:"pointer", padding: "5px 10px", background:"#fff", border:"1px solid #ccc", borderRadius: 4}}>
                        ⬅ Volver / Atrás
                    </button>
                )}

                {!nivel1 && (
                    <div style={{display: "grid", gridTemplateColumns: "1fr", gap: 10}}>
                        {MENU_ESTRUCTURA.map(cat => (
                            <button key={cat.nombre} onClick={() => clickNivel1(cat.nombre)} style={btnStyle("#0050b3")}>{cat.nombre}</button>
                        ))}
                    </div>
                )}

                {nivel1 && !nivel2 && subcategorias.length > 0 && (
                    <div style={{display: "grid", gridTemplateColumns: "1fr", gap: 10}}>
                        {subcategorias.map(sub => (
                            <button key={sub.nombre} onClick={() => clickNivel2(sub)} style={btnStyle("#1890ff")}>{sub.nombre}</button>
                        ))}
                    </div>
                )}

                {nivel2 && !nivel3 && colores.length > 0 && (
                    <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10}}>
                        {colores.map(col => (
                            <button key={col} onClick={() => clickNivel3(col)} style={btnStyle("#13c2c2")}>{col}</button>
                        ))}
                    </div>
                )}

                {((nivel1 && subcategorias.length === 0) || (nivel2 && colores.length === 0) || nivel3) && (
                    <div>
                        <h4 style={{marginTop:0}}>{nivel1} {nivel2 ? " > "+nivel2 : ""} {nivel3 ? " > "+nivel3 : ""}</h4>
                        
                        {loadingProd ? <p>⏳ Buscando en base de datos...</p> : (
                            <div style={{height: 250, overflowY: "auto", border: "1px solid #ccc", marginBottom: 20}}>
                                {productosFiltrados.length === 0 && <p style={{padding:10}}>No se encontraron productos.</p>}
                                
                                {productosFiltrados.map(p => (
                                    <div key={p.id} onClick={() => seleccionarProducto(p)}
                                        style={{padding: 10, borderBottom: "1px solid #eee", background: productoSeleccionado?.id === p.id ? "#e6f7ff" : "white", cursor: "pointer"}}>
                                        <strong>{p.descripcion || p.nombre || p.codUru}</strong><br/>
                                        <small style={{color:"#666"}}>Cód: {p.codUru}</small>
                                    </div>
                                ))}
                            </div>
                        )}

                        {productoSeleccionado && (
                            <div style={{padding: 15, background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 8}}>
                                <h4 style={{marginTop:0}}>{productoSeleccionado.descripcion || productoSeleccionado.codUru}</h4>
                                
                                <div style={{display:"flex", justifyContent:"space-between", marginBottom:10}}>
                                    <span>Stock R8: {loadingStock ? " ⏳" : (stockInfo ? <strong style={{color: stockInfo.Cantidad>0?"green":"red"}}>{stockInfo.Cantidad}</strong> : " -")}</span>
                                    <span>Precio Unt: {loadingPrecio ? " ⏳" : (precioCalculado ? <strong>${precioCalculado}</strong> : " -")}</span>
                                </div>

                                <div style={{display:"flex", gap:10}}>
                                    <div>
                                        <label style={{display:"block", fontSize: 12}}>Cant.</label>
                                        <input type="number" value={cantidad} onChange={e=>setCantidad(e.target.value)} style={{width:60, padding: 8}} />
                                    </div>
                                    <button 
                                        onClick={agregarAlCarrito} 
                                        disabled={loadingPrecio || precioCalculado <= 0}
                                        style={{flex:1, background:"#fa8c16", color:"white", border:"none", borderRadius:4, cursor:"pointer", fontWeight:"bold", opacity: precioCalculado<=0?0.5:1}}
                                    >
                                        🛒 AGREGAR AL CARRITO
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* =========================================
                COLUMNA DERECHA: CARRITO Y CHECKOUT
                ========================================= */}
            <div style={{background: "#fff", padding: 15, borderRadius: 8, border: "2px solid #52c41a"}}>
                <h3 style={{marginTop:0, borderBottom:"1px solid #eee", paddingBottom:10}}>🛒 Tu Pedido</h3>
                
                {/* Lista de Items */}
                <div style={{minHeight: 150, maxHeight: 300, overflowY: "auto", marginBottom: 15}}>
                    {carrito.length === 0 ? (
                        <p style={{color:"#999", textAlign:"center", marginTop: 50}}>El carrito está vacío.<br/>Selecciona productos de la izquierda.</p>
                    ) : (
                        carrito.map((item, index) => (
                            <div key={index} style={{display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px dashed #ccc"}}>
                                <div style={{flex: 1}}>
                                    <div style={{fontSize: 14, fontWeight: "bold"}}>{item.descripcion}</div>
                                    <div style={{fontSize: 12, color: "#666"}}>{item.cantidad} x ${item.precioUnitario}</div>
                                </div>
                                <div style={{fontWeight: "bold", marginLeft: 10}}>${item.precioTotal.toFixed(2)}</div>
                                <button onClick={() => eliminarDelCarrito(index)} style={{marginLeft: 15, background:"#ff4d4f", color:"white", border:"none", borderRadius:"50%", width:24, height:24, cursor:"pointer"}}>x</button>
                            </div>
                        ))
                    )}
                </div>

                {/* Totales */}
                <div style={{display:"flex", flexDirection:"column", gap: 5, padding: "10px 0", borderTop:"2px solid #333", borderBottom:"2px solid #333", marginBottom: 20}}>
                    <div style={{display:"flex", justifyContent:"space-between", fontSize: 14, color: "#666"}}>
                        <span>Subtotal (Neto):</span>
                        <span>${subtotalCarrito.toFixed(2)}</span>
                    </div>
                    <div style={{display:"flex", justifyContent:"space-between", fontSize: 14, color: "#666"}}>
                        <span>IVA (22%):</span>
                        <span>${ivaCarrito.toFixed(2)}</span>
                    </div>
                    <div style={{display:"flex", justifyContent:"space-between", fontSize: 18, fontWeight: "bold", marginTop: 5, paddingTop: 5, borderTop: "1px dashed #ccc"}}>
                        <span>TOTAL:</span>
                        <span>${totalConIva.toFixed(2)}</span>
                    </div>
                </div>

                {/* Formulario de Checkout */}
                <div style={{display:"flex", flexDirection:"column", gap:15}}>
                    <div>
                        <label style={{display:"block", marginBottom: 5, fontWeight:"bold"}}>🚚 Método de Entrega:</label>
                        <select 
                            value={metodoEntrega} 
                            onChange={(e) => setMetodoEntrega(e.target.value)}
                            style={{width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc"}}
                        >
                            <option value="Retiro Ruta 8">Retiro en Local - Ruta 8</option>
                            <option value="Retiro Isabela">Retiro en Local - Isabela</option>
                            <option value="Envio Agencia">Envío por Agencia</option>
                            <option value="Envio Camion">Envío con Camión Propio</option>
                        </select>
                    </div>

                    <div>
                        <label style={{display:"block", marginBottom: 5, fontWeight:"bold"}}>📝 Observaciones:</label>
                        <textarea 
                            value={observaciones}
                            onChange={(e) => setObservaciones(e.target.value)}
                            placeholder="Ej: Mandar los perfiles cortados a la mitad..."
                            style={{width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc", height: 60, resize: "none"}}
                        />
                    </div>

                    <button 
                        onClick={crearPedidoFinal} 
                        disabled={carrito.length === 0}
                        style={{padding: 15, background: carrito.length > 0 ? "#52c41a" : "#ccc", color:"white", border:"none", borderRadius:8, fontSize:16, fontWeight:"bold", cursor: carrito.length > 0 ? "pointer" : "not-allowed"}}
                    >
                        CONFIRMAR Y ENVIAR PEDIDO
                    </button>
                </div>
            </div>

        </div>
      )}

      {/* LOGS */}
      <div style={{ marginTop: 20, background: "#333", color: "#0f0", padding: 10, height: 100, overflowY: "auto", fontSize: 10, fontFamily: "monospace", borderRadius: 8 }}>
        {logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}