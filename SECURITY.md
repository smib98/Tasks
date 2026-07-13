# Security

NoteTasks is a local-first, single-user application. It does not include authentication or tenant
isolation, so keep the default `127.0.0.1` host unless every device on your local network is trusted.
Do not expose the app directly to the public internet.

Keep secrets in `config.ini`, which is ignored by Git. Never commit API keys, generated certificates,
SQLite databases or `.env` files. If a secret is committed accidentally, revoke it before removing it
from Git history.

Please report security issues privately to the repository owner rather than opening a public issue.
