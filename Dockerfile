FROM node:13.12.0-alpine3.11

COPY ./src /app/src
COPY ./tsconfig.json /app/tsconfig.json
COPY ./package.json /app/package.json
COPY ./package-lock.json /app/package-lock.json

WORKDIR /app

RUN npm ci

RUN npm run build

RUN ls /app/dist