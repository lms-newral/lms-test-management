# Stage 1: dependencies. pandoc is needed at runtime by the Word importer.
FROM node:20-alpine AS deps

ARG PANDOC_VERSION=3.9.0.2

RUN apk add --no-cache python3 make g++ gcc libstdc++ wget tar
RUN wget -q https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz && \
    tar -xzf pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz && \
    mv pandoc-${PANDOC_VERSION}/bin/pandoc /usr/local/bin/ && \
    chmod +x /usr/local/bin/pandoc && \
    rm -rf pandoc-${PANDOC_VERSION}*

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npm ci --legacy-peer-deps
RUN npx prisma generate

# Stage 2: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --production --legacy-peer-deps

# Stage 3: runtime
FROM node:20-alpine AS production
RUN apk add --no-cache libstdc++ dumb-init
WORKDIR /app
COPY --from=deps /usr/local/bin/pandoc /usr/local/bin/pandoc
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/prisma.config.ts ./
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

USER nestjs
EXPOSE 5757
ENTRYPOINT ["dumb-init", "--"]
# Run `npx prisma migrate deploy` before starting a new version -- never
# `prisma db push` against a database holding real data.
CMD ["node", "dist/src/main.js"]
