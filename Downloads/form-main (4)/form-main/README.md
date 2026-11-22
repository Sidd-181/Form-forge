# FormForge

React + Vite + Tailwind frontend (`/`) and Express + MongoDB backend (`/server`), implemented in JavaScript and JSX. All phases are in this one project.

## Run it
1. MongoDB running locally (or an Atlas URI).
2. Copy `.env.example` to `.env.local` in the project root and set `VITE_CLERK_PUBLISHABLE_KEY` from the Clerk Dashboard.
3. Copy `server/.env.example` to `server/.env`; set `MONGODB_URI`, `CLERK_PUBLISHABLE_KEY` (the same publishable key), and `CLERK_SECRET_KEY`. Run `npm install` in `server`.
4. Install frontend dependencies in the project root with `npm install`, then run `npm run dev` (frontend on port 5173, API on port 4000).

The development command starts both services; the API must connect to MongoDB before signup or login can work. Check `http://localhost:4000/api/health` for `{"ok":true}` if the browser reports a gateway error. The frontend defaults to `/api`; set `VITE_API_PROXY_TARGET` if the backend is not at `http://localhost:4000`. To run only the frontend, use `npm run dev:web`. The backend reads only `server/.env` (or its deployment environment); frontend settings belong in the root `.env.local`.

When deploying frontend and backend separately, set the frontend build variable `VITE_API_BASE_URL` to the backend origin (for example `https://api.example.com`) or its `/api` URL. Set the backend `CLIENT_ORIGIN` to the frontend origin so browser requests are allowed by CORS. Rebuild the frontend after changing `VITE_API_BASE_URL`.

## Tests
Run the focused validation/component suite with `npm test` from `server`. Run the public submission/upload end-to-end test with `npm run test:e2e` from `server`; it requires the configured MongoDB and Clerk environment and creates then removes a temporary test form and upload.

## Authentication and account migration
Sign-in, sign-up, and password recovery are handled by Clerk. The frontend uses `VITE_CLERK_PUBLISHABLE_KEY`; the backend requires `CLERK_SECRET_KEY` and the same publishable key as `CLERK_PUBLISHABLE_KEY`. Never put `CLERK_SECRET_KEY` in a frontend environment file. Configure these through Clerk for each deployment environment. Existing FormForge accounts are linked to Clerk only after a user signs in with a verified primary email that matches the saved account. Existing passwords are not imported, so users must create or recover their password through Clerk.

## Uploads
Set `UPLOAD_DIR` in the backend environment to a private, persistent directory (the default is `server/uploads`). `MAX_UPLOAD_SIZE_BYTES` configures the global upload cap (default 10 MB); a file field's optional maximum size applies as a stricter per-field cap. The public form supplies this configured limit to the browser, and the backend rejects files over either limit before storage. PNG, JPEG, and PDF files are stored outside the public web root and downloadable only by the form owner. Back up this directory along with the MongoDB database.

## What each phase added
| Phase | Where |
|---|---|
| 1-2 Design system, layout, routing, dashboard | `src/components/ui.jsx`, `AppLayout.jsx`, `src/pages/Dashboard.jsx` |
| 3 Templates and form editor | `src/pages/CreateForm.jsx`, `Editor.jsx`, `EditorPanels.jsx`, `src/services/templates.js`, `fieldTypes.js` |
| Backend and API connection, auth | `server/`, `src/services/api.js`, `src/store/index.js`, `src/pages/Auth.jsx` |
| 4 Preview, share, public form | `Preview.jsx`, `Share.jsx`, `PublicForm.jsx`, `src/components/FormRenderer.jsx` |
| 5 Responses and analytics | `Responses.jsx`, `Analytics.jsx`, `src/services/responses.js` |
| 6 Landing page and settings | `Landing.jsx`, `Settings.jsx`, `src/services/theme.js`, `server/src/routes/settings.js` |
