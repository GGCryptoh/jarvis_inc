FROM node:20-alpine

# Multi-language handler support: Python3 + bash (already in alpine)
RUN apk add --no-cache python3 py3-pip
RUN pip3 install --break-system-packages python-docx

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY server.ts ./

# Workspace volume mount point (apps, handlers, skills)
RUN mkdir -p /workspace/apps /workspace/handlers /workspace/skills

EXPOSE 3001

CMD ["npx", "tsx", "server.ts"]
