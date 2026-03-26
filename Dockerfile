FROM node:22-slim

WORKDIR /app

# Install server dependencies (includes native better-sqlite3)
COPY app/server/package*.json app/server/
RUN cd app/server && npm install

# Install client dependencies and build
COPY app/client/package*.json app/client/
RUN cd app/client && npm install
COPY app/client/ app/client/
RUN cd app/client && npm run build

# Copy server source ONLY (not node_modules — those were built above for Linux)
COPY app/server/src app/server/src
COPY app/server/tsconfig.json app/server/

EXPOSE 4001

CMD ["npx", "--prefix", "app/server", "tsx", "app/server/src/index.ts"]
