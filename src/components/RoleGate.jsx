import { useAuth } from "../context/AuthContext";

export default function RoleGate({ allow = [], children }) {
  const { profile } = useAuth();
  if (!allow.includes(profile?.rol)) return null;
  return children;
}
