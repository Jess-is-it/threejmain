FROM node:22-alpine AS build

WORKDIR /workspace/app-shell/web

COPY app-shell/web/package*.json ./
RUN npm install

COPY app-shell/web ./
COPY customer-profiling /workspace/customer-profiling
COPY billing /workspace/billing
COPY point-of-sale /workspace/point-of-sale
RUN npm run build

FROM nginx:1.27-alpine

COPY app-shell/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/app-shell/web/dist /usr/share/nginx/html

EXPOSE 80
