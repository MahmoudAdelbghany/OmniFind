import { useState, useEffect } from "react";
import { productAPI, authAPI } from "../api";

export default function AdminPage() {
  const [products, setProducts] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // New product form
  const [form, setForm] = useState({
    name: "",
    main_category: "",
    sub_category: "",
    image_url: "",
    description: "",
    discount_price_usd: "",
    actual_price_usd: "",
    ratings: "",
    no_of_ratings: "",
  });

  // New admin form
  const [adminForm, setAdminForm] = useState({ name: "", email: "", password: "" });

  useEffect(() => {
    loadProducts();
  }, [page]);

  const loadProducts = async () => {
    try {
      const data = await productAPI.list(`page=${page}&limit=10`);
      setProducts(data.products);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    setMsg("");
    setError("");
    try {
      const body = { ...form };
      if (body.discount_price_usd) body.discount_price_usd = Number(body.discount_price_usd);
      if (body.actual_price_usd) body.actual_price_usd = Number(body.actual_price_usd);
      if (body.ratings) body.ratings = Number(body.ratings);
      if (body.no_of_ratings) body.no_of_ratings = Number(body.no_of_ratings);

      await productAPI.create(body);
      setMsg("Product added!");
      setForm({ name: "", main_category: "", sub_category: "", image_url: "", description: "", discount_price_usd: "", actual_price_usd: "", ratings: "", no_of_ratings: "" });
      loadProducts();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await productAPI.delete(id);
      loadProducts();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateAdmin = async (e) => {
    e.preventDefault();
    setMsg("");
    setError("");
    try {
      await authAPI.createAdmin(adminForm);
      setMsg("Admin account created!");
      setAdminForm({ name: "", email: "", password: "" });
    } catch (err) {
      setError(err.message);
    }
  };

  const f = (field) => ({
    value: form[field],
    onChange: (e) => setForm({ ...form, [field]: e.target.value }),
  });

  return (
    <div className="container">
      <h2 style={{ marginBottom: 16 }}>Admin Panel</h2>

      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}

      {/* Add Product */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Add New Product</h3>
        <form onSubmit={handleAddProduct}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-group">
              <label>Name *</label>
              <input {...f("name")} required />
            </div>
            <div className="form-group">
              <label>Main Category *</label>
              <input {...f("main_category")} required />
            </div>
            <div className="form-group">
              <label>Sub Category</label>
              <input {...f("sub_category")} />
            </div>
            <div className="form-group">
              <label>Image URL</label>
              <input {...f("image_url")} />
            </div>
            <div className="form-group">
              <label>Discount Price ($)</label>
              <input type="number" step="0.01" {...f("discount_price_usd")} />
            </div>
            <div className="form-group">
              <label>Actual Price ($)</label>
              <input type="number" step="0.01" {...f("actual_price_usd")} />
            </div>
            <div className="form-group">
              <label>Rating (0-5)</label>
              <input type="number" step="0.1" min="0" max="5" {...f("ratings")} />
            </div>
            <div className="form-group">
              <label>Number of Ratings</label>
              <input type="number" {...f("no_of_ratings")} />
            </div>
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea {...f("description")} />
          </div>
          <button type="submit" className="btn btn-primary">Add Product</button>
        </form>
      </div>

      {/* Products Table */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Manage Products</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Price</th>
              <th>Rating</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p._id}>
                <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </td>
                <td>{p.main_category}</td>
                <td>${p.discount_price_usd}</td>
                <td>⭐ {p.ratings}</td>
                <td>
                  <button onClick={() => handleDelete(p._id, p.name)} className="btn btn-danger btn-small">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="pagination">
            <button className="btn btn-secondary btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <span style={{ padding: "4px 12px" }}>Page {page} of {totalPages}</span>
            <button className="btn btn-secondary btn-small" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        )}
      </div>

      {/* Create Admin */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Create Admin Account</h3>
        <form onSubmit={handleCreateAdmin}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div className="form-group">
              <label>Name</label>
              <input value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={adminForm.password} onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} minLength={6} required />
            </div>
          </div>
          <button type="submit" className="btn btn-primary">Create Admin</button>
        </form>
      </div>
    </div>
  );
}
