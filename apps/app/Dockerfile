FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN npm install --global turbo@2.10.5 pnpm@10.28.0
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune app --docker

FROM base AS dev
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm fetch --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm install --frozen-lockfile --offline
COPY --from=pruner /app/out/full/ .
EXPOSE 3000
WORKDIR /app/apps/app
CMD ["pnpm", "run", "dev", "--host", "127.0.0.1"]

FROM base AS builder
ARG VITE_API_URL
ARG VITE_CONVEX_URL
ARG VITE_ENVIRONMENT
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_SURVEY_ID
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm fetch --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=${PNPM_HOME}/store \
    pnpm install --frozen-lockfile --offline
COPY --from=pruner /app/out/full/ .
RUN turbo build -F app

FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS prod
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs lisptc

COPY --from=builder --chown=lisptc:nodejs /app/apps/app/.output ./.output

USER lisptc
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
