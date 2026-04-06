// ─────────────────────────────────────────────
//  Simple API helper
//  All requests go through the Vite proxy → /api
// ─────────────────────────────────────────────

const BASE = "/api";
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || "http://localhost:5000";

async function request(endpoint, options = {}) {
  const token = localStorage.getItem("token");
  const isFormData = options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }
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
  semanticSearch: (q, params = "") =>
    request(`/products/search/semantic?q=${encodeURIComponent(q)}&${params}`),
  visualSearch: (formData) =>
    request("/products/search/visual", {
      method: "POST",
      body: formData,
    }),
  syncVisualIndex: () =>
    request("/products/search/visual/sync", {
      method: "POST",
    }),
  categories: () => request("/products/categories/list"),
  create: (body) =>
    request("/products", { method: "POST", body: JSON.stringify(body) }),
  createWithImage: (formData) =>
    request("/products", {
      method: "POST",
      body: formData,
    }),
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

export function resolveProductImage(product) {
  const localPath = product?.image_local || "";
  if (localPath.includes("/final_data/visual_dataset/images/")) {
    const fileName = localPath.split("/").pop();
    if (fileName) return `${API_ORIGIN}/amzon-images/${fileName}`;
  }
  const remote = product?.image_url || "";
  if (/^https?:\/\//i.test(remote)) return remote;
  if (remote.startsWith("/uploads/")) return `${API_ORIGIN}${remote}`;
  if (localPath.startsWith("/uploads/")) return `${API_ORIGIN}${localPath}`;
  return "https://via.placeholder.com/260x180?text=No+Image";
}
