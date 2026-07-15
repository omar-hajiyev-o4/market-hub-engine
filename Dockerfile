# Node.js 22-nin yüngül versiyası (Paketlərin EBADENGINE xəbərdarlığını həll edir)
FROM node:22-slim

# Puppeteer üçün lazımi paketlər + UNZIP (Çökmənin səbəbi)
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates procps libxss1 libnss3 libatk-bridge2.0-0 \
    libgtk-3-0 libgbm-dev libasound2 unzip \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*
# Və Docker-ə default vaxtı Bakı kimi təyin etmək üçün bu sətri əlavə et:
ENV TZ="Asia/Baku"

WORKDIR /app

# Paketləri kopyala və yüklə
COPY package*.json ./
RUN npm install

# Bütün kodu kopyala və build et
COPY . .
RUN npm run build

# Portu aç
EXPOSE 3000

# Proqramı başlat
CMD ["npm", "run", "start:prod"]
