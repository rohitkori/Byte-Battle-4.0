import asyncio
import re
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


app = FastAPI(title="NLP Query API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
BASE_DIR = Path(__file__).resolve().parent
OUTPUTS_DIR = BASE_DIR / "outputs"
STDERR_DIR = BASE_DIR / "stderr"
SESSION_ID_PATHS = (
    BASE_DIR / "session_id.txt",
    STDERR_DIR / "session_id.txt",
)
QUERY_TIMEOUT_SECONDS = 300
IST = ZoneInfo("Asia/Kolkata")


class QueryRequest(BaseModel):
    query: str


class QueryResponse(BaseModel):
    output: str
    session_id: str
    command: list[str]
    returncode: int
    stdout: str
    stderr: str
    output_file: str
    stderr_file: str


def read_session_id() -> str:
    for path in SESSION_ID_PATHS:
        if not path.exists():
            continue

        session_id = path.read_text(encoding="utf-8").strip()
        if session_id:
            return session_id

    search_paths = ", ".join(str(path) for path in SESSION_ID_PATHS)
    raise FileNotFoundError(f"session id not found in: {search_paths}")


def run_db_query(query_text: str) -> subprocess.CompletedProcess[str]:
    session_id = read_session_id()
    command = [
        "codex",
        "exec",
        "resume",
        "--dangerously-bypass-approvals-and-sandbox",
        session_id,
        "-c", "service_tier=\"fast\"",
        f"$db {query_text}",
    ]
    return subprocess.run(
        command,
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        timeout=QUERY_TIMEOUT_SECONDS,
        check=False,
    )


def human_friendly_output(stdout: str) -> str:
    output = stdout.strip()
    output = re.sub(r"`([^`]*)`", r"\1", output)
    output = re.sub(r"\*\*([^*]+)\*\*", r"\1", output)
    output = re.sub(r"\*([^*]+)\*", r"\1", output)
    output = re.sub(r"^final answer:\s*", "", output, flags=re.IGNORECASE)
    output = re.sub(r"\n{3,}", "\n\n", output)
    return output.strip()


def build_timestamped_file_paths() -> tuple[Path, Path]:
    now = datetime.now(IST)
    filename = now.strftime("%m-%d %H:%M:%S") + f":{now.microsecond // 1000:03d}.txt"
    return OUTPUTS_DIR / filename, STDERR_DIR / filename


@app.post("/query")
async def query(request: QueryRequest) -> QueryResponse:
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="query must not be empty")

    try:
        result = await asyncio.to_thread(run_db_query, request.query.strip())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=504,
            detail=f"query timed out after {QUERY_TIMEOUT_SECONDS} seconds",
        ) from exc

    output_file, stderr_file = build_timestamped_file_paths()
    output_file.parent.mkdir(parents=True, exist_ok=True)
    stderr_file.parent.mkdir(parents=True, exist_ok=True)
    formatted_output = human_friendly_output(result.stdout)
    output_file.write_text(formatted_output, encoding="utf-8")
    stderr_file.write_text(result.stderr, encoding="utf-8")
    output = output_file.read_text(encoding="utf-8")

    return QueryResponse(
        output=output,
        session_id=result.args[4],
        command=result.args,
        returncode=result.returncode,
        stdout=result.stdout,
        stderr=result.stderr,
        output_file=str(output_file),
        stderr_file=str(stderr_file),
    )
