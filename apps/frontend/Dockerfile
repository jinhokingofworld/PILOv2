FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/out ./out
EXPOSE 3000
CMD ["node", "scripts/serve-out.mjs"]
