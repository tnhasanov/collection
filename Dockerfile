# ATB Collections demo image: web app + background worker in one container (synthetic data, mock adapters).
# Used by render.yaml (Render) and works unchanged on Railway, Fly.io or any Docker host.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first (layer cache); dev dependencies are needed at runtime for prisma migrate, tsx (worker, seed).
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

# The build never connects to a database; a placeholder URL only satisfies the Prisma config loader.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["bash", "scripts/start-all.sh"]
