// src/App.js
import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "components/ProtectedRoute";
import AppLayout from "components/AppLayout";
import "./styles.css";

// Recepciones
import Recepciones from "modules/recepciones/pages/recepciones";
import Factura from "modules/recepciones/pages/factura";
import Escanear from "modules/recepciones/pages/escanear";
import Confirmar from "modules/recepciones/pages/confirmar";

// Pedidos (Encargado)
import Pedidos from "modules/pedidos/pages/pedidos";
import PedidoDetalle from "modules/pedidos/pages/pedidoDetalle";
import ConfirmarDespacho from "modules/pedidos/pages/confirmarDespacho";
import Despacho from "modules/pedidos/pages/despacho";

// Pedidos (Operario)
import PedidosAsignadosOperario from "modules/pedidos/components/PedidosAsignadosOperario";
import PedidoDetalleOperario from "modules/pedidos/components/PedidoDetalleOperario";

//Pedidos (Ventas)
import PedidosControladosVentas from "./modules/pedidos/pages/PedidosControladosVentas";

// Prueba
import TestFinnegans from "pages/testFinnegans";
import TestFSPage from "./pages/testFS";
import TestSyncPage from "./pages/testSync";


// Global
import EscanearQR from "pages/escanearQR";
import Login from "pages/login";
import Inicio from "pages/inicio";

// Auth
import { useAuth } from "context/AuthContext";

// Puerta de entrada para /pedidos: elige vista según rol
function PedidosLanding() {
  const { profile } = useAuth();
  if (!profile) return null; // opcional: spinner acá
  return profile.role === "operario" ? <PedidosAsignadosOperario /> : <Pedidos />;
}

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
          <Route path="/pedidos" element={<PedidosLanding />} />
          <Route path="/pedidos/:id" element={<PedidoDetalle />} />
          <Route path="/operario/asignados" element={<PedidosAsignadosOperario />} />
          <Route path="/pedidos-operario/:id" element={<PedidoDetalleOperario />} />
          <Route element={<ProtectedRoute roles={["ventas"]} />}>
            <Route path="/ventas/para-despachar" element={<PedidosControladosVentas />} />
            <Route path="/ventas/para-despachar/:id" element={<PedidoDetalle />} />
          </Route>
          <Route path="/control/:id" element={<ConfirmarDespacho />} />
          <Route path="/despacho/:id" element={<Despacho />} />

          {/* Página de test Finnegans */}
          <Route path="/test-finnegans" element={<TestFinnegans />} />
          <Route path="/test-fs" element={<TestFSPage />} />
          <Route path="/test-sync" element={<TestSyncPage />} />
        </Route>
      </Route>

      {/* fallback */}
      <Route path="*" element={<Login />} />
    </Routes>
  );
}
