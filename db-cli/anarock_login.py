import requests

from env_config import get_token_filename, get_url, get_var


def login():
    print("Logging in to Anarock staging...")

    email = get_var("ANAROCK_EMAIL")
    password = get_var("ANAROCK_PASSWORD")
    url = get_url("auth")
    token_file = get_token_filename("auth_token.txt")

    payload = {"email": email, "password": password}
    headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "App-Name": "com.anarock.agentsapp.staging",
    }

    response = requests.request("POST", url, headers=headers, json=payload, verify=False)

    auth_token = None
    try:
        data = response.json()
        token_data = data.get("response", {}).get("auth_token")

        if isinstance(token_data, dict):
            auth_token = token_data.get("agentApp")
            if not auth_token and token_data:
                auth_token = next(iter(token_data.values()))
        elif isinstance(token_data, str):
            auth_token = token_data
    except ValueError:
        pass
    print(response.text)
    if not auth_token:
        auth_token = response.cookies.get("auth_token")

    if not auth_token:
        raise Exception(f"Login failed: No auth_token in response. Status: {response.status_code}")

    token_file.write_text(auth_token)
    print(f"Token saved to {token_file}")
    return auth_token


if __name__ == "__main__":
    login()
