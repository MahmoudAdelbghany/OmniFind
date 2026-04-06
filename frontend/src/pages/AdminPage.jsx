import { useState, useEffect } from "react";
import { productAPI, authAPI, resolveProductImage } from "../api";

export default function AdminPage() {
  const [products, setProducts] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    main_category: "",
    sub_category: "",
    description: "",
    discount_price_usd: "",
    actual_price_usd: "",
    discount_percentage: "",
    ratings: "",
    no_of_ratings: "",
    link: "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [syncingVisual, setSyncingVisual] = useState(false);

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
    if (!imageFile) {
      setError("Product image is required.");
      return;
    }
    try {
      const formData = new FormData();
      Object.entries(form).forEach(([key, value]) => formData.append(key, value));
      formData.append("image", imageFile);
      await productAPI.createWithImage(formData);
      setMsg("Product added and embedded into Qdrant.");
      setForm({
        name: "",
        main_category: "",
        sub_category: "",
        description: "",
        discount_price_usd: "",
        actual_price_usd: "",
        discount_percentage: "",
        ratings: "",
        no_of_ratings: "",
        link: "",
      });
      setImageFile(null);
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

  const handleSyncVisual = async () => {
    setMsg("");
    setError("");
    setSyncingVisual(true);
    try {
      const data = await productAPI.syncVisualIndex();
      setMsg(data.synced ? `Synced ${data.count} vectors to Qdrant.` : "Visual index already synced.");
    } catch (err) {
      setError(err.message);
    }
    setSyncingVisual(false);
  };

  const f = (field) => ({
    value: form[field],
    onChange: (e) => setForm({ ...form, [field]: e.target.value }),
  });

  return (
    <div className="container">
      <h2 className="page-title">Admin Panel</h2>

      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Visual Index</h3>
        <p style={{ marginBottom: 12 }}>Sync pipeline-1 vectors from ~/amzon into local Qdrant.</p>
        <button onClick={handleSyncVisual} className="btn btn-secondary" disabled={syncingVisual}>
          {syncingVisual ? "Syncing..." : "Sync Visual Vectors"}
        </button>
      </div>

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
              <label>Product Link</label>
              <input {...f("link")} />
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
              <label>Discount %</label>
              <input type="number" step="0.1" {...f("discount_percentage")} />
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
          <div className="form-group">
            <label>Product Image *</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Add Product
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Manage Products</h3>
        <table>
          <thead>
            <tr>
              <th>Image</th>
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
                <td>
                  <img
                    src={resolveProductImage(p)}
                    alt={p.name}
                    style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 4 }}
                    onError={(e) => {
                      e.currentTarget.src = "https://via.placeholder.com/52x52?text=NA";
                    }}
                  />
                </td>
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
            <button className="btn btn-secondary btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </button>
            <span style={{ padding: "4px 12px" }}>
              Page {page} of {totalPages}
            </span>
            <button className="btn btn-secondary btn-small" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        )}
      </div>

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
              <input
                type="password"
                value={adminForm.password}
                onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                minLength={6}
                required
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary">
            Create Admin
          </button>
        </form>
      </div>
    </div>
  );
}
