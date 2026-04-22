/**
 * PÁGINA TEMPORAL DE UTILIDAD — borrar cuando no se necesite más.
 * Ruta: /admin/reset-deposito
 *
 * Permite resetear todos los pedidos de un depósito al estado PENDIENTE_ASIGNAR.
 * Solo funciona para usuarios autenticados. La actualización pasa las reglas
 * de Firestore porque los pedidos ya tienen source == "finnegans".
 */

import { useState } from "react";
import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

const DEPOSITOS = ["ISABELA", "R8"];

export default function AdminResetDeposito() {
  const { user } = useAuth();
  const [deposito, setDeposito]   = useState("ISABELA");
  const [pedidos, setPedidos]           = useState(null);   // lista cargada
  const [despachados, setDespachados]   = useState(null);   // pedidos_despachados
  const [loading, setLoading]           = useState(false);
  const [resetting, setResetting]       = useState(false);
  const [resultado, setResultado]       = useState(null);
  const [confirmando, setConfirmando]   = useState(false);

  async function cargarPedidos() {
    setLoading(true);
    setResultado(null);
    setPedidos(null);
    setDespachados(null);
    try {
      const [snapPedidos, snapDesp] = await Promise.all([
        getDocs(query(collection(db, "pedidos"), where("deposito", "==", deposito))),
        getDocs(query(collection(db, "pedidos_despachados"), where("deposito", "==", deposito))),
      ]);
      setPedidos(snapPedidos.docs.map(d => ({ id: d.id, ...d.data() })));
      setDespachados(snapDesp.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      alert("Error al cargar: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function resetear() {
    if (!pedidos) return;
    setResetting(true);
    setResultado(null);
    try {
      let countReset = 0;
      let countDeleted = 0;

      // 1) Resetear pedidos en la colección `pedidos`
      const chunks = [];
      for (let i = 0; i < pedidos.length; i += 499) {
        chunks.push(pedidos.slice(i, i + 499));
      }
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        for (const p of chunk) {
          batch.update(doc(db, "pedidos", p.id), {
            estado: "PENDIENTE_ASIGNAR",
            operarioId: null,
            operarioNombre: null,
            errorDetalle: null,
            errorProductoCod: null,
            errorProductoNombre: null,
            errorProductos: null,
            updatedAt: serverTimestamp(),
          });
          countReset++;
        }
        await batch.commit();
      }

      // 2) Eliminar docs de `pedidos_despachados` del mismo depósito
      if (despachados && despachados.length > 0) {
        const dChunks = [];
        for (let i = 0; i < despachados.length; i += 499) {
          dChunks.push(despachados.slice(i, i + 499));
        }
        for (const chunk of dChunks) {
          const batch = writeBatch(db);
          for (const p of chunk) {
            batch.delete(doc(db, "pedidos_despachados", p.id));
            countDeleted++;
          }
          await batch.commit();
        }
      }

      setResultado({ ok: true, countReset, countDeleted });
      setPedidos(null);
      setDespachados(null);
      setConfirmando(false);
    } catch (e) {
      setResultado({ ok: false, error: e.message });
    } finally {
      setResetting(false);
    }
  }

  // Agrupar por estado para mostrar resumen
  const resumenEstados = pedidos
    ? pedidos.reduce((acc, p) => {
        const est = p.estado || "sin estado";
        acc[est] = (acc[est] || 0) + 1;
        return acc;
      }, {})
    : null;

  const noNecesitan = pedidos
    ? pedidos.filter(p => p.estado === "PENDIENTE_ASIGNAR").length
    : 0;
  const aNecesitan = pedidos ? pedidos.length - noNecesitan : 0;
  const totalDespachados = despachados ? despachados.length : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px" }}>
      <div style={{ width: "100%", maxWidth: "560px" }}>

        {/* Cabecera */}
        <div style={{ background: "#fef9c3", border: "1.5px solid #fde047", borderRadius: "14px", padding: "16px 20px", marginBottom: "24px" }}>
          <p style={{ margin: "0 0 4px", fontSize: "0.75rem", fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            🛠️ Utilidad temporal
          </p>
          <p style={{ margin: 0, fontSize: "0.88rem", color: "#78350f" }}>
            Resetea todos los pedidos de un depósito al estado <strong>PENDIENTE_ASIGNAR</strong>. También limpia operario asignado y campos de error. Usar solo para pruebas.
          </p>
        </div>

        {/* Selector de depósito */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "20px", marginBottom: "16px" }}>
          <p style={{ margin: "0 0 10px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Depósito
          </p>
          <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
            {DEPOSITOS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => { setDeposito(d); setPedidos(null); setResultado(null); setConfirmando(false); }}
                style={{
                  flex: 1, padding: "10px", borderRadius: "10px",
                  border: deposito === d ? "2px solid #0f172a" : "1.5px solid #e2e8f0",
                  background: deposito === d ? "#0f172a" : "#f8fafc",
                  color: deposito === d ? "#fff" : "#475569",
                  fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
                }}
              >
                {d}
              </button>
            ))}
          </div>

          <button
            onClick={cargarPedidos}
            disabled={loading}
            style={{
              width: "100%", padding: "12px", borderRadius: "10px",
              border: "none", background: "#3b82f6", color: "#fff",
              fontWeight: 700, fontSize: "0.95rem", cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Cargando…" : `Ver pedidos de ${deposito}`}
          </button>
        </div>

        {/* Pedidos despachados encontrados */}
        {despachados && despachados.length > 0 && (
          <div style={{ background: "#fff7ed", border: "1.5px solid #fed7aa", borderRadius: "14px", padding: "14px 20px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "1.1rem" }}>📦</span>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "#9a3412" }}>
              Se encontraron <strong>{despachados.length} pedido{despachados.length !== 1 ? "s" : ""} despachado{despachados.length !== 1 ? "s" : ""}</strong> en <code>pedidos_despachados</code> para {deposito}. Se eliminarán al resetear.
            </p>
          </div>
        )}

        {/* Resumen de pedidos cargados */}
        {pedidos && (
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "20px", marginBottom: "16px" }}>
            <p style={{ margin: "0 0 12px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {pedidos.length} pedidos en {deposito}
            </p>

            {/* Breakdown por estado */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
              {Object.entries(resumenEstados)
                .sort(([,a],[,b]) => b - a)
                .map(([estado, cant]) => (
                  <div key={estado} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: "8px", background: estado === "PENDIENTE_ASIGNAR" ? "#f0fdf4" : "#fff7ed", border: `1px solid ${estado === "PENDIENTE_ASIGNAR" ? "#86efac" : "#fed7aa"}` }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 600, color: estado === "PENDIENTE_ASIGNAR" ? "#15803d" : "#9a3412" }}>
                      {estado}
                    </span>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: estado === "PENDIENTE_ASIGNAR" ? "#15803d" : "#9a3412" }}>
                      {cant}
                    </span>
                  </div>
                ))}
            </div>

            {aNecesitan === 0 ? (
              <div style={{ textAlign: "center", padding: "12px", background: "#f0fdf4", borderRadius: "10px" }}>
                <p style={{ margin: 0, color: "#15803d", fontWeight: 600 }}>
                  ✅ Todos ya están en PENDIENTE_ASIGNAR
                </p>
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 12px", fontSize: "0.88rem", color: "#334155" }}>
                  Se van a resetear <strong>{aNecesitan} pedidos</strong> a PENDIENTE_ASIGNAR.
                  {noNecesitan > 0 && ` (${noNecesitan} ya están en ese estado y no cambian)`}
                  {totalDespachados > 0 && (
                    <span style={{ display: "block", marginTop: "6px", color: "#dc2626", fontWeight: 600 }}>
                      ⚠️ Además se van a eliminar <strong>{totalDespachados} pedidos despachados</strong> de la colección de historial.
                    </span>
                  )}
                </p>

                {!confirmando ? (
                  <button
                    onClick={() => setConfirmando(true)}
                    style={{
                      width: "100%", padding: "13px", borderRadius: "10px",
                      border: "none", background: "#dc2626", color: "#fff",
                      fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
                    }}
                  >
                    Resetear {aNecesitan} pedido{aNecesitan !== 1 ? "s" : ""}
                  </button>
                ) : (
                  <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: "10px", padding: "14px" }}>
                    <p style={{ margin: "0 0 12px", fontSize: "0.88rem", fontWeight: 600, color: "#991b1b", textAlign: "center" }}>
                      ⚠️ ¿Confirmás? Esta acción no se puede deshacer.
                    </p>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button
                        onClick={() => setConfirmando(false)}
                        style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1.5px solid #e2e8f0", background: "#f8fafc", color: "#475569", fontWeight: 600, cursor: "pointer" }}
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={resetear}
                        disabled={resetting}
                        style={{ flex: 2, padding: "10px", borderRadius: "8px", border: "none", background: "#dc2626", color: "#fff", fontWeight: 700, cursor: resetting ? "not-allowed" : "pointer", opacity: resetting ? 0.7 : 1 }}
                      >
                        {resetting ? "Reseteando…" : "Sí, resetear todo"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Resultado */}
        {resultado && (
          <div style={{
            background: resultado.ok ? "#f0fdf4" : "#fef2f2",
            border: `1.5px solid ${resultado.ok ? "#86efac" : "#fca5a5"}`,
            borderRadius: "14px", padding: "20px", textAlign: "center",
          }}>
            {resultado.ok ? (
              <>
                <p style={{ margin: "0 0 4px", fontSize: "1.5rem" }}>✅</p>
                <p style={{ margin: 0, fontWeight: 700, color: "#15803d" }}>
                  {resultado.countReset} pedidos reseteados correctamente
                </p>
                {resultado.countDeleted > 0 && (
                  <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "#15803d" }}>
                    + {resultado.countDeleted} pedidos despachados eliminados del historial
                  </p>
                )}
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 4px", fontSize: "1.5rem" }}>❌</p>
                <p style={{ margin: 0, fontWeight: 700, color: "#dc2626" }}>Error: {resultado.error}</p>
              </>
            )}
          </div>
        )}

        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "0.75rem", color: "#94a3b8" }}>
          Usuario: {user?.email || "—"} · <a href="/inicio" style={{ color: "#94a3b8" }}>Volver al inicio</a>
        </p>
      </div>
    </div>
  );
}
