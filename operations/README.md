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

## Encrypted external backup and retention

`npm run backup:run` takes a consistent SQLite snapshot with `VACUUM INTO`,
encrypts it with AES-256-GCM and uploads it to the configured destination
before applying a 7 daily / 4 weekly / 12 monthly retention. The command exits
non-zero whenever the artifact did not reach the destination or retention could
not be applied, so a scheduler reports a failed backup instead of a silent gap.

### Owner decision required before a real deployment

Three choices belong to the project owner and are not made in this repository:

1. the destination provider and its exact path;
2. where the encryption key is generated, stored and rotated; and
3. who may read the destination and the key.

Only a `file://` destination is implemented. It fits an owner-mounted external
volume or a directory a provider agent synchronises off the VPS. A hosted
object store is refused with `unsupportedDestinationScheme` rather than guessed,
because its credential handling is part of the same decision. Until the owner
records those choices, treat this section as a verified local template, not as
evidence of an off-site backup.

### Key and destination

Generate the key on the host, never in the repository and never in a ticket:

```bash
sudo install -d -m 700 /etc/personal-finance-tracker
openssl rand -base64 32 | sudo tee /etc/personal-finance-tracker/backup.key >/dev/null
sudo chmod 600 /etc/personal-finance-tracker/backup.key
sudo chown __DEPLOYMENT_ACCOUNT__ /etc/personal-finance-tracker/backup.key
```

The command refuses a key file whose permissions grant any access to the group
or to other users, a key that is not 32 base64-encoded bytes, and any attempt
to pass key material inline through `BACKUP_ENCRYPTION_KEY`. The owner of the
key file must be the identity that runs the job; inside the container that is
the unprivileged `node` user, so the bind mount has to be readable by it.

Set the destination and the key path in the host `.env`, or pass them to the
scheduled run as the templates do:

```dotenv
BACKUP_PATH=/tmp/personal-finance-backup
BACKUP_DESTINATION_URI=file:///srv/personal-finance-backups
BACKUP_ENCRYPTION_KEY_FILE=/etc/personal-finance-tracker/backup.key
```

`BACKUP_PATH` is a private staging directory, created with owner-only
permissions, where the plaintext snapshot exists only while the run lasts. It
is removed whether the run succeeds or fails, so the unencrypted database never
survives outside the application volume.

### Daily schedule

Replace `__APP_DIRECTORY__`, `__BACKUP_DESTINATION_DIRECTORY__` and
`__BACKUP_KEY_FILE__` in `systemd/personal-finance-backup.service` (or in
`cron/personal-finance-backup`) and install them the same way as the recurring
job. `Persistent=true` runs a missed backup after the host returns. The backup
timer is deliberately scheduled after the recurring timer so a daily artifact
already contains the day's generated occurrences.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now personal-finance-backup.timer
sudo systemctl start personal-finance-backup.service
sudo journalctl -u personal-finance-backup.service -n 20 --no-pager
```

### What the run guarantees

- The snapshot is taken through SQLite itself while the application keeps
  writing, so it can never contain a half-applied transaction, and it is
  rejected if it fails `integrity_check` or `foreign_key_check`.
- The artifact is authenticated together with its own name, so a modified,
  truncated, renamed or foreign file fails to decrypt instead of restoring
  plausible but wrong data.
- The upload is committed with a rename, and retention runs only afterwards. A
  refused upload therefore leaves every existing valid backup in place and
  fails the run.
- Retention only ever considers files that carry this tool's name shape _and_
  its encrypted signature. Anything else in the destination — an operator note,
  a foreign backup, an interrupted `.partial` upload — is never deleted.
- Reports name the step and a closed reason code. They never print a database
  path, key material, an amount, a concept or a tag.

## Isolated restore verification and rollback

`npm run restore:verify -- /path/to/artifact.sqlite.enc` decrypts an owned
artifact into a fresh temporary directory, runs SQLite `integrity_check` and
`foreign_key_check`, applies the current migrations only to that disposable
copy, and compares transaction count, tag-association count, transaction total,
recurring-rule count and occurrence count before and after migration. It prints
only a closed status and the number of applied migrations; it never prints
paths, counts, totals, concepts, tags or key material.

The command never opens the configured personal or demonstration file for
writing and deletes its temporary plaintext copy on either success or failure.
A corrupt, renamed, foreign or incompatible artifact therefore exits non-zero
before any replacement step is available to an operator. Repository tests are a
temporary-data rehearsal, not evidence that a production artifact has been
restored.

### Explicit-authority replacement procedure

Replacing a real database is destructive work and requires the owner's explicit
authority for a maintenance window. Do not perform these steps against a live
host merely because a repository check passed:

1. Record the artifact name, intended database role, operator and approved
   window outside the repository. Confirm that the target is the personal
   database, never the isolated demonstration file.
2. Run `npm run restore:verify -- /path/to/artifact.sqlite.enc` in a disposable
   environment with the same migration files and the owner-installed key. Stop
   on any non-zero exit; do not retry by bypassing integrity, migration or
   count checks.
3. Take and independently verify a fresh encrypted pre-change backup using
   `npm run backup:run`. This is the rollback artifact for the change; stop if
   it fails to reach the owner-approved destination.
4. Stop the application cleanly and confirm that no process retains the SQLite
   file. Preserve the original file unchanged until the replacement has passed
   the same isolated verification and an operator has recorded the replacement
   action.
5. Start the application only after the operator has completed the approved
   replacement using its host-controlled recovery tooling. Check migration,
   recurrence catch-up and a harmless private-network read workflow before
   declaring recovery complete.
6. If the upgrade or smoke check fails, stop the application and repeat the
   isolated verification with the pre-change backup before the operator restores
   it. Do not use a backup whose verification failed, and do not delete either
   the failed target or the rollback artifact until recovery is evidenced.

This repository deliberately provides no unattended live-replacement command:
the host path, running process and replacement authority are external
operational decisions. Claim restore capability only after a dated rehearsal
records a successful isolated verification, controlled replacement, application
startup and business-count check with temporary or approved non-personal data.

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
- the operator confirms no Funnel configuration exists for this hostname;
- the backup timer is enabled with a future trigger, a manual run exits zero
  and writes exactly one new artifact to the owner-approved destination without
  printing a path or key material;
- an artifact downloaded from that destination decrypts with the installed key
  on a disposable host and passes `integrity_check`; and
- after nine consecutive daily runs the destination holds the expected retained
  set and every unrelated file the operator placed there is still present.
- a dated restore rehearsal records the artifact's successful isolated
  verification, a controlled replacement in a disposable environment, successful
  startup and matching business counts without recording financial data.

Record dates, command exit statuses, listener addresses, certificate hostname,
and redacted HTTP statuses. Do not record credentials, URLs containing private
tailnet names if those are sensitive, database paths, transaction data, or
device identifiers.
