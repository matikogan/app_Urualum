import { useAuth } from "../context/AuthContext";

export default function RoleGate({ allow = [], children }) {
  const { role } = useAuth();
  if (!allow.includes(role)) return null;
  return children;
}
