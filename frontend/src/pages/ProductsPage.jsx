import { useState, useEffect } from "react";
import { productAPI, favAPI } from "../api";
import { useAuth } from "../context/AuthContext";

export default function ProductsPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minRating, setMinRating] = useState("");

  // Favorites tracking
  const [favIds, setFavIds] = useState(new Set());

  // Load categories on mount
  useEffect(() => {
    productAPI.categories().then((data) => setCategories(data.categories)).catch(() => {});
  }, []);

  // Load user favorites
  useEffect(() => {
    if (user && (user.role === "user" || user.role === "admin")) {
      favAPI
        .list()
        .then((data) => {
          const ids = new Set(data.favorites.map((f) => f.product._id));
          setFavIds(ids);
        })
        .catch(() => {});
    }
  }, [user]);

  // Fetch products when filters/page change
  useEffect(() => {
    fetchProducts();
  }, [page, category, minPrice, maxPrice, minRating]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      let params = `page=${page}&limit=12`;
      if (category) params += `&category=${encodeURIComponent(category)}`;
      if (minPrice) params += `&min_price=${minPrice}`;
      if (maxPrice) params += `&max_price=${maxPrice}`;
      if (minRating) params += `&min_rating=${minRating}`;

      let data;
      if (searchMode && searchQuery.trim()) {
        data = await productAPI.search(searchQuery, params);
      } else {
        data = await productAPI.list(params);
      }
      setProducts(data.products);
      setTotalPages(data.totalPages);
      setTotal(data.totalProducts);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    if (searchQuery.trim()) {
      setSearchMode(true);
    } else {
      setSearchMode(false);
    }
    fetchProducts();
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchMode(false);
    setPage(1);
  };

  const toggleFav = async (productId) => {
    if (!user || user.role === "guest") return;
    try {
      if (favIds.has(productId)) {
        await favAPI.remove(productId);
        setFavIds((prev) => {
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
      } else {
        await favAPI.add(productId);
        setFavIds((prev) => new Set(prev).add(productId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="container">
      <h2 style={{ marginBottom: 16 }}>Products {total > 0 && `(${total})`}</h2>

      {/* Search */}
      <form onSubmit={handleSearch} className="search-bar">
        <input
          placeholder="Search products..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">Search</button>
        {searchMode && (
          <button type="button" onClick={clearSearch} className="btn btn-secondary">Clear</button>
        )}
      </form>

      {/* Filters */}
      <div className="filters">
        <div className="form-group">
          <label>Category</label>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Min Price ($)</label>
          <input
            type="number"
            value={minPrice}
            onChange={(e) => { setMinPrice(e.target.value); setPage(1); }}
            style={{ width: 100 }}
          />
        </div>
        <div className="form-group">
          <label>Max Price ($)</label>
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => { setMaxPrice(e.target.value); setPage(1); }}
            style={{ width: 100 }}
          />
        </div>
        <div className="form-group">
          <label>Min Rating</label>
          <select value={minRating} onChange={(e) => { setMinRating(e.target.value); setPage(1); }}>
            <option value="">Any</option>
            <option value="4">4+</option>
            <option value="3">3+</option>
            <option value="2">2+</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <p>Loading...</p>
      ) : products.length === 0 ? (
        <p>No products found.</p>
      ) : (
        <div className="product-grid">
          {products.map((p) => (
            <div key={p._id} className="product-card">
              <img src={p.image_url} alt={p.name} onError={(e) => (e.target.src = "https://via.placeholder.com/260x180?text=No+Image")} />
              <div className="info">
                <div className="category">{p.main_category} / {p.sub_category}</div>
                <div className="name">{p.name}</div>
                <div className="prices">
                  <span className="price">${p.discount_price_usd}</span>
                  {p.actual_price_usd > p.discount_price_usd && (
                    <span className="original-price">${p.actual_price_usd}</span>
                  )}
                </div>
                <div className="rating">⭐ {p.ratings} ({p.no_of_ratings} reviews)</div>
              </div>
              {user && user.role !== "guest" && (
                <div className="actions">
                  <button
                    onClick={() => toggleFav(p._id)}
                    className={`btn btn-small ${favIds.has(p._id) ? "btn-danger" : "btn-secondary"}`}
                  >
                    {favIds.has(p._id) ? "♥ Saved" : "♡ Save"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-secondary btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span style={{ padding: "4px 12px" }}>
            Page {page} of {totalPages}
          </span>
          <button className="btn btn-secondary btn-small" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
