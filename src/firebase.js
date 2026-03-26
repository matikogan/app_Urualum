// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFunctions} from "firebase/functions";
import { getMessaging, isSupported } from "firebase/messaging";
import { getStorage } from "firebase/storage";



// ⚠️ Reemplazá estos valores con los tuyos
const firebaseConfig = {
  apiKey: "AIzaSyD2lYmJzZBPydRCUXP2nyzGQkzoXs0dJi4",
  authDomain: "stock-urualum.firebaseapp.com",
  projectId: "stock-urualum",
  storageBucket: "stock-urualum.firebasestorage.app",
  messagingSenderId: "539303926650",
  appId: "1:539303926650:web:0e183219d06270652b14c3"
};
// Inicializa Firebase
const app = initializeApp(firebaseConfig);
console.log("[firebase.js] init projectId:", app.options.projectId, "app name:", app.name);

// Helper: obtener instancia de Messaging sólo si el navegador lo soporta
export const messagingPromise = (async () => {
  const supported = await isSupported();
  if (!supported) {
    console.log("[firebase.js] FCM no soportado en este navegador");
    return null;
  }
  try {
    const messaging = getMessaging(app);
    console.log("[firebase.js] Messaging inicializado");
    return messaging;
  } catch (err) {
    console.error("[firebase.js] Error inicializando messaging", err);
    return null;
  }
})();



// Exportá la instancia de Firestore
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// NUEVO: exportar Functions (ajustá la región si usás otra)
export const functions = getFunctions(app, "us-central1");
export const storage = getStorage(app);

