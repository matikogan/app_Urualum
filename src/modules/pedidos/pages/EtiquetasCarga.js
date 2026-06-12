// src/modules/pedidos/pages/EtiquetasCarga.js
//
// Paso 2 del módulo "Etiquetas": para cada pedido seleccionado, el
// encargado confirma los datos del cliente y la cantidad de bultos.
// Al finalizar, se genera el PDF con las etiquetas (cliente + Urualum)
// y se manda a imprimir.

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getDireccionCliente, saveDireccionCliente, fetchDireccionClienteFinnegans, buscarCodigoClientePorNombre, agregarItemsACarga } from "../services/etiquetasFS";
import { generarEImprimirEtiquetas } from "../services/etiquetasPDF";

export default function EtiquetasCarga() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const pedidosSeleccionados = state?.items || [];
  const carga = state?.carga || null;

  const [items, setItems] = useState(null);
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    if (pedidosSeleccionados.length === 0 || !carga?.id) {
      navigate("/encargado/etiquetas", { replace: true });
      return;
    }

    (async () => {
      const loaded = [];
      for (const p of pedidosSeleccionados) {
        try {
          // 1) Preferimos el domicilio guardado (ya confirmado/editado antes)
          const guardada = await getDireccionCliente(p.clienteCodigo);
          // 2) Si no hay nada guardado, intentamos traerlo directo de Finnegans.
          //    El reporte solo trae el RUT/CI del cliente (no el Código interno),
          //    así que primero probamos con ese valor (a veces coincide)...
          let finnegans = (!guardada?.direccion && !guardada?.localidad)
            ? await fetchDireccionClienteFinnegans(p.clienteCodigo)
            : null;

          // ...y si no, resolvemos el Código interno real buscando por nombre
          // en el listado de clientes de Finnegans y reintentamos con ese código.
          if (!finnegans && !guardada?.direccion && !guardada?.localidad && p.cliente) {
            const codigoReal = await buscarCodigoClientePorNombre(p.cliente);
            if (codigoReal && codigoReal !== p.clienteCodigo) {
              finnegans = await fetchDireccionClienteFinnegans(codigoReal);
            }
          }

          loaded.push({
            pedidoId: p.id,
            numero: p.numero || p.id,
            cliente: p.cliente || "",
            clienteCodigo: p.clienteCodigo || null,
            direccion: guardada?.direccion || finnegans?.direccion || "",
            localidad: guardada?.localidad || finnegans?.localidad || "",
            bultos: 1,
          });
        } catch (e) {
          console.warn("[EtiquetasCarga] error cargando pedido", p.id, e);
        }
      }
      setItems(loaded);
    })();
  }, [pedidosSeleccionados, carga, navigate]);

  function actualizar(idx, campo, valor) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)));
  }

  async function imprimir() {
    // Validar que todos tengan dirección/localidad y bultos válidos
    for (const it of items) {
      if (!it.direccion.trim() || !it.localidad.trim()) {
        alert(`Falta dirección/localidad para el pedido #${it.numero}`);
        return;
      }
      if (!it.bultos || Number(it.bultos) < 1) {
        alert(`La cantidad de bultos del pedido #${it.numero} debe ser al menos 1`);
        return;
      }
    }

    setGenerando(true);
    try {
      // Guardar dirección para próxima vez (si falla, no bloquea la impresión)
      for (const it of items) {
        try {
          await saveDireccionCliente(it.clienteCodigo, { direccion: it.direccion, localidad: it.localidad });
        } catch (e) {
          console.warn("[EtiquetasCarga] no se pudo guardar dirección de cliente", it.clienteCodigo, e);
        }
      }
      await generarEImprimirEtiquetas(items);
      await agregarItemsACarga(carga.id, items);
      navigate("/encargado/etiquetas/control", { replace: true, state: { cargaId: carga.id } });
    } catch (e) {
      console.error("[EtiquetasCarga] error generando etiquetas", e);
      alert("Ocurrió un error generando las etiquetas: " + (e.message || e));
    } finally {
      setGenerando(false);
    }
  }

  if (items === null) {
    return <div style={{ padding: "16px" }}>Cargando pedidos…</div>;
  }

  return (
    <div style={{ padding: "16px", maxWidth: "640px", margin: "0 auto" }}>
      <button
        onClick={() => navigate(-1)}
        style={{
          background: "none",
          border: "none",
          color: "#15803d",
          fontWeight: 600,
          fontSize: "0.85rem",
          padding: 0,
          marginBottom: "12px",
          cursor: "pointer",
        }}
      >
        ← Volver
      </button>
      <h2 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>🏷️ Etiquetas — Confirmar datos</h2>
      {carga?.nombre && (
        <p style={{ margin: "0 0 4px", fontSize: "0.85rem", fontWeight: 700, color: "#15803d" }}>
          📦 {carga.nombre}
        </p>
      )}
      <p style={{ margin: "0 0 16px", fontSize: "0.85rem", color: "#64748b" }}>
        Confirmá la dirección, localidad y cantidad de bultos de cada pedido.
        Se va a imprimir una etiqueta de cliente y una de Urualum por cada bulto.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {items.map((it, idx) => (
          <div
            key={it.pedidoId}
            style={{ border: "1.5px solid #e2e8f0", borderRadius: "10px", padding: "12px 14px" }}
          >
            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a", marginBottom: "8px" }}>
              #{it.numero} — {it.cliente}
            </div>

            <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: "2px" }}>
              Dirección
            </label>
            <input
              type="text"
              value={it.direccion}
              onChange={(e) => actualizar(idx, "direccion", e.target.value)}
              style={inputStyle}
              placeholder="Av. Siempre Viva 1234"
            />

            <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: "2px", marginTop: "8px" }}>
              Localidad - Departamento
            </label>
            <input
              type="text"
              value={it.localidad}
              onChange={(e) => actualizar(idx, "localidad", e.target.value)}
              style={inputStyle}
              placeholder="Maldonado - Maldonado"
            />

            <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: "2px", marginTop: "8px" }}>
              Cantidad de bultos
            </label>
            <input
              type="number"
              min="1"
              value={it.bultos}
              onChange={(e) => actualizar(idx, "bultos", e.target.value)}
              style={{ ...inputStyle, maxWidth: "100px" }}
            />
          </div>
        ))}
      </div>

      <div style={{ position: "sticky", bottom: 0, paddingTop: "16px", background: "#fff" }}>
        <button
          onClick={imprimir}
          disabled={generando}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "10px",
            border: "none",
            background: generando ? "#cbd5e1" : "#15803d",
            color: "#fff",
            fontWeight: 700,
            fontSize: "0.95rem",
            cursor: generando ? "default" : "pointer",
          }}
        >
          {generando ? "Generando…" : "Generar e imprimir etiquetas"}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1.5px solid #e2e8f0",
  fontSize: "0.88rem",
  boxSizing: "border-box",
};
