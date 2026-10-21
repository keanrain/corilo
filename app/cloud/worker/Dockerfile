# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4
WORKDIR /opt/corilo
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --ignore-scripts --omit=dev --no-audit --no-fund --strict-ssl=true && npm cache clean --force
COPY app/host/agent.mjs app/host/vault.mjs ./app/host/
COPY app/cloud/worker/main.mjs ./app/cloud/worker/main.mjs
USER 1000:1000
WORKDIR /knowledge
ENTRYPOINT ["node", "/opt/corilo/app/cloud/worker/main.mjs"]
