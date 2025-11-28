FROM node:18-alpine

# Install Docker CLI, Git, and Cloudflared
RUN apk add --no-cache docker-cli curl git && \
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared

WORKDIR /app

# Copy backend files
COPY package*.json ./
RUN npm install --omit=dev
RUN npm install ngrok
COPY server.js ./
COPY public/ ./public/

EXPOSE 3000

CMD ["npm", "start"]