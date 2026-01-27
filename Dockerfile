# Keyrot Docker Persistence
# This Dockerfile provides a base for running applications with keyrot
# and persistent, encrypted storage.

FROM node:20-alpine AS base

# Install dependencies for node-gyp (if native modules are needed)
RUN apk add --no-cache python3 make g++

# Create data directory for keyrot storage
RUN mkdir -p /data/keyrot && chown -R node:node /data/keyrot

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built application
COPY dist/ ./dist/

# Set non-root user for security
USER node

# Environment variables for keyrot configuration
# KEYROT_ENCRYPTION_KEY must be provided at runtime
ENV NODE_ENV=production

# Volume mount point for persistent storage
VOLUME ["/data/keyrot"]

# Expose the data directory info for documentation
LABEL org.opencontainers.image.description="Keyrot API key rotation with encrypted persistence"
LABEL org.opencontainers.image.source="https://github.com/keyrot/keyrot"

# Default command (override in derived images)
CMD ["node", "dist/index.js"]
