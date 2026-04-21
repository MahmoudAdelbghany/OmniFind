// ─────────────────────────────────────────────
//  Simple API helper
//  All requests go through the Vite proxy → /api
// ─────────────────────────────────────────────

const BASE = "/api";
const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:5000");

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
  voiceSearch: (formData) =>
    request("/products/search/voice", {
      method: "POST",
      body: formData,
    }),
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

export const dashboardAPI = {
  get: (limit = 100) => request(`/dashboard?limit=${limit}`),
};

export const chatbotAPI = {
  ask: (message, history = []) =>
    request("/chatbot/message", {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
};

function normalizePath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function datasetImageFromPath(value) {
  const normalized = normalizePath(value);
  if (!normalized) return "";

  if (normalized.startsWith("images/")) {
    const fileName = normalized.split("/").pop();
    return fileName ? `${API_ORIGIN}/amzon-images/${encodeURIComponent(fileName)}` : "";
  }

  if (normalized.includes("/visual_dataset/")) {
    const fileName = normalized.split("/").pop();
    return fileName ? `${API_ORIGIN}/amzon-images/${encodeURIComponent(fileName)}` : "";
  }

  const directProdFile = normalized.match(/(prod_\d+\.(?:jpg|jpeg|png|webp))/i);
  if (directProdFile?.[1]) {
    return `${API_ORIGIN}/amzon-images/${encodeURIComponent(directProdFile[1])}`;
  }
  return "";
}

function uploadsPath(value) {
  const normalized = normalizePath(value);
  if (!normalized) return "";
  if (normalized.startsWith("/uploads/")) return `${API_ORIGIN}${normalized}`;
  if (normalized.startsWith("uploads/")) return `${API_ORIGIN}/${normalized}`;
  return "";
}

export function resolveProductImageCandidates(product) {
  const candidates = [];
  const pushUnique = (candidate) => {
    if (!candidate) return;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };

  const localPath = product?.image_local || "";
  const imageUrl = product?.image_url || product?.image || "";

  pushUnique(datasetImageFromPath(localPath));
  pushUnique(uploadsPath(localPath));
  pushUnique(datasetImageFromPath(imageUrl));
  pushUnique(uploadsPath(imageUrl));

  const remote = String(imageUrl || "").trim();
  if (/^https?:\/\//i.test(remote)) pushUnique(remote);

  pushUnique("https://via.placeholder.com/260x180?text=No+Image");
  return candidates;
}

export function resolveProductImage(product) {
  return resolveProductImageCandidates(product)[0];
}

export function nextProductImageFallback(product, currentSrc = "") {
  const candidates = resolveProductImageCandidates(product);
  const idx = candidates.indexOf(currentSrc);
  if (idx >= 0 && idx + 1 < candidates.length) return candidates[idx + 1];
  return candidates[candidates.length - 1];
}
