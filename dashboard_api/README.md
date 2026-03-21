# PCU Dashboard API (FastAPI)

Initial Python backend for replacing Shiny iframe modules with native in-app dashboards.

## Local Run

1. Create/activate virtualenv.
2. Install deps:

```bash
pip install -r dashboard_api/requirements.txt
```

3. Set env vars:

```bash
export DASHBOARD_DATABASE_URL="postgresql://..."
export DASHBOARD_API_ALLOWED_ORIGINS="http://localhost:3000"
```

4. Start API:

```bash
uvicorn dashboard_api.app.main:app --host 127.0.0.1 --port 8001 --reload
```

## Endpoints

- `GET /health`
- `GET /v1/pitching/filters?school_code=OSU`
- `GET /v1/pitching/overview?school_code=OSU&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&pitcher=Name`
