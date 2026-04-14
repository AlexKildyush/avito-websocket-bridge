FROM ghcr.io/puppeteer/puppeteer:24.7.1

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
