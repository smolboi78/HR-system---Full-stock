FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite bakes VITE_* variables into the built JS at build time, not runtime -
# so this has to be a build ARG, not just an environment variable read by
# the running container. Railway passes service variables as build args
# automatically when a Dockerfile declares a matching ARG.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM node:20-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist

# -s = single-page-app mode: unknown paths fall back to index.html so
# React Router's client-side routes (e.g. /employees/:id) work on refresh.
CMD serve -s dist -l ${PORT:-3000}
