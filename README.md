# PromptGuard — Prompt Compressor with Equivalence Proof

A full-stack prototype for compressing prompts while preserving protected instructions and empirically testing original/compressed outputs on the same test inputs.

## Features

- React dashboard, prompt editor, protected-span selection, text upload, test cases, variant selection, run history, CSV export, and configurable cost estimator.
- FastAPI REST API with Swagger at `/docs`, Pydantic validation, JWT authentication, bcrypt password hashing, and analyst/viewer/admin authorization checks.
- SQLAlchemy persistence. SQLite is the local zero-setup default; set `DATABASE_URL` to PostgreSQL for a shared deployment.
- Three compression variants. With `OPENAI_API_KEY` set they use the configured OpenAI-compatible chat-completions API; without it, safe rule-based variants remain available. Equivalence execution requires an API key and returns a clear configuration error otherwise.
- tiktoken token counts, Sentence Transformers semantic similarity (with an explicitly reported lexical fallback if the model cannot load), and rule checks blended 70/30.

Equivalence is empirical over the supplied test cases and is not a mathematical guarantee of identical behavior. Model APIs may be nondeterministic even when temperature and seed are held constant.

## Run locally

1. Copy `backend/.env.example` to `backend/.env`. Add an OpenAI-compatible API key to enable model-based compression and tests. The default local database is `backend/promptguard.db`.
2. In PowerShell, install backend dependencies and start the API:

   ```powershell
   cd backend
   py -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
   ```

3. In a second terminal, install and start the UI:

   ```powershell
   cd frontend
   npm.cmd install
   npm.cmd run dev
   ```

4. Open `http://localhost:5173`, register an analyst account, and add test cases. The API is at `http://localhost:8000/docs`.

Set `VITE_API_URL` when the API is hosted at a different origin. For PostgreSQL use a SQLAlchemy URL such as `postgresql+psycopg://user:password@localhost:5432/promptguard`.

New self-registered accounts have the analyst role. For the initial administrator, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `backend/.env` before first startup. Administrators can then assign analyst, viewer, and admin roles from the User access page or API.

Administrators can configure default model, equivalence threshold, and input/output prices. Prices start at zero and must be set by your workspace; the app does not assume or advertise current provider pricing. Every authenticated user can override these defaults per experiment.
