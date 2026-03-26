// src/context/AuthContext.js
import React, { createContext, useEffect, useState, useContext } from "react";
import { auth, db, googleProvider, messagingPromise } from "../firebase"; // <-- Agregamos messagingPromise
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore"; // <-- Agregamos updateDoc
import { getToken } from "firebase/messaging"; // <-- Importamos getToken para las notificaciones

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       
  const [profile, setProfile] = useState(null); 
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        
        let perfilActual; // Variable para saber qué perfil usar en este momento

        if (snap.exists()) {
          perfilActual = { id: u.uid, ...snap.data() };
          setProfile(perfilActual);
        } else {
          const basic = {
            id: u.uid,
            email: u.email,
            nombre: u.displayName || "Cliente Nuevo",
            rol: "cliente",             
            finnegansClienteCodigo: "",  
            habilitado: false,           
            createdAt: serverTimestamp(),
          };
          await setDoc(ref, basic);
          perfilActual = basic;
          setProfile(basic);
          console.log("Nuevo perfil B2B creado para:", u.email);
        }

        // =========================================================
        // 🔥 PASO 1 NOTIFICACIONES: Pedir permiso y guardar TOKEN
        // =========================================================
        try {
          const messaging = await messagingPromise;
          if (messaging) {
            // 👇 PEGÁ TU CÓDIGO VAPID ACÁ ADENTRO 👇
            const miLlaveVapid = "BDjZ-1TySYdQ60ARtO_PncUAkycwlz7xx54vEfDhzFUT-DF6Ar3qlryGoQHWJ6hLpOrHp4N0042Ii15NkZqeEcs"; 

            // Pedimos el token (esto le lanza el cartelito de permiso al usuario)
            const currentToken = await getToken(messaging, { vapidKey: miLlaveVapid });
            
            if (currentToken) {
              // Chequeamos si el token es nuevo o cambió, para no guardar en la base de datos sin sentido
              if (perfilActual.fcmToken !== currentToken) {
                  await updateDoc(ref, { fcmToken: currentToken });
                  console.log("✅ Token de notificaciones registrado y guardado con éxito.");
              }
            } else {
              console.log("⚠️ No se generó el Token. El usuario seguramente bloqueó las notificaciones.");
            }
          }
        } catch (err) {
          console.log("❌ Error al procesar las notificaciones push:", err);
        }

      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const login = (email, password) =>
    signInWithEmailAndPassword(auth, email, password);

  const logout = () => signOut(auth);

  const value = {
    user,
    profile,
    loading,
    login,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}