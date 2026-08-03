# The app needs Node 22.5+ for the built-in SQLite, which is newer than most
# distributions ship. A container keeps that requirement to itself rather than
# putting a second Node on a host that is already running other things.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Runtime needs express and qrcode; react is already bundled into dist.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
# server/db.js resolves the database relative to its own parent, so this is
# where it will look. Mount a volume over it or the inventory dies with the
# container.
RUN mkdir -p /app/data
EXPOSE 5178
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
