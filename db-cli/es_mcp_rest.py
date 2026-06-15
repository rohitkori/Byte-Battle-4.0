#!/usr/bin/env python3
from urllib.parse import quote

import requests
from mcp.server.fastmcp import FastMCP

from env_config import get_kbn_version, get_token_filename, get_url
from kibana_login import login


def get_kibana_url():
    return get_url("kibana")


def get_token_file():
    return get_token_filename("es_sid.txt")


mcp = FastMCP("elasticsearch-mcp")


def load_auth_token() -> str | None:
    token_file = get_token_file()
    if token_file.exists():
        return (token_file.read_text() or "").strip()
    return None


def save_auth_token(token: str):
    token_file = get_token_file()
    token_file.write_text(token.strip())


def build_headers(token: str) -> dict:
    kibana_url = get_kibana_url()
    kbn_version = get_kbn_version()
    return {
        "accept": "*/*",
        "content-type": "application/json",
        "kbn-build-number": "83335",
        "kbn-version": kbn_version,
        "origin": kibana_url,
        "referer": f"{kibana_url}/app/dev_tools",
        "user-agent": "Mozilla/5.0",
        "x-elastic-internal-origin": "Kibana",
        "Cookie": f"sid={token}",
    }


class AuthTokenRequired(Exception):
    def __init__(self):
        super().__init__("Authentication required")
        self.inputSchema = {
            "type": "object",
            "properties": {
                "sid": {
                    "type": "string",
                    "description": "Paste sid cookie value from browser cookies",
                }
            },
            "required": ["sid"],
        }


def get_or_save_auth_token(auth_token: str | None = None) -> str:
    if auth_token:
        save_auth_token(auth_token)
    token = auth_token or load_auth_token()
    if not token:
        token = login()
    return token


def run_query(url: str, data: dict, auth_token: str | None = None) -> dict:
    token = get_or_save_auth_token(auth_token)
    params = {
        "headers": build_headers(token),
        "timeout": 3000,
        "verify": False,
    }
    if data:
        params["json"] = data

    resp = requests.post(url, **params)
    try:
        if resp.status_code == 401 or "unauthorized" in resp.text.lower():
            token = login()
            params["headers"] = build_headers(token)
            resp = requests.post(url, **params)
    except Exception:
        raise AuthTokenRequired()

    return resp.json()


@mcp.tool()
def es_search(
    index: str,
    query: dict | None = None,
    aggs: dict | None = None,
    size: int = 10000,
    auth_token: str | None = None,
    source: list[str] | None = None,
    search_after: list[str] | None = None,
    sort: list[dict] | None = None,
) -> dict:
    """
    Run an Elasticsearch _search query through the staging Kibana proxy.
    """
    kibana_url = get_kibana_url()
    path = quote(f"{index}/_search", safe="")
    url = f"{kibana_url}/api/console/proxy?path={path}&method=GET"
    body = {"size": size}
    if query:
        body["query"] = query
    if aggs:
        body["aggs"] = aggs
    if source:
        body["_source"] = source
    if search_after:
        body["search_after"] = search_after
    if sort:
        body["sort"] = sort

    return run_query(url, body, auth_token)


@mcp.tool()
def es_mapping(index: str, auth_token: str | None = None) -> dict:
    """
    Get index mapping through the staging Kibana proxy.
    """
    kibana_url = get_kibana_url()
    path = quote(f"{index}/_mapping", safe="")
    url = f"{kibana_url}/api/console/proxy?path={path}&method=GET"
    return run_query(url, {}, auth_token)


@mcp.tool()
def es_indices(auth_token: str | None = None, include_system: bool = False) -> list:
    """
    List available indices through the staging Kibana proxy.
    """
    kibana_url = get_kibana_url()
    path = quote("_aliases", safe="")
    url = f"{kibana_url}/api/console/proxy?path={path}&method=GET"
    result = run_query(url, {}, auth_token)

    if isinstance(result, dict):
        indices = result.keys()
        if not include_system:
            indices = [index for index in indices if not index.startswith(".")]
        return sorted(indices)

    return result


if __name__ == "__main__":
    mcp.run()
