import asyncio
import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional, Union
from zoneinfo import ZoneInfo

import redis
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
CHATS_DIR = BASE_DIR / "chats"
QUERY_TIMEOUT_SECONDS = 300
IST = ZoneInfo("Asia/Kolkata")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_KEY_PREFIX = os.getenv("REDIS_KEY_PREFIX", "nlp-query-be:codex-session:")
OUTPUT_STYLE_INSTRUCTIONS = (
    "Answer only with the final user-facing result. "
    "Do not include reasoning, tool usage, assumptions, or process narration. "
    "Return strictly valid GitHub-flavored Markdown. "
    "For lists of records, use a Markdown table with a header row and separator row. "
    "Do not use numbered pipe-separated lines for tabular data. "
    "Do not wrap the answer in a code block unless the user explicitly asks for code."
)
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)


class QueryRequest(BaseModel):
    query: str
    session_id: Union[str, int]


class QueryResponse(BaseModel):
    output: str
    session_id: str
    command: list[str]
    returncode: int
    stdout: str
    stderr: str
    output_file: str
    stderr_file: str


def safe_session_id(session_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", session_id):
        raise HTTPException(status_code=400, detail="invalid session_id")

    return session_id


def redis_key(request_session_id: str) -> str:
    return f"{REDIS_KEY_PREFIX}{request_session_id}"


def get_codex_session_id(request_session_id: str) -> Optional[str]:
    return redis_client.get(redis_key(request_session_id))


def save_codex_session_id(request_session_id: str, codex_session_id: str) -> None:
    redis_client.set(redis_key(request_session_id), codex_session_id)


def build_codex_prompt(query_text: str) -> str:
    return f"{query_text}\n\n{OUTPUT_STYLE_INSTRUCTIONS}"


def build_codex_command(query_text: str, codex_session_id: Optional[str]) -> list[str]:
    prompt = build_codex_prompt(query_text)
    if codex_session_id:
        return [
            "codex",
            "exec",
            "resume",
            "--json",
            "--dangerously-bypass-approvals-and-sandbox",
            "-c", "service_tier=\"fast\"",
            codex_session_id,
            prompt,
        ]

    return [
        "codex",
        "exec",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "-c", "service_tier=\"fast\"",
        f"$db {prompt}",
    ]


def parse_codex_stdout(stdout: str) -> tuple[Optional[str], str]:
    codex_session_id = None
    agent_messages = []

    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") == "thread.started":
            codex_session_id = event.get("thread_id") or codex_session_id
            continue

        item = event.get("item")
        if event.get("type") == "item.completed" and item and item.get("type") == "agent_message":
            text = item.get("text")
            if text:
                agent_messages.append(text)

    return codex_session_id, agent_messages[-1] if agent_messages else ""


def run_db_query(query_text: str, request_session_id: str) -> tuple[subprocess.CompletedProcess[str], str]:
    codex_session_id = get_codex_session_id(request_session_id)
    command = build_codex_command(query_text, codex_session_id)
    result = subprocess.run(
        command,
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        timeout=QUERY_TIMEOUT_SECONDS,
        check=False,
    )

    parsed_codex_session_id, _ = parse_codex_stdout(result.stdout)
    resolved_codex_session_id = parsed_codex_session_id or codex_session_id
    if not resolved_codex_session_id:
        raise RuntimeError("Codex did not return a session id")

    if not codex_session_id:
        save_codex_session_id(request_session_id, resolved_codex_session_id)

    return result, resolved_codex_session_id


def human_friendly_output(stdout: str) -> str:
    output = stdout.strip()
    output = re.sub(r"`([^`]*)`", r"\1", output)
    output = re.sub(r"\*\*([^*]+)\*\*", r"\1", output)
    output = re.sub(r"\*([^*]+)\*", r"\1", output)
    output = re.sub(r"^final answer:\s*", "", output, flags=re.IGNORECASE)
    output = re.sub(
        r"(?is)^(i('|’)ll|i will|i('|’)m|i am|let me)\b.*?\n\s*\n",
        "",
        output,
        count=1,
    )
    output = re.sub(r"\n{3,}", "\n\n", output)
    return output.strip()


def codex_stdout_events_json(stdout: str) -> str:
    events = []
    for line in stdout.splitlines():
        if not line.strip():
            continue

        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            events.append({"type": "raw_stdout", "text": line})

    return json.dumps(events, ensure_ascii=False, indent=2)


def chat_file_path(session_id: str) -> Path:
    return CHATS_DIR / f"{safe_session_id(session_id)}.json"


def read_chat_history(session_id: str) -> dict:
    path = chat_file_path(session_id)
    if not path.exists():
        return {"session_id": session_id, "chats": []}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"chat history is invalid json: {path}") from exc

    if not isinstance(data, dict) or not isinstance(data.get("chats"), list):
        raise HTTPException(status_code=500, detail=f"chat history has invalid shape: {path}")

    return data


def save_chat_turn(session_id: str, query_text: str, response_text: str) -> None:
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    history = read_chat_history(session_id)
    history["session_id"] = session_id
    history["chats"].append(
        {
            "request": query_text,
            "response": response_text,
            "timestamp": datetime.now(IST).isoformat(),
        }
    )
    chat_file_path(session_id).write_text(
        json.dumps(history, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def build_timestamped_file_paths() -> tuple[Path, Path]:
    now = datetime.now(IST)
    stem = now.strftime("%m-%d %H:%M:%S") + f":{now.microsecond // 1000:03d}"
    return OUTPUTS_DIR / f"{stem}.txt", STDERR_DIR / f"{stem}.json"


@app.post("/query")
async def query(request: QueryRequest) -> QueryResponse:
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="query must not be empty")

    request_session_id = str(request.session_id).strip()
    if not request_session_id:
        raise HTTPException(status_code=400, detail="session_id must not be empty")

    try:
        result, codex_session_id = await asyncio.to_thread(
            run_db_query,
            request.query.strip(),
            request_session_id,
        )
    except redis.RedisError as exc:
        raise HTTPException(status_code=503, detail=f"redis error: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=504,
            detail=f"query timed out after {QUERY_TIMEOUT_SECONDS} seconds",
        ) from exc

    output_file, stderr_file = build_timestamped_file_paths()
    output_file.parent.mkdir(parents=True, exist_ok=True)
    stderr_file.parent.mkdir(parents=True, exist_ok=True)
    _, codex_output = parse_codex_stdout(result.stdout)
    formatted_output = human_friendly_output(codex_output or result.stdout)
    output_file.write_text(formatted_output, encoding="utf-8")
    # Codex --json writes the detailed event stream to stdout.
    stderr_file.write_text(codex_stdout_events_json(result.stdout), encoding="utf-8")
    output = output_file.read_text(encoding="utf-8")
    save_chat_turn(request_session_id, request.query.strip(), output)

    return QueryResponse(
        output=output,
        session_id=codex_session_id,
        command=result.args,
        returncode=result.returncode,
        stdout=result.stdout,
        stderr=result.stderr,
        output_file=str(output_file),
        stderr_file=str(stderr_file),
    )


@app.get("/chat/{session_id}")
async def get_chat(session_id: str) -> JSONResponse:
    path = chat_file_path(session_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="chat session not found")

    return JSONResponse(read_chat_history(session_id))
