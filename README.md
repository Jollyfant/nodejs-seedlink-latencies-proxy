# nodejs-seedlink-latencies-proxy
A proxy written for NodeJS that cached latencies available from a Seedlink server at an interval. The cached information is made available through an HTTP API.

## Installation

    npm install

## Configuration
Modify config.json to suit your needs.

## Running

    node index.js

## Docker

    docker build -t seedlink-latencies:1.0 .
    docker run -p 8087:8087 [--rm] [-d] [-e "SERVICE_PORT=8087"] [-e "SERVICE_HOST=0.0.0.0"] seedlink-latencies:1.0

Two envrionment variables can passed to Docker run to modify settings at runtime. Otherwise information is read from the built configuration file.

  * SERVICE_HOST
  * SERVICE_PORT

## API
The supported parameters are valid SEED stream identifiers. Multiple identifiers may be delimited by a comma.

  * network
  * station
  * location
  * channel
