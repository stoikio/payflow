# PayFlow sandbox

Sandbox of the PayFlow payment API: bank debit mandates, charges and signed webhooks, with
accelerated time and test IBANs. API reference: [docs/api.md](docs/api.md).

## Start

With Node 24 and pnpm 12:

```sh
pnpm install
pnpm dev
```

With Docker:

```sh
docker compose up
```

The server listens on http://localhost:4010, with a read-only dashboard at
http://localhost:4010/dashboard. State is kept in SQLite (`data/payflow.db`, or the `data`
volume with Docker).

## Configuration

Defaults work out of the box. To change them, copy `.env.example` to `.env`; every variable is
documented there. The main ones:

| Variable                     | Default                                   |
| ---------------------------- | ----------------------------------------- |
| `PAYFLOW_API_KEY`            | `sk_sandbox_9f3c2e7a41b84d6f`             |
| `WEBHOOK_SECRET`             | `whsec_sandbox_5d1e8b3a9c7f4026`          |
| `WEBHOOK_BASE_URL`           | `http://localhost:3000` (`http://host.docker.internal:3000` with Docker) |
| `WEBHOOK_PATH`               | `/webhooks/payflow`                       |
| `SANDBOX_TRANSITION_SECONDS` | `5`                                       |
| `WEBHOOK_CHAOS`              | `false`                                   |

## Checks

```sh
pnpm test
pnpm typecheck
pnpm lint
```
