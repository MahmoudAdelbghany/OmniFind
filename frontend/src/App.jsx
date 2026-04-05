import { Routes, Route, Link, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import ProductsPage from "./pages/ProductsPage";
import FavoritesPage from "./pages/FavoritesPage";
import AdminPage from "./pages/AdminPage";

function Navbar() {
  const { user, logout } = useAuth();

  return (
    <div className="navbar-wrap">
      <div className="navbar">
        <Link to="/products" className="logo">
          Omni<span className="logo-accent">Find</span>
        </Link>
        <nav>
          <Link to="/products">Products</Link>
          {user && user.role !== "guest" && <Link to="/favorites">Favorites</Link>}
          {user && user.role === "admin" && <Link to="/admin">Admin</Link>}
          {user ? (
            <>
              <span className="role-badge">{user.role}</span>
              <a onClick={logout} style={{ cursor: "pointer" }}>
                Logout
              </a>
            </>
          ) : (
            <Link to="/login">Sign in</Link>
          )}
        </nav>
      </div>
      <div className="navbar-sub">
        <span>Smart visual discovery</span>
        <span>Fast category search</span>
        <span>Curated recommendations</span>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <p style={{ padding: 40, textAlign: "center" }}>Loading...</p>;

  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/products" />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route
          path="/favorites"
          element={user && user.role !== "guest" ? <FavoritesPage /> : <Navigate to="/login" />}
        />
        <Route
          path="/admin"
          element={user && user.role === "admin" ? <AdminPage /> : <Navigate to="/login" />}
        />
        <Route path="*" element={<Navigate to="/products" />} />
      </Routes>
    </>
  );
}
