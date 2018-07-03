# Dockerfile for building NodeJS Seedlink Latency connector
#
# $ docker build -t seedlink-latencies:1.0 .

FROM node:8
MAINTAINER Mathijs Koymans

# Set the work directory
WORKDIR /usr/src/app

# Copy the source code
COPY . .

RUN npm install

EXPOSE 8087

CMD ["npm", "start"]
