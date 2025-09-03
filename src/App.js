// src/App.js
import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "components/ProtectedRoute";
import AppLayout from "components/AppLayout";
import './styles.css';

// Recepciones
import Recepciones from "modules/recepciones/pages/recepciones";
import Factura from "modules/recepciones/pages/factura";
import Escanear from "modules/recepciones/pages/escanear";
import Confirmar from "modules/recepciones/pages/confirmar";

// Pedidos
import Pedidos from "modules/pedidos/pages/pedidos";
import PedidoDetalle from "modules/pedidos/pages/pedidoDetalle";
import ConfirmarDespacho from "modules/pedidos/pages/confirmarDespacho";
import Despacho from "modules/pedidos/pages/despacho";
import PedidoDetalleOperario from "modules/pedidos/components/PedidoDetalleOperario";


// Global
import EscanearQR from "pages/escanearQR";
import Login from "pages/login";
import Inicio from "pages/inicio";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* árbol protegido */}
      <Route element={<ProtectedRoute />}>
        {/* layout con topbar */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Inicio />} />

          {/* Recepciones */}
          <Route path="/recepciones" element={<Recepciones />} />
          <Route path="/factura" element={<Factura />} />
          <Route path="/escanear" element={<Escanear />} />
          <Route path="/escanearQR" element={<EscanearQR />} />
          <Route path="/confirmar" element={<Confirmar />} />

          {/* Pedidos */}
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/pedidos/:id" element={<PedidoDetalle />} />
          <Route path="/pedidos-operario/:id" element={<PedidoDetalleOperario />} />
          <Route path="/control/:id" element={<ConfirmarDespacho />} />
          <Route path="/despacho/:id" element={<Despacho />} />
        </Route>
      </Route>

      {/* fallback */}
      <Route path="*" element={<Login />} />
    </Routes>
  );
}
