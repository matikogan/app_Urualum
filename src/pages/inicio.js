import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { doc, writeBatch, collection, getDocs } from "firebase/firestore";
import { functions, db } from "../firebase";
import { useApp } from "../context/AppContext";

export default function Inicio() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [showMenuErrores, setShowMenuErrores] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingClientes, setIsSyncingClientes] = useState(false); // Estado para botón de clientes

  // 🔥 ESTADOS PARA EL BUSCADOR DE CLIENTES INTELIGENTE
  const { setClienteActivo, limpiarCarrito } = useApp();
  const [showBuscadorCliente, setShowBuscadorCliente] = useState(false);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [clientesLocales, setClientesLocales] = useState([]);
  
  const [limiteResultados, setLimiteResultados] = useState(5);

  const name = profile?.nombre || user?.displayName || user?.email?.split("@")[0] || "Usuario";
  const isVentas = profile?.rol === "ventas" || profile?.rol === "admin";
  const isEncargadoOOperario = profile?.rol === "encargado" || profile?.rol === "operario";
  const isAdmin = profile?.rol === "admin";

  // Depósito ISABELA → menú reducido (solo "Preparación de Pedidos")
  const isIsabela = String(profile?.deposito || "").toUpperCase() === "ISABELA";

  // ==========================================================
  // 🔥 LÓGICA DE SINCRONIZACIÓN DE CLIENTES (SOLO ADMIN)
  // ==========================================================
  // ==========================================================
  // 🔥 LÓGICA DE SINCRONIZACIÓN DE CLIENTES (SOLO ADMIN)
  // ==========================================================
  const handleSincronizarClientes = async () => {
    if (!window.confirm("¿Descargar clientes de Finnegans a Firebase?")) return;
    setIsSyncingClientes(true);
    try {
      const fn = httpsCallable(functions, "finnegansListarClientes");
      const res = await fn();
      const clientes = res.data?.clientes || [];

      if (clientes.length > 0) {
        let batch = writeBatch(db);
        let count = 0;

        for (let i = 0; i < clientes.length; i++) {
          const c = clientes[i];
          
          // 🔥 CORRECCIÓN: Buscamos la propiedad en todas sus formas posibles
          const codRaw = c.Codigo || c.codigo || c.Id || c.id || "";
          const codigo = String(codRaw).trim();
          
          // Si el código está vacío o es un error de lectura, lo salteamos
          if (!codigo || codigo === "undefined" || codigo === "null") continue;

          // Hacemos lo mismo con los nombres y RUT
          const nombreRaw = c.Nombre || c.nombre || c["Razon Social"] || c.razonSocial || "Sin Nombre";
          const rutRaw = c["Identificacion Tributaria Numero"] || c.rut || c.identificacionTributaria || "";

          const docRef = doc(db, "clientes", codigo);
          batch.set(docRef, {
            codigo: codigo,
            nombre: String(nombreRaw).trim(),
            rut: String(rutRaw).trim(),
            // 🔥 NUEVO: Guardamos la lista de precios por defecto
            listaPrecio: c.ListaPrecioDefaultCodigo || c.listaPrecioDefaultCodigo || "Sin Lista"
          });

          count++;
          if (count === 500) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
        alert(`✅ Se actualizaron ${count} clientes en tu base de datos.`);
      } else {
        alert("⚠️ No se encontraron clientes.");
      }
    } catch (error) {
      console.error(error);
      alert("❌ Error al sincronizar clientes.");
    } finally {
      setIsSyncingClientes(false);
    }
  };

  // ==========================================================
  // 🔥 LÓGICA DEL BUSCADOR EN VIVO (VENDEDOR)
  // ==========================================================
  const abrirBuscador = async () => {
      setShowBuscadorCliente(true);
      setBusquedaCliente("");
      setLimiteResultados(5);
      // Descargamos la lista rápida de Firebase a la memoria del celular
      const snap = await getDocs(collection(db, "clientes"));
      setClientesLocales(snap.docs.map(d => d.data()));
  };

  const seleccionarCliente = (cliente) => {
      setClienteActivo({
          finnegansClienteCodigo: cliente.codigo,
          nombre: cliente.nombre
      });
      limpiarCarrito(); 
      navigate("/catalogo"); 
  };

  // ==========================================================
  // 🔥 MOTOR DE BÚSQUEDA AVANZADO (Estilo Google)
  // ==========================================================
  // 1. Función auxiliar para quitar tildes y pasar todo a minúsculas
  const normalizarTexto = (texto) => {
      if (!texto) return "";
      return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  // 2. Filtramos la lista en vivo a medida que el vendedor escribe
  const clientesFiltrados = busquedaCliente.trim().length >= 2 
    ? clientesLocales.filter(c => {
        // Preparamos los datos del cliente quitando tildes y mayúsculas
        const nombreNorm = normalizarTexto(c.nombre);
        const codigoNorm = normalizarTexto(c.codigo);
        const rutNorm = normalizarTexto(c.rut);

        // Separamos lo que escribió el vendedor en "palabras clave" (tokens)
        const terminosBusqueda = normalizarTexto(busquedaCliente).trim().split(/\s+/);

        // El cliente es válido SÓLO SI contiene TODAS las palabras que escribió el vendedor
        return terminosBusqueda.every(termino => 
            nombreNorm.includes(termino) || 
            codigoNorm.includes(termino) ||
            rutNorm.includes(termino)
        );
      })
    : [];

  // ==========================================================
  // LÓGICA ORIGINAL DEL ARCHIVO
  // ==========================================================
  const handlePrepDespacho = () => {
    const role = profile?.rol;
    if (role === "ventas") { navigate("/ventas/pipeline"); return; }
    if (role === "operario") { navigate("/operario/asignados"); return; }
    navigate("/pedidos");
  };

  const handleSincronizarCatalogo = async () => {
    if (!window.confirm("¿Buscar productos nuevos en Finnegans? Solo se agregarán los que no existan en Firebase.")) return;
    
    setIsSyncing(true);
    try {
      console.log("⏳ [DEBUG] Paso 1: Intentando LEER el catálogo actual de Firebase...");
      
      const querySnapshot = await getDocs(collection(db, "catalogoProductos"));
      const codigosExistentes = new Set();
      querySnapshot.forEach((documento) => {
        codigosExistentes.add(documento.id);
        if (documento.data().codUru) codigosExistentes.add(documento.data().codUru);
      });
      console.log(`✅ [DEBUG] Paso 1 Listo. Lectura exitosa. Hay ${codigosExistentes.size} códigos en Firebase.`);

      console.log("⏳ [DEBUG] Paso 2: Solicitando productos a Finnegans...");
      const fn = httpsCallable(functions, "finnegansListarProductos");
      const res = await fn();
      const data = res.data;
      console.log("✅ [DEBUG] Paso 2 Listo. Respuesta de Finnegans recibida.");

      if (data?.ok && data.productos?.length > 0) {
        
        console.log("⏳ [DEBUG] Paso 3: Filtrando productos nuevos (9 dígitos, activos, no existentes)...");
        const productosNuevos = data.productos.filter(p => {
          const codigoStr = String(p.Codigo).trim();
          const esCodigoValido = /^\d{9}$/.test(codigoStr);
          if (!esCodigoValido) return false;

          const yaExiste = codigosExistentes.has(codigoStr);
          const estaInactivo = p._raw?.Activo === false || p._raw?.ACTIVO === "F" || p._raw?.Inactivo === true;
          
          return !yaExiste && !estaInactivo;
        });
        console.log(`✅ [DEBUG] Paso 3 Listo. Filtro terminado. Quedaron ${productosNuevos.length} productos para subir.`);

        if (productosNuevos.length === 0) {
          alert("✅ Tu catálogo está al día. No se encontraron productos nuevos en Finnegans.");
          setIsSyncing(false);
          return;
        }

        console.log("⏳ [DEBUG] Paso 4: Armando y enviando lotes a Firebase...");
        let batch = writeBatch(db);
        let count = 0;

        for (let i = 0; i < productosNuevos.length; i++) {
          const p = productosNuevos[i];
          const docRef = doc(db, "catalogoProductos", String(p.Codigo));

          // Buscamos si Finnegans lo marcó como Kit en la data cruda
          const esUnKitDeFinnegans = p._raw?.EsKit === true || p._raw?.esKit === true || p._raw?.ESKIT === "T";
          
          batch.set(docRef, {
            codUru: String(p.Codigo),
            customerNo: p.Nombre,
            esKitFinnegans: esUnKitDeFinnegans
          });

          count++;
          
          if (count === 500) {
            console.log("⏳ [DEBUG] Enviando un paquete de 500 productos...");
            await batch.commit(); 
            console.log("✅ [DEBUG] Paquete de 500 guardado con éxito.");
            batch = writeBatch(db);
            count = 0;
          }
        }
        
        if (count > 0) {
          console.log(`⏳ [DEBUG] Enviando paquete final con ${count} productos...`);
          await batch.commit(); 
          console.log("✅ [DEBUG] Paquete final guardado con éxito.");
        }
        
        alert(`✅ ¡Sincronización completa! Se agregaron ${productosNuevos.length} productos nuevos.`);
      } else {
        alert("⚠️ No se pudieron descargar los productos de Finnegans.");
      }
    } catch (error) {
      console.error("❌ [DEBUG] ERROR FATAL. La ejecución se cortó acá:", error);
      alert("❌ Ocurrió un error de permisos. Revisá la consola.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="container" style={{ height: '100vh', overflow: 'hidden' }}>
      <div className="screen-full-height">
        <div style={{ marginBottom: '2vh', textAlign: 'center' }}>
          <h1 className="h1" style={{ margin: 0 }}>Bienvenido,</h1>
          <h2 className="h2" style={{ margin: 0, fontWeight: "400" }}>{name}</h2>
        </div>

        <div className="menu-buttons-adaptive">
          {/* ── Menú reducido para depósito ISABELA ── */}
          {isIsabela ? (
            <button
              className="btn btn-big-adaptive btn--elevated"
              onClick={handlePrepDespacho}
              style={{ backgroundColor: 'var(--brand)', color: 'white', border: 'none' }}
            >
              <span className="btn-icon">🚚</span>
              Preparación de Pedidos
            </button>
          ) : (
            <>
              {isVentas && (
                <>
                  <button
                    className="btn btn-big-adaptive btn--elevated"
                    onClick={abrirBuscador}
                    style={{ backgroundColor: 'var(--brand)', color: 'white', border: 'none' }}
                  >
                    <span className="btn-icon">📝</span>
                    Crear Presupuesto / Pedido
                  </button>

                  <button
                    className="btn btn--outline btn-big-adaptive btn--elevated"
                    onClick={() => navigate("/ventas/pedidos-web")}
                  >
                    <span className="btn-icon">🛒</span>
                    Pedidos Web (Clientes)
                  </button>

                  <button
                    className="btn btn--outline btn-big-adaptive btn--elevated"
                    onClick={() => setShowMenuErrores(true)}
                  >
                    <span className="btn-icon">🛑</span>
                    Carga Errores
                  </button>
                </>
              )}

              <button
                className="btn btn--outline btn-big-adaptive btn--elevated"
                onClick={handlePrepDespacho}
              >
                <span className="btn-icon">{isEncargadoOOperario ? "📦" : "🚚"}</span>
                {isEncargadoOOperario ? "Gestión de Pedidos" : "Preparación de Pedidos"}
              </button>
            </>
          )}

          {profile?.rol === "encargado" && (
            <button
              className="btn btn--outline btn-big-adaptive btn--elevated"
              onClick={() => navigate("/encargado/control-carga")}
            >
              <span className="btn-icon">🚛</span>
              Control de Carga (Agencias)
            </button>
          )}

          {profile?.rol === "encargado" && (
            <button
              className="btn btn--outline btn-big-adaptive btn--elevated"
              onClick={() => navigate("/encargado/camiones")}
            >
              <span className="btn-icon">🚚</span>
              Camiones (Interior)
            </button>
          )}

          {isAdmin && (
            <>
              <button
                className="btn btn--outline btn-big-adaptive btn--elevated"
                onClick={() => navigate("/admin/panel")}
                style={{ borderColor: '#6366f1', color: '#4f46e5' }}
              >
                <span className="btn-icon">⚙️</span>
                Panel de administración
              </button>

              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button
                  className="btn btn-big-adaptive btn--elevated"
                  onClick={handleSincronizarCatalogo} disabled={isSyncing}
                  style={{ backgroundColor: isSyncing ? '#ccc' : '#f97316', color: '#fff', border: 'none', flex: 1 }}
                >
                  <span className="btn-icon">{isSyncing ? "⏳" : "➕"}</span>
                  Productos
                </button>

                <button
                  className="btn btn-big-adaptive btn--elevated"
                  onClick={handleSincronizarClientes} disabled={isSyncingClientes}
                  style={{ backgroundColor: isSyncingClientes ? '#ccc' : '#2563eb', color: '#fff', border: 'none', flex: 1 }}
                >
                  <span className="btn-icon">{isSyncingClientes ? "⏳" : "👥"}</span>
                  Clientes
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showMenuErrores && (
        <div className="modal-backdrop" onClick={() => setShowMenuErrores(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">¿Qué querés cargar?</h3>

            <button className="btn btn--outline btn-big btn--elevated" onClick={() => { setShowMenuErrores(false); navigate("/errores/nuevo"); }}>
              <span className="btn-icon">🛑</span> Cargar error
            </button>
            <button className="btn btn--outline btn-big btn--elevated" onClick={() => { setShowMenuErrores(false); navigate("/actitud/nuevo"); }}>
              <span className="btn-icon">✅</span> Actitud / Desempeño
            </button>
            <button className="btn btn--outline btn-big btn--elevated" onClick={() => { setShowMenuErrores(false); navigate("/reporte/semanal"); }}>
              <span className="btn-icon">📊</span> Reporte semanal
            </button>
            <button className="btn btn--ghost" onClick={() => setShowMenuErrores(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {/* 🔥 NUEVO MODAL BUSCADOR DE CLIENTES */}
      {/* 🔥 NUEVO MODAL BUSCADOR DE CLIENTES (CON PAGINACIÓN VISUAL) */}
      {showBuscadorCliente && (
        <div className="modal-backdrop" onClick={() => setShowBuscadorCliente(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minHeight: '60vh', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <h3 className="modal-title">Iniciar Nuevo Pedido</h3>
            <p className="muted" style={{marginBottom: '15px'}}>Buscá por nombre o código Finnegans.</p>
            
            <input 
                type="text" 
                className="input" 
                placeholder="Ej: Avila o 2154..." 
                value={busquedaCliente}
                onChange={(e) => {
                    setBusquedaCliente(e.target.value);
                    setLimiteResultados(5); // Reseteamos al escribir algo nuevo
                }}
                autoFocus
            />
            
            <div style={{ flex: 1, overflowY: 'auto', marginTop: '15px', border: '1px solid #eee', borderRadius: '8px' }}>
                {busquedaCliente.length < 2 ? (
                    <p style={{ padding: '20px', textAlign: 'center', color: '#999' }}>Escribí al menos 2 letras...</p>
                ) : clientesFiltrados.length === 0 ? (
                    <p style={{ padding: '20px', textAlign: 'center', color: '#999' }}>No se encontraron clientes.</p>
                ) : (
                    <>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {/* 🔥 Cortamos la lista usando el límite */}
                            {clientesFiltrados.slice(0, limiteResultados).map(cliente => (
                                <li 
                                    key={cliente.codigo}
                                    onClick={() => seleccionarCliente(cliente)}
                                    style={{ padding: '12px 15px', borderBottom: '1px solid #eee', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                                >
                                    <span style={{ fontWeight: 'bold', color: 'var(--brand)' }}>{cliente.nombre}</span>
                                    <span style={{ fontSize: '12px', color: '#666' }}>Cód: {cliente.codigo} {cliente.rut && `| RUT: ${cliente.rut}`}</span>
                                </li>
                            ))}
                        </ul>
                        
                        {/* 🔥 Botón de "Cargar más" si quedaron clientes afuera */}
                        {clientesFiltrados.length > limiteResultados && (
                            <div style={{ padding: '10px', textAlign: 'center', backgroundColor: '#f8fafc' }}>
                                <button 
                                    className="btn btn--ghost btn-sm"
                                    onClick={() => setLimiteResultados(prev => prev + 5)}
                                    style={{ width: '100%', fontSize: '13px', color: 'var(--brand)' }}
                                >
                                    ⬇️ Cargar más resultados ({clientesFiltrados.length - limiteResultados} ocultos)
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            <div style={{ marginTop: '20px' }}>
                <button className="btn btn--ghost btn--full" onClick={() => setShowBuscadorCliente(false)}>
                    Cancelar
                </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}