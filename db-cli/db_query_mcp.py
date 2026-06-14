#!/usr/bin/env python3
from urllib.parse import quote

import requests
from mcp.server.fastmcp import FastMCP

from anarock_login import login
from env_config import get_token_filename, get_url

API_URL = get_url("sql")
TOKEN_FILE = get_token_filename("auth_token.txt")

DB_ALIASES = {
    "digix": "anarock_digix_prod",
    "anarock_digix": "anarock_digix_prod",
    "marketing": "anarock_analytics",
    "analytics": "anarock_analytics",
    "leads": "anarock_leads_production",
    "lead": "anarock_leads_production",
    "anarock_leads": "anarock_leads_production",
    "anarock_lead": "anarock_leads_production",
    "lead_db": "anarock_leads_production",
    "calling": "anarock_calling_production",
    "telephony": "anarock_calling_production",
    "employee": "anarock_employee_production",
    "user": "anarock_employee_production",
    "users": "anarock_employee_production",
    "anarock_users": "anarock_employee_production",
    "anarock_user": "anarock_employee_production",
    "user_db": "anarock_employee_production",
    "user_table": "anarock_employee_production",
    "finance": "anarock_plutus_production",
    "plutus": "anarock_plutus_production",
    "genie": "genie",
    "llm": "genie",
    "genie_be": "genie",
    "genie-be": "genie",
}

mcp = FastMCP("db-query-mcp")


def load_auth_token() -> str | None:
    if TOKEN_FILE.exists():
        return (TOKEN_FILE.read_text() or "").strip()
    return None


def save_auth_token(token: str):
    TOKEN_FILE.write_text(token.strip())


def build_headers(token: str) -> dict:
    base_url = API_URL.removesuffix("/query")
    return {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/x-www-form-urlencoded",
        "origin": base_url,
        "referer": f"{base_url}/",
        "user-agent": "Mozilla/5.0",
        "Cookie": f"auth_token={token};sessionid=1",
    }


class AuthTokenRequired(Exception):
    def __init__(self):
        super().__init__("Authentication required")
        self.inputSchema = {
            "type": "object",
            "properties": {
                "auth_token": {
                    "type": "string",
                    "description": "Paste auth_token from browser cookies",
                }
            },
            "required": ["auth_token"],
        }


def get_or_save_auth_token(auth_token: str | None = None) -> str:
    if auth_token:
        save_auth_token(auth_token)
    token = auth_token or load_auth_token()
    if not token:
        token = login()
    return token


def call_run_query_api(data: str, auth_token: str | None = None) -> dict:
    token = get_or_save_auth_token(auth_token)
    resp = requests.post(
        API_URL,
        headers=build_headers(token),
        data=data,
        timeout=3000,
        verify=False,
    )
    if resp.status_code == 200 and "redirect_to=" in resp.text:
        token = login()
        resp = requests.post(
            API_URL,
            headers=build_headers(token),
            data=data,
            timeout=3000,
            verify=False,
        )
    return resp.json()


@mcp.tool()
def run_query(
    dbname: str,
    sql: str,
    auth_token: str | None = None,
    limit: int | None = None,
) -> dict:
    """
    Run a read-only SQL query against staging PostgreSQL databases.
    """
    dbname = DB_ALIASES.get(dbname, dbname)
    safe_sql = sql

    if limit is not None and "limit" not in sql.lower():
        safe_sql = f"{sql.rstrip(';')} limit {limit}"
    elif (
        "where" not in sql.lower()
        and "group by" not in sql.lower()
        and "limit" not in sql.lower()
    ):
        safe_sql = f"{sql.rstrip(';')} limit 10000"

    payload = f"dbname={dbname}&sql={quote(safe_sql)}"
    return call_run_query_api(payload, auth_token)


if __name__ == "__main__":
    mcp.run()
