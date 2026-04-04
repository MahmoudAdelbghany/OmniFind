import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login, register, guestLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (isRegister) {
        await register(name, email, password);
      } else {
        await login(email, password);
      }
      navigate("/products");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGuest = async () => {
    setError("");
    try {
      await guestLogin();
      navigate("/products");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-page">
      <div className="card">
        <h2>{isRegister ? "Create Account" : "Login"}</h2>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div className="form-group">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            {isRegister ? "Register" : "Login"}
          </button>
        </form>

        <div className="toggle">
          {isRegister ? "Already have an account? " : "Don't have an account? "}
          <a onClick={() => setIsRegister(!isRegister)}>
            {isRegister ? "Login" : "Register"}
          </a>
        </div>

        <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid #eee" }} />

        <button onClick={handleGuest} className="btn btn-secondary" style={{ width: "100%" }}>
          Continue as Guest
        </button>
      </div>
    </div>
  );
}
