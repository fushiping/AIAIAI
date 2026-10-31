FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV PORT=18930

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY docs ./docs
COPY README.md ./

RUN mkdir -p data storage/files storage/covers \
    && chown -R node:node /app

USER node

EXPOSE 18930
VOLUME ["/app/data", "/app/storage"]

CMD ["node", "server/index.js"]
