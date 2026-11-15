# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4
WORKDIR /opt/corilo
COPY --chmod=0644 package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --ignore-scripts --omit=dev --no-audit --no-fund --strict-ssl=true && npm cache clean --force
COPY --chmod=0644 app/host/agent.mjs app/host/vault.mjs ./app/host/
COPY --chmod=0644 app/cloud/worker/main.mjs app/cloud/worker/model-bridge.mjs ./app/cloud/worker/
# Build contexts may use restrictive modes; code must be traversable by the worker.
RUN chmod 0755 /opt/corilo/app /opt/corilo/app/host /opt/corilo/app/cloud /opt/corilo/app/cloud/worker
USER 1000:1000
WORKDIR /knowledge
ENTRYPOINT ["node", "/opt/corilo/app/cloud/worker/main.mjs"]
