FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public
COPY views ./views

USER node
# Cloud Run injects PORT (8080 by default); server.js listens on process.env.PORT.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
