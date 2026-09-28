FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY packages/contracts ./packages/contracts
COPY packages/sync-core ./packages/sync-core
COPY apps/sync-server ./apps/sync-server
RUN pnpm exec vite build --ssr apps/sync-server/src/main.ts --outDir apps/sync-server/dist

FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/apps/sync-server/dist ./apps/sync-server/dist
COPY apps/sync-server/migrations ./apps/sync-server/migrations
USER node
EXPOSE 8787
CMD ["node", "apps/sync-server/dist/main.js"]
