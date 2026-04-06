import { useState, useEffect } from "react";
import { productAPI, favAPI, resolveProductImage } from "../api";
import { useAuth } from "../context/AuthContext";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 2a8 8 0 1 1-5.293 14.001l-2.854 2.853a1 1 0 1 1-1.414-1.414l2.853-2.854A8 8 0 0 1 10 2m0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 15a4 4 0 0 0 4-4V7a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4m6-4a1 1 0 0 1 2 0 8 8 0 0 1-7 7.938V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.062A8 8 0 0 1 4 11a1 1 0 0 1 2 0 6 6 0 0 0 12 0"
      />
    </svg>
  );
}

export default function ProductsPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [visualMode, setVisualMode] = useState(false);
  const [visualLoading, setVisualLoading] = useState(false);
  const [visualError, setVisualError] = useState("");
  const [visualImage, setVisualImage] = useState(null);
  const [visualPreview, setVisualPreview] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);

  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minRating, setMinRating] = useState("");

  const [favIds, setFavIds] = useState(new Set());

  useEffect(() => {
    const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    setVoiceSupported(supported);
    productAPI
      .categories()
      .then((data) => setCategories(data.categories))
      .catch(() => {});
  }, []);

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

  useEffect(() => {
    if (visualMode) return;
    fetchProducts();
  }, [page, category, minPrice, maxPrice, minRating, visualMode]);

  useEffect(() => {
    if (!visualImage) {
      setVisualPreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(visualImage);
    setVisualPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [visualImage]);

  const fetchProducts = async (forceSearch = null, pageOverride = null) => {
    setLoading(true);
    try {
      const requestedPage = pageOverride || page;
      let params = `page=${requestedPage}&limit=12`;
      if (category) params += `&category=${encodeURIComponent(category)}`;
      if (minPrice) params += `&min_price=${minPrice}`;
      if (maxPrice) params += `&max_price=${maxPrice}`;
      if (minRating) params += `&min_rating=${minRating}`;

      const useSearch = forceSearch === null ? searchMode && searchQuery.trim() : forceSearch;
      const data = useSearch
        ? await productAPI.semanticSearch(searchQuery, `limit=18`)
        : await productAPI.list(params);

      setProducts(data.products);
      setTotalPages(data.totalPages || 1);
      setTotal(data.totalProducts || 0);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setVisualMode(false);
    setVisualError("");
    setVoiceError("");
    setPage(1);
    const useSearch = Boolean(searchQuery.trim());
    setSearchMode(useSearch);
    fetchProducts(useSearch, 1);
  };

  const handleVoiceSearch = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceError("Voice search is not supported in this browser.");
      return;
    }
    setVoiceError("");
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setVoiceListening(true);
    recognition.onend = () => setVoiceListening(false);
    recognition.onerror = () => {
      setVoiceListening(false);
      setVoiceError("Could not capture voice. Try again.");
    };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
      if (!transcript) return;
      setSearchQuery(transcript);
      setVisualMode(false);
      setVisualError("");
      setSearchMode(true);
      setPage(1);
      fetchProducts(true, 1);
    };
    recognition.start();
  };

  const handleVisualSearch = async (e) => {
    e.preventDefault();
    setVisualError("");
    if (!visualImage) {
      setVisualError("Please choose an image first.");
      return;
    }
    setVisualLoading(true);
    try {
      const formData = new FormData();
      formData.append("image", visualImage);
      formData.append("top_k", "12");
      const data = await productAPI.visualSearch(formData);
      setProducts(data.products || []);
      setTotal(data.totalProducts || 0);
      setTotalPages(1);
      setPage(1);
      setVisualMode(true);
      setSearchMode(false);
    } catch (err) {
      setVisualError(err.message);
    }
    setVisualLoading(false);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchMode(false);
    setVisualMode(false);
    setVisualError("");
    setVoiceError("");
    setVisualImage(null);
    setPage(1);
    fetchProducts(false, 1);
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
      <h2 className="page-title">
        {visualMode ? "Visual Search Results" : "Products"} {total > 0 && `(${total})`}
      </h2>

      <form onSubmit={handleSearch} className="search-bar">
        <button type="submit" className="icon-btn search-icon-btn" aria-label="Search">
          <SearchIcon />
        </button>
        <input
          placeholder="Semantic product search (voice + text)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          type="button"
          className={`icon-btn voice-icon-btn ${voiceListening ? "listening" : ""}`}
          onClick={handleVoiceSearch}
          disabled={!voiceSupported}
          aria-label="Voice search"
          title={voiceSupported ? "Voice search" : "Voice search unavailable"}
        >
          <MicIcon />
        </button>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
        {(searchMode || visualMode) && (
          <button type="button" onClick={clearSearch} className="btn btn-secondary">
            Clear
          </button>
        )}
      </form>
      {voiceError && <div className="error">{voiceError}</div>}

      <form onSubmit={handleVisualSearch} className="visual-search modern-visual">
        <div className="visual-search-left">
          <label className="visual-file-label">
            <span>{visualImage ? "Change image" : "Upload image"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setVisualImage(e.target.files?.[0] || null)}
            />
          </label>
          <div className="visual-file-meta">{visualImage ? visualImage.name : "PNG / JPG / WEBP"}</div>
        </div>
        {visualPreview && <img className="visual-preview" src={visualPreview} alt="Visual query preview" />}
        <button type="submit" className="btn btn-amazon" disabled={visualLoading}>
          {visualLoading ? "Searching visually..." : "Run Visual Search"}
        </button>
      </form>
      {visualLoading && (
        <div className="visual-loading-chip">
          <span className="pulse-dot" />
          Matching similar products...
        </div>
      )}
      {visualError && <div className="error">{visualError}</div>}

      {!visualMode && (
        <div className="filters">
          <div className="form-group">
            <label>Category</label>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Min Price ($)</label>
            <input
              type="number"
              value={minPrice}
              onChange={(e) => {
                setMinPrice(e.target.value);
                setPage(1);
              }}
              style={{ width: 100 }}
            />
          </div>
          <div className="form-group">
            <label>Max Price ($)</label>
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => {
                setMaxPrice(e.target.value);
                setPage(1);
              }}
              style={{ width: 100 }}
            />
          </div>
          <div className="form-group">
            <label>Min Rating</label>
            <select
              value={minRating}
              onChange={(e) => {
                setMinRating(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Any</option>
              <option value="4">4+</option>
              <option value="3">3+</option>
              <option value="2">2+</option>
            </select>
          </div>
        </div>
      )}

      {loading || visualLoading ? (
        <div className="product-grid skeleton-grid">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={`skeleton-${idx}`} className="product-card skeleton-card">
              <div className="skeleton-image shimmer" />
              <div className="info">
                <div className="skeleton-line shimmer" />
                <div className="skeleton-line short shimmer" />
                <div className="skeleton-line tiny shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <p>No products found.</p>
      ) : (
        <div className="product-grid">
          {products.map((p) => (
            <div key={p._id} className="product-card">
              <img
                src={resolveProductImage(p)}
                alt={p.name}
                onError={(e) => {
                  e.currentTarget.src = "https://via.placeholder.com/260x180?text=No+Image";
                }}
              />
              <div className="info">
                <div className="category">
                  {p.main_category} / {p.sub_category}
                </div>
                <div className="name">{p.name}</div>
                <div className="prices">
                  <span className="price">${p.discount_price_usd}</span>
                  {p.actual_price_usd > p.discount_price_usd && (
                    <span className="original-price">${p.actual_price_usd}</span>
                  )}
                </div>
                <div className="rating">⭐ {p.ratings} ({p.no_of_ratings} reviews)</div>
                {typeof p.visual_score === "number" && (
                  <div className="visual-score">Visual score: {p.visual_score.toFixed(4)}</div>
                )}
                {typeof p.text_score === "number" && (
                  <div className="text-score">Text score: {p.text_score.toFixed(4)}</div>
                )}
                {typeof p.discount_percentage === "number" && p.discount_percentage > 0 && (
                  <div className="discount-pill">-{p.discount_percentage.toFixed(0)}%</div>
                )}
              </div>
              {user && user.role !== "guest" && (
                <div className="actions">
                  <button
                    onClick={() => toggleFav(p._id)}
                    className={`btn btn-small ${favIds.has(p._id) ? "btn-danger" : "btn-secondary"}`}
                  >
                    {favIds.has(p._id) ? "Saved" : "Save"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!visualMode && totalPages > 1 && (
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
  );
}
