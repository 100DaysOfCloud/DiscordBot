FROM mhart/alpine-node:14.16.0

LABEL maintainer="Antonio Lo Fiego"

RUN mkdir -p /usr/src/bot
WORKDIR /usr/src/bot

COPY . /usr/src/bot
RUN npm install

CMD ["npm", "start"]