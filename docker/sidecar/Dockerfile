FROM node:20-alpine

WORKDIR /app

# Copy package files and install deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx

# Copy source (only what sidecar needs)
COPY src/sidecar/ src/sidecar/
COPY src/lib/ src/lib/
COPY src/types/ src/types/
COPY src/data/ src/data/
COPY tsconfig.sidecar.json ./

CMD ["npx", "tsx", "src/sidecar/main.ts"]
