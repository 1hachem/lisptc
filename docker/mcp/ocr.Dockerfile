# syntax=docker/dockerfile:1
FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN npm install --global turbo@2.10.5 pnpm@10.28.0
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune @lisptc/mcp-toolkit --docker

FROM base AS prod
ENV NODE_ENV=production
RUN npm install --global supergateway@3.4.3 \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs --home /home/lisptc lisptc
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm fetch --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm install --frozen-lockfile --offline --ignore-scripts
COPY --from=pruner --chown=lisptc:nodejs /app/out/full/ .
USER lisptc
WORKDIR /app/apps/mcp-toolkit
EXPOSE 8000
CMD ["supergateway", "--stdio", "node --no-warnings --experimental-transform-types src/ocr/server.ts", "--outputTransport", "streamableHttp", "--stateful", "--port", "8000", "--streamableHttpPath", "/mcp"]
