# Reproducible image for the private single-instance deployment.
#
# Dependencies come from the committed lockfile, the production build never
# opens SQLite, the runtime stage runs as an unprivileged user and no
# credential or personal path is baked into a layer: every deployment value
# arrives from the environment at run time. Pin NODE_IMAGE to a digest in the
# deployment environment when byte-identical rebuilds are required.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# The build runs without DATABASE_PATH or DEMO_DATABASE_PATH on purpose: it
# must not open, create or read any SQLite file.
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Europe/Madrid \
    HOST=0.0.0.0 \
    PORT=3000 \
    ALLOW_NON_LOOPBACK_BIND=true \
    DATABASE_PATH=/data/personal/personal-finance.db \
    DEMO_DATABASE_PATH=/data/demo/personal-finance-demo.db

# HOST binds every interface of the private container network namespace only.
# Compose publishes the port on the host loopback address, so the service is
# never reachable from outside the machine or the private VPN.

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json package-lock.json next.config.ts tsconfig.json ./
COPY db ./db
COPY src ./src
COPY scripts ./scripts

# Separate durable directories for the personal and the demonstration files.
# A named volume mounted on an existing directory inherits this ownership, so
# the unprivileged runtime user can write after a fresh `compose up`.
RUN mkdir -p /data/personal /data/demo \
    && chown -R node:node /data /app/.next

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then((response)=>{process.exit(response.ok?0:1)}).catch(()=>{process.exit(1)})"

ENTRYPOINT ["/app/scripts/container/entrypoint.sh"]
