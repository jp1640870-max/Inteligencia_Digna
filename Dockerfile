FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV JWT_SECRET=build-only-secret-for-next-build-32-chars
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV OLLAMA_URL=http://127.0.0.1:1
ENV OLLAMA_CHAT_MODEL=build-placeholder
ENV OLLAMA_AGENT_MODEL=build-placeholder
ENV OLLAMA_EMBEDDING_MODEL=build-placeholder

RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build /app ./

EXPOSE 3000

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
