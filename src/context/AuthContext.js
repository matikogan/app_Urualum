// src/context/AuthContext.js
import React, { createContext, useEffect, useState, useContext } from "react";
import { auth, db, googleProvider } from "firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // usuario de Firebase Auth
  const [profile, setProfile] = useState(null); // users/{uid} (rol, etc.)
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setProfile({ id: u.uid, ...snap.data() });
        } else {
          const basic = {
            email: u.email,
            role: "operario",
            createdAt: serverTimestamp(),
            id: u.uid,
          };
          await setDoc(ref, basic);
          setProfile({ id: u.uid, ...basic });
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

  const loginWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    return cred.user;
  };

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, login, loginWithGoogle, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
