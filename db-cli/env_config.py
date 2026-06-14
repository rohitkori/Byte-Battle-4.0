#!/usr/bin/env python3
"""Staging-only configuration for the PostgreSQL query tools."""
import os
from pathlib import Path

from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).parent

load_dotenv(SCRIPT_DIR / ".env")

DEFAULTS = {
    "ANAROCK_AUTH_URL_STAGING": "https://employee.beta.staging.anarock.com/api/v0/authenticate",
    "SQL_QUERY_URL_STAGING": "https://marketing-dashboards.staging.anarock.com/query",
}


def get_var(name: str, default: str | None = None) -> str | None:
    return os.environ.get(f"{name}_STAGING", default)


def get_url(type_: str) -> str:
    urls = {
        "auth": os.environ.get("ANAROCK_AUTH_URL_STAGING", DEFAULTS["ANAROCK_AUTH_URL_STAGING"]),
        "sql": os.environ.get("SQL_QUERY_URL_STAGING", DEFAULTS["SQL_QUERY_URL_STAGING"]),
    }
    return urls.get(type_, "")


def get_token_filename(base_name: str) -> Path:
    return SCRIPT_DIR / base_name.replace(".txt", "_staging.txt")


ANAROCK_EMAIL = lambda: get_var("ANAROCK_EMAIL")
ANAROCK_PASSWORD = lambda: get_var("ANAROCK_PASSWORD")
