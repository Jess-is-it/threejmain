# App Shell

The app shell is the shared admin experience for the ISP management system.

## Stack

- Frontend: React + Vite + Tabler
- Backend: FastAPI
- Database target: PostgreSQL
- Web port: `8180`
- API port: `8100`

## Local Development

Backend:

```bash
cd app-shell/api
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
```

Frontend:

```bash
cd app-shell/web
npm install
npm run dev
```

Open:

```text
http://localhost:8180
```

Default local credentials:

```text
admin / admin123
```

Change the password before any real deployment.
