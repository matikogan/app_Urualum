// src/pages/confirmarDespacho.js
import React, { useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppContext } from "context/AppContext";
import { markOrderPrepared } from "API/sheets";

export default function ConfirmarDespacho() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    pedidoSeleccionado,
    paquetesPreparados,
    tirasManual,
    limpiarPreparacion
  } = useContext(AppContext);

  // Suma total de unidades preparadas (QR + tiras sueltas)
  const totalQRs = paquetesPreparados.length;
  const totalTiras = Object.values(tirasManual).reduce((sum, n) => sum + n, 0);
  const totalPreparados = totalQRs + totalTiras;

  const handlePreparar = async () => {
    // Construimos el array de productos para enviar a Sheets
    const productos = paquetesPreparados.map((p) => ({
      codigo:  p.codigo_urualum,
      paquete: p.nro_paquete,
      cantidad:p.cantidad ?? 1
    }));

    // Incluir tiras sueltas como productos sin QR
    Object.entries(tirasManual).forEach(([codigo, cantidad]) => {
      productos.push({ codigo, paquete: null, cantidad });
    });

    try {
      await markOrderPrepared({
        pedidoId: id,
        cliente: pedidoSeleccionado.clienteCodigo,
        productos
      });
      alert("✅ Pedido marcado como preparado en Sheets");
      limpiarPreparacion();
      navigate("/pedidos");
    } catch (err) {
      console.error(err);
      alert("❌ Error al registrar en Sheets: " + err.message);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Confirmar Preparación Pedido {id}</h2>

      {totalPreparados === 0 ? (
        <p>No has preparado ningún paquete o tira.</p>
      ) : (
        <>
          <p>Total unidades preparadas: {totalPreparados}</p>
          <button onClick={handlePreparar}>
            ✅ Marcar como Preparado
          </button>
        </>
      )}
    </div>
  );
}
