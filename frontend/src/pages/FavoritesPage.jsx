import { useState, useEffect } from "react";
import { favAPI, resolveProductImage } from "../api";

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const data = await favAPI.list();
      setFavorites(data.favorites);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleRemove = async (productId) => {
    try {
      await favAPI.remove(productId);
      setFavorites((prev) => prev.filter((f) => f.product._id !== productId));
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="container"><p>Loading...</p></div>;

  return (
    <div className="container">
      <h2 style={{ marginBottom: 16 }}>My Favorites ({favorites.length})</h2>

      {favorites.length === 0 ? (
        <div className="card">
          <p>No favorites yet. Browse products and save some!</p>
        </div>
      ) : (
        <div className="product-grid">
          {favorites.map((fav) => {
              const p = fav.product;
              return (
                <div key={fav._id} className="product-card">
                  <img
                    src={resolveProductImage(p)}
                    alt={p.name}
                    onError={(e) => {
                      e.currentTarget.src = "https://via.placeholder.com/260x180?text=No+Image";
                    }}
                  />
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
                <div className="actions">
                  <button onClick={() => handleRemove(p._id)} className="btn btn-danger btn-small">
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
