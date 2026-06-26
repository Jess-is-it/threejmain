FROM node:22-alpine AS build

WORKDIR /workspace/app-shell/web

ARG APP_ENV=local
ARG APP_VERSION=0.1.0-local
ARG APP_BRANCH=local
ARG APP_COMMIT=unknown
ARG APP_BUILD_TIME=

ENV VITE_APP_ENV=$APP_ENV
ENV VITE_APP_VERSION=$APP_VERSION
ENV VITE_APP_BRANCH=$APP_BRANCH
ENV VITE_APP_COMMIT=$APP_COMMIT
ENV VITE_APP_BUILD_TIME=$APP_BUILD_TIME

COPY app-shell/web/package*.json ./
RUN npm install

COPY app-shell/web ./
COPY features /workspace/features
RUN npm run build

FROM nginx:1.27-alpine

COPY app-shell/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/app-shell/web/dist /usr/share/nginx/html

EXPOSE 80
