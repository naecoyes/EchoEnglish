# ── Stage 1: Build frontend (Vite) ──────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /build

COPY package.json package-lock.json* ./
COPY index.html vite.config.js ./
COPY frontend/ ./frontend/
COPY public/ ./public/

RUN npm ci --prefer-offline && npm run build

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM node:22-alpine AS runner

# System deps: ffmpeg + ffprobe (video composition & audio probing)
# Font deps: fontconfig, ttf-dejavu, font-noto-cjk (for rendering SVG text in sharp)
RUN apk add --no-cache ffmpeg fontconfig ttf-dejavu font-noto font-noto-cjk

WORKDIR /app

# Install production Node dependencies
# sharp compiles native bindings - must match the target Alpine arch
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline

# Copy application source
COPY src/ ./src/

# Copy pre-built frontend assets
COPY --from=frontend-builder /build/dist ./dist

# Runtime entrypoint (sets up settings.local.json symlink)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Persistent mount points (created with right perms before USER switch)
RUN mkdir -p /app/outputs /app/data /app/jobs

# Use non-root user for security
RUN addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app
USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/config > /dev/null || exit 1

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/webServer.js"]
