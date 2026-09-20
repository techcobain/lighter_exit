FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_* vars are baked into the bundle at build time.
ARG VITE_LIGHTER_API_BASE
ARG VITE_LIGHTER_CONTRACT
ARG VITE_LIGHTER_CHAIN_ID
ARG VITE_API_KEY_INDEX
ARG VITE_ETH_RPC_URL
ARG VITE_WALLETCONNECT_PROJECT_ID
ENV VITE_LIGHTER_API_BASE=$VITE_LIGHTER_API_BASE \
    VITE_LIGHTER_CONTRACT=$VITE_LIGHTER_CONTRACT \
    VITE_LIGHTER_CHAIN_ID=$VITE_LIGHTER_CHAIN_ID \
    VITE_API_KEY_INDEX=$VITE_API_KEY_INDEX \
    VITE_ETH_RPC_URL=$VITE_ETH_RPC_URL \
    VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
USER node
CMD ["node", "server/index.mjs"]
