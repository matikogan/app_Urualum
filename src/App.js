import { useEffect } from "react";
import { useParams, useNavigate, Routes, Route, Navigate } from "react-router-dom";

import { doc, setDoc } from "firebase/firestore";
import { db, messagingPromise } from "./firebase";
import { getToken, onMessage } from "firebase/messaging";

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
import ControlCarga from "modules/pedidos/pages/ControlCarga";
import GestionCamiones from "modules/pedidos/pages/GestionCamiones";
import ControlCamion from "modules/pedidos/pages/ControlCamion";
import EntregaIsabela from "modules/pedidos/pages/EntregaIsabela";
import EtiquetasSeleccion from "modules/pedidos/pages/EtiquetasSeleccion";
import EtiquetasCarga from "modules/pedidos/pages/EtiquetasCarga";
import EtiquetasControl from "modules/pedidos/pages/EtiquetasControl";
import EtiquetasHistorial from "modules/pedidos/pages/EtiquetasHistorial";

// Pedidos (Operario)
import PedidosAsignadosOperario from "modules/pedidos/components/PedidosAsignadosOperario";
import PedidoDetalleOperario from "modules/pedidos/components/PedidoDetalleOperario";

// Pedidos (Ventas)
import PedidosControladosVentas from "./modules/pedidos/pages/PedidosControladosVentas";
import PedidoDetalleVentas from "./modules/pedidos/pages/PedidoDetalleVentas";
import DespachadosHistorico from "./modules/pedidos/pages/DespachadosHistorico";
import EntregadosHistorico from "./modules/pedidos/pages/EntregadosHistorico";
import PipelineVentas from "./modules/pedidos/pages/PipelineVentas";

// Errores (Encargado)
import ErroresPreparacionPage from "modules/pedidos/pages/ErroresPreparacionPago";

// Prueba
import TestFinnegans from "modules/pedidos/pages/testFinnegans";
import TestFSPage from "./pages/testFS";
import TestSyncPage from "./pages/testSync";
import AdminResetDeposito from "./pages/AdminResetDeposito";
import AdminPanel from "./pages/AdminPanel";

// Global
import EscanearQR from "pages/escanearQR";
import Login from "pages/login";
import Inicio from "pages/inicio";

// Auth
import { useAuth } from "context/AuthContext";

// Errores Cargas
import ErrorCarga from "./pages/errorCarga";
import ActitudCarga from "./pages/actitudCarga";
import ReporteSemanal from "./pages/reporteSemanal";


import Catalogo from "modules/ecommerce/pages/Catalogo";
import Carrito from "modules/ecommerce/pages/Carrito";
import PedidosWeb from "modules/ecommerce/pages/PedidosWeb";
import MisPedidos from "modules/ecommerce/pages/MisPedidos";

// Registrar el Service Worker de Firebase Messaging manualmente
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/firebase-messaging-sw.js")
    .then((registration) => {
      console.log("[App] SW registrado correctamente:", registration);
    })
    .catch((err) => {
      console.error("[App] Error registrando SW:", err);
    });
}

const FCM_VAPID_KEY = process.env.REACT_APP_FCM_VAPID_KEY;

function NotificationsManager() {
  const { user } = useAuth();
  // ... Código intacto de notificaciones ...
  useEffect(() => { /* ... tu lógica actual ... */ }, [user?.uid]);
  useEffect(() => { /* ... tu listener ... */ }, []);
  return null;
}

// Puerta de entrada para /pedidos: elige vista según rol
function PedidosLanding() {
  const { profile } = useAuth();
  if (!profile) return null; // opcional: spinner acá

  const role = String(profile.role || profile.rol || "").toLowerCase();
  if (role === "operario") return <PedidosAsignadosOperario />;
  if (role === "ventas" || role === "admin") return <PipelineVentas />;

  return <Pedidos />; // default para encargados / otros
}

function ConfirmarDespachoWrapper() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <div className="container">
      <h1 className="title">Confirmar despacho</h1>
      <ConfirmarDespacho pedidoId={id} onDone={() => navigate(-1)} />
    </div>
  );
}

