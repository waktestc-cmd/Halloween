# Escape the Convent: one small Node container (fits Cloud Run).
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
