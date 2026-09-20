FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN npm install --global turbo@2.10.5 pnpm@10.28.0
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune api --docker

FROM base AS dev
ENV XDG_CONFIG_HOME=/data
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm fetch --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm install --frozen-lockfile --offline
COPY --from=pruner /app/out/full/ .
RUN mkdir -p /data
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["pnpm", "run", "dev", "--host", "127.0.0.1"]

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm fetch --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm install --frozen-lockfile --offline
COPY --from=pruner /app/out/full/ .
RUN turbo build -F api
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm install --frozen-lockfile --offline --prod --ignore-scripts

FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS prod
ENV NODE_ENV=production
ENV XDG_CONFIG_HOME=/data
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs lisptc \
 && mkdir -p /data && chown lisptc:nodejs /data

COPY --from=builder --chown=lisptc:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=lisptc:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=lisptc:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=lisptc:nodejs /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=lisptc:nodejs /app/package.json /app/pnpm-workspace.yaml ./

USER lisptc
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/index.js"]
