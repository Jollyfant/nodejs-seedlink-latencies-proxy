# nodejs-seedlink-latencies-proxy
A proxy written for NodeJS that caches channel latencies available from a Seedlink server at a configurable interval. The cached information is made available through a simple HTTP API.

## Installation

    npm install

## Configuration
Modify config.json to suit your needs.

## Running

    node index.js

## Docker

    docker build -t seedlink-latencies:1.0 .
    docker run -p 8087:8087 [--rm] [-d] [-e "SERVICE_PORT=8087"] [-e "SERVICE_HOST=0.0.0.0"] seedlink-latencies:1.0

Four envrionment variables can passed to Docker run to modify settings at runtime. Otherwise information is read from the built configuration file.

  * SERVICE\_HOST
  * SERVICE\_PORT
  * SEEDLINK\_PORT
  * SEEDLINK\_HOST

## API
The supported parameters are valid SEED stream identifiers. Multiple stream identifiers may be delimited by a comma.

  * network
  * station
  * location
  * channel

## Example

    $ curl "127.0.0.1:8087?network=GE&station=MARCO&channel=HHZ"

    [{
        "network": "GE",
        "station": "MARCO",
        "location": "",
        "channel": "HHZ",
        "end": "2018-07-06T12:44:49.970Z",
        "msLatency": 3542
    }]
