# Backend da Farol FM em contêiner (Railway, Fly.io, VPS com Docker…)
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/farol.db
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
