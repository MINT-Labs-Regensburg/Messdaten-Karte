# syntax=docker/dockerfile:1
# Erwartet ein Vite-Projekt in diesem Ordner (package.json, package-lock.json, `npm run build` -> dist/).
# Das Ergebnis (statische Dateien) ist plattformunabhängig: auf der Build-Plattform bauen, nicht emuliert
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
