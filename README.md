# Personal Finance Tracker

Personal Finance Tracker is a private web application for keeping a clear view
of everyday finances without turning money tracking into a chore. It is designed
for personal use and focuses on making each income or expense quick to record
and easy to understand later.

Transactions can be organized with categories and optional tags, reviewed over
any date range, and explored through a visual dashboard. The dashboard will show
income, expenses, net balance, spending patterns, and monthly averages. Regular
payments such as rent, subscriptions, or salary can also be scheduled to appear
automatically every month.

The first version deliberately keeps the scope small. It starts with one person,
one shared pool of money, and manual or recurring transactions. Bank
synchronization, file imports, investments, and multiple accounts may be
considered in future versions, but they are not part of the initial product.

Privacy is central to the project. The application is intended to remain
privately hosted and accessible only by its owner rather than being offered as a
public service.

## Project status

The MVP definition has been completed and accepted. The initial application
scaffolding is in place and product development is ready to begin.

## Product documentation

The documentation is currently the source of truth for the project:

- [Documentation index and conventions](docs/README.md)
- [Functional design](docs/01-diseno-funcional.md)
- [Technical design](docs/02-diseno-tecnico.md)
- [Technology stack](docs/03-stack-tecnologico.md)
- [Visual and UX design](docs/04-diseno-visual-ux.md)
- [Testing and QA](docs/05-tests-qa.md)
- [Implementation plan](docs/06-plan-implementacion.md)

## Product principles

1. Keep personal financial data private and under the owner's control.
2. Make manual transaction entry possible in under 15 seconds.
3. Present useful and traceable information instead of decorative charts.
4. Keep manual and recurring transaction workflows simple.
5. Grow progressively without adding banking or investment complexity too soon.

## Next milestone

Create the first functional prototype using the documented visual conventions
and complete the remaining decisions from phase 0 of the
[implementation plan](docs/06-plan-implementacion.md).

## Private deployment

The private deployment runs a single application container with SQLite on local
disk. Configuration and credentials come from a `.env` file on the host, which
is never committed and never copied into an image layer.

```bash
cp .env.example .env   # then set APP_URL and the host port
docker compose up -d --build
```

What the templates guarantee:

- one unprivileged runtime user (`node`), no capabilities and no privilege
  escalation;
- one durable volume for the personal database and a separate one for the
  isolated demonstration database, so recreating the container keeps both;
- the port is published on `127.0.0.1` only, so remote access depends on the
  private VPN or a local reverse proxy, never on this file;
- the image build never opens SQLite; migrations run at container start.

Every start runs the same ordered sequence before the server accepts requests:
migrate and bootstrap the personal database, migrate the demonstration
database, catch up the missed monthly due dates, then serve. A failed step
exits non-zero and the container never serves a half-migrated database.
`docker compose down` stops the container and keeps both volumes;
`docker compose up -d` recreates it with the same data.

The same sequence runs locally against the built application:

```bash
npm run build
npm run start:server
```

Remote access over the private VPN and the daily schedulers are operated outside
this repository. The [private Tailscale operations
runbook](operations/README.md) provides installation templates and the required
owner-observed smoke evidence for HTTPS access, recurrence scheduling and the
encrypted backup.

`npm run backup:run` writes a consistent SQLite snapshot, encrypts it with
AES-256-GCM and uploads it to the configured destination before applying a
7 daily / 4 weekly / 12 monthly retention over the artifacts it owns. It exits
non-zero when the artifact did not reach the destination. The key never lives
in this repository: it is read from an owner-installed file, and the provider,
path and key of a real deployment are an owner decision documented in the
runbook.

## Local development

The project requires Node.js 24 and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000` to view the application. Run all local quality
checks with:

```bash
npm run check
```
