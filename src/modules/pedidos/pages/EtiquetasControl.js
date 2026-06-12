// src/modules/pedidos/pages/EtiquetasControl.js
//
// Paso 3 del módulo "Etiquetas": control de carga al camión.
// El encargado escanea el QR de cada bulto (impreso en la etiqueta de
// Urualum) y la app va marcando qué bultos de qué pedidos ya se cargaron,
// para detectar si falta alguno antes de salir.
//
// La carga (nombre, pedidos, bultos y progreso de escaneo) se guarda en
// Firestore (`cargasEtiquetas`), así se puede salir y volver a entrar
// más tarde, o agregar más pedidos a la misma carga después.
// No se toca la colección `pedidos` ni sus estados.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import QrScanner from "../../../components/QrScanner";
import { listarCargas, getCarga, actualizarEscaneadosCarga, marcarCargaCompleta } from "../services/etiquetasFS";

export default function EtiquetasControl() {
  const { state } = useLocation();
  const navigate = useNavigate();

  const [carga, setCarga] = useState(null); // { id, nombre, items, escaneados }
  const [cargasAbiertas, setCargasAbiertas] = useState(null); // null = cargando, [] = ninguna
  const [escaneados, setEscaneados] = useState(new Set());
  const [ultimoMensaje, setUltimoMensaje] = useState(null);
  const [mostrarScanner, setMostrarScanner] = useState(false);

  // Cargar la carga indicada, o listar cargas abiertas para elegir.
  useEffect(() => {
    let cancelado = false;
    const cargaId = state?.cargaId;

    if (cargaId) {
      getCarga(cargaId).then((c) => {
        if (cancelado) return;
        if (!c) {
          navigate("/encargado/etiquetas", { replace: true });
          return;
        }
        setCarga(c);
        setEscaneados(new Set(c.escaneados || []));
      });
      return () => { cancelado = true; };
    }

    // Sin cargaId: listar cargas abiertas para elegir
    listarCargas().then((items) => {
      if (cancelado) return;
      const abiertas = items.filter((c) => !c.completa);
      if (abiertas.length === 1) {
        setCarga(abiertas[0]);
        setEscaneados(new Set(abiertas[0].escaneados || []));
      } else {
        setCargasAbiertas(abiertas);
      }
    });
    return () => { cancelado = true; };
  }, [state, navigate]);

  // Persistir progreso en Firestore
  useEffect(() => {
    if (!carga?.id) return;
    actualizarEscaneadosCarga(carga.id, escaneados).catch((e) =>
      console.warn("[EtiquetasControl] no se pudo guardar progreso", e)
    );
  }, [carga?.id, escaneados]);

  const items = carga?.items || [];

  // Lista esperada de bultos: "pedidoId|b/total" → datos para mostrar
  const bultosEsperados = useMemo(() => {
    const out = [];
    for (const it of items) {
      const bultos = Math.max(1, Number(it.bultos) || 1);
      for (let b = 1; b <= bultos; b++) {
        out.push({ key: `${it.pedidoId}|${b}/${bultos}`, pedidoId: it.pedidoId, numero: it.numero, cliente: it.cliente, bulto: b, total: bultos });
      }
    }
    return out;
  }, [items]);

  const totalBultos = bultosEsperados.length;
  const totalEscaneados = escaneados.size;
  const completo = totalBultos > 0 && totalEscaneados === totalBultos;

  function handleScan(payload) {
    const codigo = typeof payload === "string" ? payload.trim() : String(payload || "").trim();
    const match = bultosEsperados.find((b) => b.key === codigo);

    if (!match) {
      setUltimoMensaje({ tipo: "error", texto: `QR no pertenece a esta carga: "${codigo}"` });
      return;
    }
    if (escaneados.has(codigo)) {
      setUltimoMensaje({ tipo: "warn", texto: `Ya estaba cargado: #${match.numero} — Bulto ${match.bulto}/${match.total}` });
      return;
    }
    setEscaneados((prev) => new Set(prev).add(codigo));
    setUltimoMensaje({ tipo: "ok", texto: `✓ Cargado: #${match.numero} — ${match.cliente} — Bulto ${match.bulto}/${match.total}` });
  }

  function reiniciar() {
    if (!window.confirm("¿Reiniciar el control de carga? Se perderá lo escaneado.")) return;
    setEscaneados(new Set());
  }

  async function finalizar() {
    if (completo) {
      await marcarCargaCompleta(carga.id, true).catch(() => {});
    }
    navigate("/encargado/etiquetas", { replace: true });
  }

  function agregarPedidos() {
    navigate("/encargado/etiquetas", { state: { abrirCarga: { id: carga.id, nombre: carga.nombre, items: carga.items } } });
  }

  // Sin carga elegida: mostrar selector de cargas abiertas
  if (!carga) {
    if (cargasAbiertas === null) {
      return <div style={{ padding: "16px" }}>Cargando…</div>;
    }
    return (
      <div style={{ padding: "16px", maxWidth: "640px", margin: "0 auto" }}>
        <button onClick={() => navigate(-1)} style={volverStyle}>← Volver</button>
        <h2 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>📦 Control de carga</h2>
        {cargasAbiertas.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>No hay cargas en curso. Creá una desde "Etiquetas".</p>
        ) : (
          <>
            <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "#64748b" }}>Elegí la carga a controlar:</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {cargasAbiertas.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setCarga(c); setEscaneados(new Set(c.escaneados || [])); }}
                  style={{ ...botonPrincipal("#15803d"), textAlign: "left" }}
                >
                  📦 {c.nombre} — {(c.items || []).length} pedido(s)
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px", maxWidth: "640px", margin: "0 auto" }}>
      <button onClick={() => navigate(-1)} style={volverStyle}>← Volver</button>

      <h2 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>📦 Control de carga</h2>
      <p style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 700, color: "#15803d" }}>{carga.nombre}</p>
      <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "#64748b" }}>
        Escaneá el QR de cada bulto al subirlo al camión. Se van a marcar en verde
        a medida que los vayas cargando.
      </p>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderRadius: "10px", marginBottom: "12px",
        background: completo ? "#f0fdf4" : "#f1f5f9",
        border: `1.5px solid ${completo ? "#86efac" : "#e2e8f0"}`,
      }}>
        <span style={{ fontWeight: 700, fontSize: "0.95rem", color: completo ? "#15803d" : "#0f172a" }}>
          {completo ? "✅ Carga completa" : `Cargados: ${totalEscaneados} / ${totalBultos}`}
        </span>
        <button onClick={reiniciar} style={{ background: "none", border: "none", color: "#b91c1c", fontSize: "0.8rem", cursor: "pointer" }}>
          Reiniciar
        </button>
      </div>

      {!mostrarScanner ? (
        <button onClick={() => setMostrarScanner(true)} style={botonPrincipal("#15803d")}>
          📷 Escanear QR
        </button>
      ) : (
        <div style={{ marginBottom: "12px" }}>
          <QrScanner onScanSuccess={handleScan} />
          <button onClick={() => setMostrarScanner(false)} style={{ ...botonPrincipal("#64748b"), marginTop: "8px" }}>
            Cerrar cámara
          </button>
        </div>
      )}

      {ultimoMensaje && (
        <div style={{
          padding: "8px 12px", borderRadius: "8px", marginBottom: "12px", fontSize: "0.85rem",
          background: ultimoMensaje.tipo === "ok" ? "#f0fdf4" : ultimoMensaje.tipo === "warn" ? "#fffbeb" : "#fef2f2",
          color: ultimoMensaje.tipo === "ok" ? "#15803d" : ultimoMensaje.tipo === "warn" ? "#b45309" : "#b91c1c",
          border: `1.5px solid ${ultimoMensaje.tipo === "ok" ? "#86efac" : ultimoMensaje.tipo === "warn" ? "#fde68a" : "#fecaca"}`,
        }}>
          {ultimoMensaje.texto}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {items.map((it) => {
          const bultos = Math.max(1, Number(it.bultos) || 1);
          return (
            <div key={it.pedidoId} style={{ border: "1.5px solid #e2e8f0", borderRadius: "10px", padding: "10px 14px" }}>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a", marginBottom: "6px" }}>
                #{it.numero} — {it.cliente}
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {Array.from({ length: bultos }, (_, i) => i + 1).map((b) => {
                  const key = `${it.pedidoId}|${b}/${bultos}`;
                  const ok = escaneados.has(key);
                  return (
                    <span key={key} style={{
                      display: "inline-flex", alignItems: "center", gap: "4px",
                      padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600,
                      background: ok ? "#dcfce7" : "#f1f5f9",
                      color: ok ? "#15803d" : "#64748b",
                      border: `1px solid ${ok ? "#86efac" : "#e2e8f0"}`,
                    }}>
                      {ok ? "✓" : "—"} Bulto {b}/{bultos}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ position: "sticky", bottom: 0, paddingTop: "16px", background: "#fff", display: "flex", flexDirection: "column", gap: "8px" }}>
        <button onClick={agregarPedidos} style={botonPrincipal("#64748b")}>
          + Agregar pedidos a esta carga
        </button>
        <button onClick={finalizar} style={botonPrincipal(completo ? "#15803d" : "#cbd5e1")}>
          {completo ? "Finalizar carga" : "Salir (carga incompleta)"}
        </button>
      </div>
    </div>
  );
}

const volverStyle = {
  background: "none", border: "none", color: "#15803d", fontWeight: 600,
  fontSize: "0.85rem", padding: 0, marginBottom: "12px", cursor: "pointer",
};

function botonPrincipal(bg) {
  return {
    width: "100%", padding: "12px", borderRadius: "10px", border: "none",
    background: bg, color: "#fff", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
  };
}
