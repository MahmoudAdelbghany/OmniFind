# OmniFind Backend + Frontend

A simple Express.js REST API + React frontend for the OmniFind e-commerce discovery platform.

---

## Prerequisites

Make sure you have these installed on your machine:

- **Node.js** (v18 or higher) → [Download](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Git** → [Download](https://git-scm.com/)
- **Python** with the amzon virtual env at `/home/abghany/amzon/.venv` (used for DINO + Qdrant bridge)
- In that venv, install:
  - `sentence-transformers`
  - `faiss-cpu` (or compatible faiss build)
  - `modal` (for team voice pipeline compatibility)

To check if you have them:

```bash
node -v
npm -v
git --version
```

---

## How to Run (Step by Step)

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd OmniFind
```

### 2. Create the `.env` file

Create a file called `.env` in the `OmniFind/` root folder with this content:

```env
MONGO_URI=mongodb+srv://engkhaledmohamed55_db_user:<PASSWORD>@omnifind.0riqkxn.mongodb.net/omnifind?retryWrites=true&w=majority&appName=OmniFind
JWT_SECRET=omnifind_super_secret_key_change_in_production
JWT_EXPIRES_IN=7d
PORT=5000
AMZON_BASE_DIR=/home/abghany/amzon
DINO_PYTHON_BIN=/home/abghany/amzon/.venv/bin/python
MONGO_ALLOW_FALLBACK=true
```

> **Important:** Replace `<PASSWORD>` with the actual MongoDB password. Ask the team lead for it.
>
> If Atlas is unreachable (for example IP whitelist issue), backend can fall back to local embedded MongoDB unless `MONGO_ALLOW_FALLBACK=false`.

### Prebuilt local vector DB included

This repo now ships with a prebuilt Qdrant local collection at:

`data/qdrant_local_db/collection/amazon_visual_dino/storage.sqlite`

So after cloning, visual search is bootstrapped quickly. The worker also merges the team text pipeline vectors into the same Qdrant collection as named vectors (`image` + `text`).

### 3. Install backend dependencies

```bash
npm install
```

### 4. Start the backend server

```bash
npm run dev
```

Backend runs on **http://localhost:5000**

### 5. Install & start the frontend (new terminal)

Open a **second terminal** and run:

```bash
cd frontend
npm install
npx vite
```

Frontend runs on **http://localhost:3000**

### 6. Open in browser

Go to **http://localhost:3000** and you're good to go!

---

## Summary of Commands

| What                  | Command       | Where                |
| --------------------- | ------------- | -------------------- |
| Install backend deps  | `npm install` | `OmniFind/`          |
| Seed full amzon dataset into MongoDB | `npm run seed` | `OmniFind/` |
| Start backend         | `npm run dev` | `OmniFind/`          |
| Install frontend deps | `npm install` | `OmniFind/frontend/` |
| Start frontend        | `npx vite`    | `OmniFind/frontend/` |

> `npm run seed` exists but **don't run it** — the database is already seeded. Running it would reset all products.

> You need **two terminals** running at the same time: one for backend, one for frontend.

---

## Default Accounts

| Role  | Email              | Password |
| ----- | ------------------ | -------- |
| Admin | admin@omnifind.com | admin123 |

> You can register new user accounts from the UI or the API.

---

## Three User Roles

| Role      | Can Do                                  |
| --------- | --------------------------------------- |
| **admin** | Insert, update, delete products         |
| **user**  | Save favorite products, manage profile  |
| **guest** | Search and browse products (no account) |

---

## Authentication

All protected routes use **Bearer Token** authentication:

```
Authorization: Bearer <your_token>
```

You get a token when you login or register. The frontend handles this automatically.

---

## API Routes

### Auth (`/api/auth`)

| Method | Route           | Auth   | Description                |
| ------ | --------------- | ------ | -------------------------- |
| POST   | `/register`     | Public | Create a new user account  |
| POST   | `/login`        | Public | Login and get token        |
| POST   | `/guest`        | Public | Get a guest token          |
| GET    | `/me`           | Token  | Get current user profile   |
| POST   | `/create-admin` | Admin  | Create a new admin account |

**Register / Login body:**

```json
{
  "name": "Areeb",
  "email": "areeb@example.com",
  "password": "mypassword"
}
```

### Products (`/api/products`)

| Method | Route                    | Auth   | Description                                       |
| ------ | ------------------------ | ------ | ------------------------------------------------- |
| GET    | `/`                      | Public | List products (with filters)                      |
| GET    | `/search/text?q=..`      | Public | Full-text search                                  |
| GET    | `/search/semantic?q=..`  | Public | Vector text search (team FAISS pipeline merged into Qdrant) |
| POST   | `/search/visual`         | Public | Visual search (multipart image, DINO + Qdrant)   |
| POST   | `/search/visual/sync`    | Admin  | Sync pipeline-1 vectors to local Qdrant          |
| GET    | `/categories/list`       | Public | Get all categories                                |
| GET    | `/:id`                   | Public | Get single product                                |
| POST   | `/`                      | Admin  | Create product with uploaded image (no image URL) |
| PUT    | `/:id`                   | Admin  | Update a product                                  |
| DELETE | `/:id`                   | Admin  | Delete product + remove Qdrant product vector     |

**Product filters (query params):**

- `?category=electronics`
- `?sub_category=headphones`
- `?min_price=10&max_price=50`
- `?min_rating=4`
- `?page=2&limit=10`

### Favorites (`/api/favorites`)

| Method | Route         | Auth       | Description              |
| ------ | ------------- | ---------- | ------------------------ |
| GET    | `/`           | User/Admin | Get all saved favorites  |
| POST   | `/`           | User/Admin | Add product to favorites |
| DELETE | `/:productId` | User/Admin | Remove from favorites    |

**Add favorite body:**

```json
{
  "productId": "6712abc..."
}
```

---

## Project Structure

```
OmniFind/
├── server.js                    # Entry point
├── package.json
├── .env                         # Environment variables (NOT in git)
├── config/
│   └── db.js                    # MongoDB connection
├── middleware/
│   └── auth.js                  # JWT verify + role-based access
├── models/
│   ├── User.js                  # User schema (admin / user / guest)
│   ├── Product.js               # Product schema (from Amazon dataset)
│   └── Favorite.js              # User ↔ Product favorites
├── controllers/
│   ├── authController.js        # Register, login, guest, profile
│   ├── productController.js     # CRUD + search + filters
│   └── favoriteController.js    # Save / remove favorites
├── routes/
│   ├── authRoutes.js
│   ├── productRoutes.js
│   └── favoriteRoutes.js
├── scripts/
│   └── seedProducts.js          # Load CSV → MongoDB + create admin
├── integrations/
│   └── voice_team/              # Team voice/text artifacts (unchanged)
│       ├── alt_faiss_index.bin
│       ├── alt_doc_map.pkl
│       ├── omnifind.py
│       ├── vad_stt.py
│       └── modal_app.py
├── data/
│   ├── Amazon-Products-100.csv
│   └── product_images/
└── frontend/                    # React app (Vite)
    ├── src/
    │   ├── App.jsx              # Routing & navbar
    │   ├── api.js               # API helper (all fetch calls)
    │   ├── context/AuthContext.jsx  # Auth state management
    │   └── pages/
    │       ├── LoginPage.jsx    # Login / Register / Guest
    │       ├── ProductsPage.jsx # Browse, search, filter, favorites
    │       ├── FavoritesPage.jsx# Saved products
    │       └── AdminPage.jsx    # Add/delete products, create admins
    ├── index.html
    ├── vite.config.js           # Proxy /api → localhost:5000
    └── package.json
```

---

## Troubleshooting

| Problem                              | Fix                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `MongoDB connection error: bad auth` | Check your `.env` password is correct                                                                |
| `MongoDB connection error: network`  | Go to MongoDB Atlas → Network Access → Add your IP (or `0.0.0.0/0` for dev)                          |
| Frontend shows "Loading..." forever  | Make sure the backend is running on port 5000                                                        |
| `ENOENT: package.json not found`     | Make sure you're in the right directory (`OmniFind/` for backend, `OmniFind/frontend/` for frontend) |
| `npm run seed` inserts 0 products    | Make sure `data/Amazon-Products-100.csv` exists                                                      |

---

## Tech Stack

- **Backend:** Node.js, Express, Mongoose, JWT (jsonwebtoken), bcryptjs
- **Frontend:** React, React Router, Vite
- **Database:** MongoDB Atlas
