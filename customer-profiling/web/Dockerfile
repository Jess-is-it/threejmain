FROM node:20-alpine AS build
WORKDIR /app
ARG WEB_BASE_PATH=/customer-profiling
ARG VITE_WEB_BASE_PATH=/customer-profiling
ARG VITE_API_BASE_PATH=/api/customer-profiling
ARG VITE_APP_VERSION=0.1.4
ENV WEB_BASE_PATH=$WEB_BASE_PATH
ENV VITE_WEB_BASE_PATH=$VITE_WEB_BASE_PATH
ENV VITE_API_BASE_PATH=$VITE_API_BASE_PATH
ENV VITE_APP_VERSION=$VITE_APP_VERSION
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