// ==========================================
// EL SEMÁFORO INTELIGENTE (NUEVO)
// ==========================================
// Decide qué inicio mostrar basado en el rol de Firestore.
function SmartHome() {
  const { profile } = useAuth();
  if (!profile) return null; // Cargando...

  // Si tiene código de Finnegans o su rol es "cliente", lo mandamos directo a compras.
  if (profile.rol === "cliente" || profile.finnegansClienteCodigo) {
    return <Navigate to="/mis-pedidos" replace />;
  }

  // De lo contrario, lo mandamos al "Inicio" de empleados (como siempre).
  return <Inicio />;
}

// ==========================================
// ENRUTADOR PRINCIPAL
// ==========================================
export default function App() {
  return (
    <>
      {/* Siempre montado mientras la app está corriendo */}
      <NotificationsManager />

      <Routes>
        <Route path="/login" element={<Login />} />

        {/* árbol protegido (Requerido estar logueado) */}
        <Route element={<ProtectedRoute />}>
          
          {/* =========================================
              RUTAS EXTERNAS: CLIENTES / VENTAS
              Están protegidas pero NO muestran el AppLayout (Menú interno).
              ========================================= */}
          <Route path="/mis-pedidos" element={<MisPedidos />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/carrito" element={<Carrito />} />


          {/* =========================================
              RUTAS INTERNAS: EMPLEADOS
              El AppLayout contiene la barra lateral/superior de la empresa.
              ========================================= */}
          <Route element={<AppLayout />}>
            {/* Aquí usamos nuestro semáforo en vez del componente Inicio directo */}
            <Route path="/" element={<SmartHome />} />
            
            {/* ... TODO lo que ya tenías va igual ... */}
            <Route path="/pedidos" element={<PedidosLanding />} />
            <Route path="/pedidos/:id" element={<PedidoDetalle />} />
            <Route path="/operario/asignados" element={<PedidosAsignadosOperario />} />
            <Route path="/pedidos-operario/:id" element={<PedidoDetalleOperario />} />
            
            <Route element={<ProtectedRoute roles={["ventas", "admin"]} />}>
              <Route path="/ventas/para-despachar" element={<PedidosControladosVentas />} />
              <Route path="/ventas/para-despachar/:id" element={<PedidoDetalleVentas />} />
              <Route path="/ventas/pedidos-web" element={<PedidosWeb />} />
              <Route path="/ventas/despachar/:id" element={<ConfirmarDespachoWrapper />} />
              <Route path="/ventas/despachados" element={<DespachadosHistorico />} />
              <Route path="/ventas/entregados" element={<EntregadosHistorico />} />
              <Route path="/ventas/pipeline" element={<PipelineVentas />} />
            </Route>

            <Route path="/despacho/:id" element={<Despacho />} />

            {/* Errores */}
            <Route path="/encargado/errores" element={<ErroresPreparacionPage />} />
            <Route path="/encargado/control-carga" element={<ControlCarga />} />
            <Route path="/encargado/camiones" element={<GestionCamiones />} />
            <Route path="/encargado/camiones/:camionId" element={<ControlCamion />} />
            <Route path="/encargado/entrega/:id" element={<EntregaIsabela />} />
            <Route path="/encargado/etiquetas" element={<EtiquetasSeleccion />} />
            <Route path="/encargado/etiquetas/carga" element={<EtiquetasCarga />} />
            <Route path="/encargado/etiquetas/control" element={<EtiquetasControl />} />
            <Route path="/encargado/etiquetas/historial" element={<EtiquetasHistorial />} />
            <Route path="/errores/nuevo" element={<ErrorCarga />} />
            <Route path="/actitud/nuevo" element={<ActitudCarga />} />
            <Route path="/reporte/semanal" element={<ReporteSemanal />} />

            {/* Páginas de test — solo admin */}
            <Route element={<ProtectedRoute roles={["admin"]} />}>
              <Route path="/test-fs" element={<TestFSPage />} />
              <Route path="/test-sync" element={<TestSyncPage />} />
            </Route>

            {/* Panel de administración */}
            <Route path="/admin/panel" element={<AdminPanel />} />

            {/* Utilidades de desarrollo — cualquier usuario autenticado */}
            <Route path="/admin/reset-deposito" element={<AdminResetDeposito />} />

            {/* Test Finnegans — temporalmente sin restricción para inspección */}
            <Route path="/test-finnegans" element={<TestFinnegans />} />
          </Route>
        </Route>

        {/* fallback (Si entran a una URL rara) */}
        <Route path="*" element={<Login />} />
      </Routes>
    </>
  );
}