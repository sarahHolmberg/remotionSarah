# Dockerfile  (path: project root)
# NEW FILE: the container Cloud Run runs. Cloud Build builds it from this repo, no Docker needed in the Codespace.
#   gcloud run deploy remotion-render --source . ...
# Inside: the editor + preview pages (dist/), the Remotion bundle (build/), and server/server.mjs on port 8080.

FROM node:22-bookworm-slim

# the libraries the render browser needs (same list as setup.sh, Debian names) + emoji font
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libasound2 libxrandr2 libxkbcommon0 \
    libxfixes3 libxcomposite1 libxdamage1 libgbm1 libcups2 libpango-1.0-0 libcairo2 fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# npm packages first, so a code change does not reinstall them
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
RUN npx remotion browser ensure

# the code, then build both halves once
COPY . .
RUN npm run app:build && npm run bundle

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/server.mjs"]
