// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFunctions} from "firebase/functions";

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

// Exportá la instancia de Firestore
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// NUEVO: exportar Functions (ajustá la región si usás otra)
export const functions = getFunctions(app, "us-central1");

