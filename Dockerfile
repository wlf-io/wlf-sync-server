FROM node:13.12.0-alpine3.11 as BUILD

COPY ./src /app/src
COPY ./tsconfig.json /app/tsconfig.json
COPY ./package.json /app/package.json
COPY ./package-lock.json /app/package-lock.json
COPY ./run.sh /app/run.sh

RUN chmod +x /app/run.sh

WORKDIR /app

RUN npm ci

RUN npm run build

RUN ls /app

RUN rm -rf /app/src

RUN rm -rf /app/node_modules

RUN npm install --only=prod

##
##
##


FROM node:13.12.0-alpine3.11

COPY --from=BUILD /app /home/node/app

WORKDIR /home/node/app

CMD ["npm","run","prod"]