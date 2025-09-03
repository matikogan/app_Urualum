import React from "react";
import { useAuth } from "../context/AuthContext";

export default function RoleGate({ allow = [], fallback = null, children }) {
  const { profile, loading } = useAuth();
  if (loading) return null; 
  if (!profile) return fallback;
  return allow.includes(profile.role) ? children : (fallback ?? null);
}