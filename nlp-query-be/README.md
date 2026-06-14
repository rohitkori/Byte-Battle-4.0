# NLP Query API

Minimal FastAPI service that submits natural-language database questions through
Codex using the `$db` skill.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --reload
```

The API will be available at `http://127.0.0.1:8000`.

## Run With Multiple Processes

```bash
gunicorn main:app -k uvicorn.workers.UvicornWorker --workers 4 --bind 0.0.0.0:9000
```

Adjust `--workers` based on the number of CPU cores available.

## Endpoint

### `POST /query`

Request body:

```json
{
  "query": "get count of yesterdays leads"
}
```

Response:

```json
{
  "output": "Yesterday's leads count for June 10, 2026 IST is 3,252."
}
```