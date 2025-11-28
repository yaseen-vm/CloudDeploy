FROM node:18-alpine

# Install Docker CLI, Git, and Cloudflared with architecture detection
RUN apk add --no-cache docker-cli curl git wget && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; \
    elif [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; \
    else ARCH="amd64"; fi && \
    echo "Downloading cloudflared for architecture: $ARCH" && \
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH -O /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared && \
    cloudflared --version || echo "Cloudflared installed"

WORKDIR /app

# Copy backend files
COPY package*.json ./
RUN npm install --omit=dev
RUN npm install ngrok
COPY server.js ./
COPY public/ ./public/

EXPOSE 3000

CMD ["npm", "start"]