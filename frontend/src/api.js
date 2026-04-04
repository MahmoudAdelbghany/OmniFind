// ─────────────────────────────────────────────
//  Simple API helper
//  All requests go through the Vite proxy → /api
// ─────────────────────────────────────────────

const BASE = "/api";

async function request(endpoint, options = {}) {
  const token = localStorage.getItem("token");

  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${endpoint}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "Something went wrong");
  }

  return data;
}

// ── Auth ──
export const authAPI = {
  register: (body) =>
    request("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  guest: () => request("/auth/guest", { method: "POST" }),
  me: () => request("/auth/me"),
  createAdmin: (body) =>
    request("/auth/create-admin", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// ── Products ──
export const productAPI = {
  list: (params = "") => request(`/products?${params}`),
  get: (id) => request(`/products/${id}`),
  search: (q, params = "") =>
    request(`/products/search/text?q=${encodeURIComponent(q)}&${params}`),
  categories: () => request("/products/categories/list"),
  create: (body) =>
    request("/products", { method: "POST", body: JSON.stringify(body) }),
  update: (id, body) =>
    request(`/products/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  delete: (id) => request(`/products/${id}`, { method: "DELETE" }),
};

// ── Favorites ──
export const favAPI = {
  list: () => request("/favorites"),
  add: (productId) =>
    request("/favorites", {
      method: "POST",
      body: JSON.stringify({ productId }),
    }),
  remove: (productId) =>
    request(`/favorites/${productId}`, { method: "DELETE" }),
};
