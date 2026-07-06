FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
RUN chmod 755 /app /app/server /app/scripts \
  && chmod 644 /app/server/index.mjs /app/scripts/check-server.mjs

EXPOSE 8787

CMD ["node", "server/index.mjs"]
