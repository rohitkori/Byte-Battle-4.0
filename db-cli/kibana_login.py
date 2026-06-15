import json
import subprocess

from env_config import get_kbn_version, get_token_filename, get_url, get_var


def login():
    print("Logging in to staging ES...")

    username = get_var("KIBANA_USERNAME")
    password = get_var("KIBANA_PASSWORD")
    kibana_url = get_url("kibana")
    kbn_version = get_kbn_version()
    token_file = get_token_filename("es_sid.txt")

    if not username or not password:
        raise Exception("KIBANA_USERNAME_STAGING and KIBANA_PASSWORD_STAGING must be set")

    url = f"{kibana_url}/internal/security/login"
    payload = {
        "providerType": "basic",
        "providerName": "basic",
        "currentURL": f"{kibana_url}/login",
        "params": {
            "username": username,
            "password": password,
        },
    }

    result = subprocess.run(
        [
            "curl",
            "-s",
            "-k",
            "-X",
            "POST",
            url,
            "-H",
            "content-type: application/json",
            "-H",
            f"kbn-version: {kbn_version}",
            "-d",
            json.dumps(payload),
            "-c",
            "-",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    token = None
    for line in result.stdout.splitlines():
        if "\tsid\t" in line:
            token = line.split("\t")[-1].strip()
            break

    if not token:
        raise Exception("ES login failed: no sid cookie returned")

    token_file.write_text(token)
    print(f"Session ID saved to {token_file}")
    return token


if __name__ == "__main__":
    login()
