# Node.js 20-nin yüngül versiyası
FROM node:20-slim

# Puppeteer və Chrome üçün lazımi Linux kitabxanalarını quraşdırırıq
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates procps libxss1 libnss3 libatk-bridge2.0-0 \
    libgtk-3-0 libgbm-dev libasound2 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Paketləri kopyala və yüklə
COPY package*.json ./
RUN npm install

# Bütün kodu kopyala və build et
COPY . .
RUN npm run build

# Portu aç (NestJS standart portu 3000)
EXPOSE 3000

# Proqramı başlat
CMD ["npm", "run", "start:prod"]