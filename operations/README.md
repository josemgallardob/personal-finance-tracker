# Private Tailscale Operations Runbook

These are installation templates, not host configuration. An authorized
operator replaces every `__PLACEHOLDER__`, installs the resulting files under
the host's normal configuration directories, and records the observed smoke
evidence outside this repository. Do not copy `.env`, certificates, database
files, or mobile/device identities into this directory or into a ticket.

## Security boundary

The application has no sign-in screen. Its privacy boundary is therefore the
tailnet policy plus a host proxy that accepts traffic only on the server's
Tailscale address. Keep the Compose publication on `127.0.0.1`; do not change
it to a public or Tailscale bind.

1. Enroll the server in the intended tailnet and enable MagicDNS.
2. In the tailnet policy, allow only the named user/group or managed devices to
   reach this server on TCP 443. Do not grant the tailnet broadly by default.
3. On macOS and mobile, install Tailscale, sign in with an allowed identity,
   and confirm the device is approved according to the tailnet's device policy.
   The browser uses the MagicDNS name, never a raw LAN/public IP.
4. Never enable or run `tailscale funnel`. Funnel creates a public ingress and
   is incompatible with this private, unauthenticated deployment.

The proxy template binds only `__TAILSCALE_IPV4__`; obtain it from the host
with `tailscale ip -4`. Set `__TAILSCALE_DNS_NAME__` to the exact MagicDNS
hostname and issue the matching certificate with `tailscale cert
__TAILSCALE_DNS_NAME__`. Store the certificate and key outside the repository
with owner-only access, then replace their paths in `caddy/Caddyfile`.

Before an owner installs the proxy, coordinate the actual ports without
altering Orca or any other process:

```bash
sudo ss -ltnp '( sport = :443 or sport = :3000 )'
docker compose port app 3000
```

If either required address/port is owned, stop and have the service owner
choose a non-conflicting `APP_PORT` or proxy placement. Do not stop, reload,
reconfigure, or reuse an Orca service or port. Caddy listens at the Tailscale
address on HTTPS 443 and proxies only to the application's existing loopback
publication `127.0.0.1:__APP_PORT__`.

## Private HTTPS and Origin validation

Set the host `.env` values to the exact external origin before starting the
application:

```dotenv
APP_URL=https://__TAILSCALE_DNS_NAME__
APP_PORT=__APP_PORT__
```

`APP_URL` must use the same HTTPS hostname and port that a Mac or mobile
browser opens. State-changing requests with a missing, malformed, or different
`Origin` receive HTTP 403; a proxy must preserve the browser's `Origin`
header. Do not set `APP_URL` to `http://127.0.0.1` when the browser uses the
HTTPS tailnet name, because valid mutations would be refused.

## Daily recurring catch-up

Choose one scheduler, not both. The systemd timer is preferred because
`Persistent=true` runs a missed daily activation after the host returns; cron
does not have that catch-up property. Both templates run `docker compose run
--rm --no-deps --entrypoint npm app run recurring:run`, which obtains the
same `app` `env_file` and named personal/demo volumes from `compose.yml` and
does not publish ports.

For systemd, replace `__APP_DIRECTORY__` in the service template with the
absolute Compose project directory, install both files using the host's normal
unit process, then have the authorized operator run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now personal-finance-recurring.timer
systemctl list-timers personal-finance-recurring.timer
sudo systemctl start personal-finance-recurring.service
sudo journalctl -u personal-finance-recurring.service -n 20 --no-pager
```

For a dedicated deployment account without systemd, replace
`__APP_DIRECTORY__` in the cron file and install it with that account's
`crontab`. The cron template has no retry or boot catch-up guarantee; the
application startup sequence remains the recovery path in this fallback.

The recurrence command and server startup are idempotent. The timer can run
while the application is live because the SQLite recurrence uniqueness rule
prevents duplicate scheduled occurrences; a restart also migrates both files
and catches up overdue personal recurrences before accepting requests.

## Required observed smoke evidence

Repository checks can verify the templates but cannot prove a tailnet,
certificate, port ownership, timer, or mobile browser. Do not report this
deployment as complete until an authorized operator records all of the
following observed, redacted results:

- the installed timer is enabled, has a future trigger, and a manual service
  run exits successfully without printing a database path or financial data;
- after restarting the application, its startup logs show completed migration
  and recurrence catch-up before the ready event, and rerunning the catch-up
  creates no duplicate occurrence;
- an authorized macOS and an authorized mobile device each open
  `https://__TAILSCALE_DNS_NAME__` with a valid certificate and can perform
  one harmless state-changing workflow;
- an unauthorized tailnet identity/device cannot establish TCP 443, and a
  mutation sent with a different Origin is refused with HTTP 403;
- no listener is exposed on a public/LAN address: the app remains loopback-only
  and the proxy is bound only to the Tailscale IP; and
- the operator confirms no Funnel configuration exists for this hostname.

Record dates, command exit statuses, listener addresses, certificate hostname,
and redacted HTTP statuses. Do not record credentials, URLs containing private
tailnet names if those are sensitive, database paths, transaction data, or
device identifiers.
