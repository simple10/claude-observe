FROM node:22-slim

WORKDIR /app

# Install server dependencies (includes native better-sqlite3)
COPY app/server/package*.json server/
RUN cd server && npm install

# Install client dependencies and build
COPY app/client/package*.json client/
RUN cd client && npm install
COPY app/client/ client/
RUN cd client && npm run build

# Copy server source ONLY (not node_modules — those were built above for Linux)
COPY app/server/src server/src
COPY app/server/tsconfig.json server/

EXPOSE 4001

WORKDIR /app/server
CMD ["npx", "tsx", "src/index.ts"]
