// src/pages/recepciones.js
import React, { useEffect, useState } from "react";
import { db } from "firebase.js";
import {
  collection, onSnapshot, query, orderBy, updateDoc, doc, serverTimestamp
} from "firebase/firestore";
import { getFinnegansToken, postRecepcionCompra } from "API/finnegans";

export default function Recepciones() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState(null);
  const [filter, setFilter] = useState("all"); // all | error | ok | pending

  useEffect(() => {
    const q = query(
      collection(db, "recepciones_completas"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRows(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const reintentar = async (row) => {
    const sentPayload =
      row.finnegan?.sentPayload || row.finnegans?.sentPayload || null;
    const payload = sentPayload || {
      // Fallback: si no guardaste el payload, lo reconstruís con lo mínimo
      empresa: "empre01",
      documento: "Recepción de Compra Importación",
      factura: {
        nro: row.factura?.nroFactura,
        comprobante: row.factura?.comprobante,
        proveedor: row.factura?.proveedor,
        fecha: row.factura?.fecha,
      },
      items: (row.productos || []).map(p => ({
        producto: p.codigo,
        bundles: p.escaneados,
      })),
      meta: { origen: "URUALUM-WEB/RETRY", generadoEn: new Date().toISOString() },
    };

    try {
      setSendingId(row.id);
      const token = await getFinnegansToken();
      const resp  = await postRecepcionCompra(token, payload);

      await updateDoc(doc(db, "recepciones_completas", row.id), {
        finnegans: {
          status: "ok",
          response: resp,
          sentPayload: payload,
          updatedAt: serverTimestamp(),
        },
      });
      alert("✅ Reintento exitoso.");
    } catch (err) {
      await updateDoc(doc(db, "recepciones_completas", row.id), {
        finnegans: {
          status: "error",
          error: err?.message || "Error desconocido",
          response: err?.response || null,
          sentPayload: payload,
          updatedAt: serverTimestamp(),
        },
      });
      alert("❌ Falló el reintento. Revisá el doc en Firestore.");
    } finally {
      setSendingId(null);
    }
  };

  const filtered = rows.filter(r => {
    const st = r.finnegans?.status || "pending";
    if (filter === "all") return true;
    return st === filter;
  });

  if (loading) return <p>Cargando…</p>;

  return (
    <div style={{ padding: 20 }}>
      <h2>Recepciones</h2>

      <div style={{ marginBottom: 12 }}>
        <label>Filtro:&nbsp;</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Todas</option>
          <option value="pending">Pendientes</option>
          <option value="error">Con error</option>
          <option value="ok">OK</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p>Sin registros para el filtro.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {filtered.map((r) => {
            const st = r.finnegans?.status || "pending";
            return (
              <li key={r.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 10 }}>
                <div><strong>Factura:</strong> {r.factura?.nroFactura} — {r.factura?.proveedor}</div>
                <div><strong>Fecha:</strong> {r.factura?.fecha}</div>
                <div>
                  <strong>Estado Finnegans:</strong>{" "}
                  {st === "ok" ? "✅ OK" : st === "error" ? "❌ Error" : "🕒 Pendiente"}
                </div>
                {st === "error" && (
                  <details style={{ marginTop: 6 }}>
                    <summary>Ver error / payload</summary>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(r.finnegans, null, 2)}
                    </pre>
                  </details>
                )}
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  {st !== "ok" && (
                    <button onClick={() => reintentar(r)} disabled={sendingId === r.id}>
                      {sendingId === r.id ? "Reintentando…" : "Reintentar envío"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
