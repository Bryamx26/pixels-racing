# --- Étape 1 : compilation du client (Vite) ------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Étape 2 : image d'exécution (serveur Node + client compilé) ---------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY package.json package-lock.json ./
# Seules les dépendances d'exécution (tsx, ws), élaguées à l'étape 1.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/shared ./src/shared
COPY src/server ./src/server
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" > /dev/null || exit 1
CMD ["npx", "tsx", "src/server/index.ts"]
