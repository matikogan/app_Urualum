// src/pages/despacho.js
import React, { useContext, useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { AppContext } from "context/AppContext";
import QrScanner from "components/QrScanner";

export default function Despacho() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    pedidoSeleccionado,
    consumirTirasDelStock,
    tirasManual,
    tirasSueltasStock,
    agregarTirasAlStockVirtual,
    agregarTirasSueltas,
  } = useContext(AppContext);

  const productoFoco = location.state?.productoCodigo;
  const cantidadFoco = location.state?.cantidadPendiente;

  const [manualInputs, setManualInputs] = useState({});

  useEffect(() => {
    if (!pedidoSeleccionado || pedidoSeleccionado.id !== id) return;
    setManualInputs({});
  }, [id, pedidoSeleccionado]);

  if (!pedidoSeleccionado || pedidoSeleccionado.id !== id) {
    return <p>Cargando pedido para preparación…</p>;
  }

  const handleAddTiras = (codigo) => {
    const val = parseInt(manualInputs[codigo], 10);
    const stockDisponible = (tirasSueltasStock[codigo] || []).reduce((acc, lote) => acc + lote.cantidad, 0);
    const pedidas = pedidoSeleccionado.items.find(i => i.productoCodigo === codigo)?.cantidadPendiente || 0;
    const yaPreparadas = tirasManual[codigo] || 0;
    const restantes = pedidas - yaPreparadas;

    if (!val || val <= 0 || val > stockDisponible || val > restantes) {
      alert(`⚠️ No podés usar más de ${Math.min(stockDisponible, restantes)} tiras.`);
      return;
    }

    agregarTirasSueltas(codigo, val);
    consumirTirasDelStock(codigo, val);
    setManualInputs((prev) => ({ ...prev, [codigo]: "" }));
  };

  const listo = pedidoSeleccionado.items.every((item) => {
    const preparadas = tirasManual[item.productoCodigo] || 0;
    return preparadas >= item.cantidadPendiente;
  });

  return (
    <div style={{ padding: 20 }}>
      <h2>Preparación de Pedido {id}</h2>

      <div style={{ marginBottom: 20, width: "100%", maxWidth: 400 }}>
        <QrScanner
          onScanSuccess={(data) => {
            const cantidadTotal = parseInt(data.cantidad, 10);
            if (!cantidadTotal || cantidadTotal <= 0) {
              alert("❌ El paquete no tiene una cantidad válida.");
              return;
            }

            const pedidas = pedidoSeleccionado.items.find(i => i.productoCodigo === data.codigo_urualum)?.cantidadPendiente || 0;
            const yaPreparadas = tirasManual[data.codigo_urualum] || 0;
            const faltanEntregar = pedidas - yaPreparadas;

            if (faltanEntregar <= 0) {
              alert("⚠️ Ya se completó la cantidad requerida de este producto.");
              return;
            }

            const maxPermitido = Math.min(cantidadTotal, faltanEntregar);

            const cantidadUsada = parseInt(prompt(
              `📦 El paquete tiene ${cantidadTotal} tiras.\n📦 El pedido requiere: ${faltanEntregar}\n\n¿Cuántas querés usar? (Máximo permitido: ${maxPermitido})`
            ), 10);

            if (!cantidadUsada || cantidadUsada < 1 || cantidadUsada > maxPermitido) {
              alert(`⚠️ Cantidad inválida. Debe ser entre 1 y ${maxPermitido}`);
              return;
            }

            agregarTirasSueltas(data.codigo_urualum, cantidadUsada);

            const remanenteFinal = cantidadTotal - cantidadUsada;
            if (remanenteFinal > 0) {
              agregarTirasAlStockVirtual(data.codigo_urualum, remanenteFinal, data.nro_paquete);
            }

            alert(`✅ Se usaron ${cantidadUsada} tiras. ${remanenteFinal > 0 ? `Se guardaron ${remanenteFinal} como sueltas.` : ''}`);
          }}
        />
      </div>

      <h3>Resumen por producto:</h3>
      {pedidoSeleccionado.items.map((item) => {
        const codigo = item.productoCodigo;
        const pedidas = item.cantidadPendiente;
        const preparadas = tirasManual[codigo] || 0;
        const stockVirtual = (tirasSueltasStock[codigo] || []).reduce((acc, lote) => acc + lote.cantidad, 0);

        return (
          <div key={codigo} style={{ marginBottom: 12 }}>
            <strong>{codigo}</strong> &nbsp;|&nbsp;
            Pedidas: {pedidas} &nbsp;|&nbsp;
            Preparado: {preparadas} &nbsp;|&nbsp;
            Pendiente: {pedidas - preparadas} &nbsp;|&nbsp;
            <span style={{ color: stockVirtual > 0 ? 'green' : 'gray' }}>
              Tiras sueltas disponibles: {stockVirtual}
            </span>
          </div>
        );
      })}

      <h3>Agregar tiras sueltas:</h3>
      {pedidoSeleccionado.items.map((item) => {
        const codigo = item.productoCodigo;
        const stockVirtual = (tirasSueltasStock[codigo] || []).reduce((acc, lote) => acc + lote.cantidad, 0);
        const yaPreparadas = tirasManual[codigo] || 0;
        const maxPermitido = Math.min(item.cantidadPendiente - yaPreparadas, stockVirtual);

        return (
          <div key={codigo} style={{ marginBottom: 12, display: 'flex', alignItems: 'center' }}>
            <span style={{ flex: 1 }}>
              {codigo} &nbsp;
              <span style={{ color: 'gray' }}>
                (Stock: {stockVirtual}, Máx: {maxPermitido})
              </span>
            </span>
            <input
              type="number"
              min="1"
              max={maxPermitido}
              placeholder="Cantidad"
              style={{ width: 80, marginRight: 8 }}
              value={manualInputs[codigo] || ''}
              onChange={(e) => setManualInputs((prev) => ({
                ...prev,
                [codigo]: e.target.value
              }))}
            />
            <button
              onClick={() => handleAddTiras(codigo)}
              disabled={maxPermitido <= 0}
            >
              Agregar
            </button>
          </div>
        );
      })}

      <button
        style={{ marginTop: 20 }}
        onClick={() => navigate(`/despacho/${id}/confirmar`)}
        disabled={!listo}
      >
        ✅ Marcar como Preparado
      </button>
    </div>
  );
}
