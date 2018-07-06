/*
 * NodeJS SeedlinkLatencyProxy
 *
 * Requests latency information from a seedlink server in intervals
 * These latencies can be queried using a basic API
 * Supported parameters: network, station, latency, channel
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans
 * Licensed under MIT
 *
 */

"use strict";

const __VERSION__ = "1.0.0";

// Import standard lib
const net = require("net");
const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");
const querystring = require("querystring");

// Third party library for pasing XML
const libxmljs = require("libxmljs");

// libmseedjs
const Record = require("./lib/libmseedjs/Record");

var SeedlinkLatencyProxy = function(configuration, callback) {

  /* class SeedlinkLatencyProxy
   * NodeJS proxy for getting Seedlink latency information
   */

  function HTTPError(response, statusCode, message) {
  
    /* function HTTPError
     * Writes HTTP reponse to the client
     */
  
    response.writeHead(statusCode, {"Content-Type": "text/plain"});
    response.write(message);
    response.end();
  
  }

  function EnableCORS(response) {

    /* function EnableCORS
     * Enables the cross origin headers
     */

    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET");

  }

  this.configuration = configuration;
  this.logger = this.setupLogger();

  // Class global for caching latencies
  this.cachedLatencies = new Array();

  // Create a HTTP server
  const Server = http.createServer(function(request, response) {

    // Enable CORS headers when required
    if(this.configuration.__CORS__) {
      EnableCORS(response);
    }

    // Handle each incoming request
    var uri = url.parse(request.url);
    var initialized = Date.now();

    // Write 204 No Content
    if(this.cachedLatencies.length === 0) {
      return HTTPError(response, 204);
    }

    // Only root path is supported
    if(uri.pathname !== "/") {
      return HTTPError(response, 404, "Method not supported.");
    }

    var queryObject = querystring.parse(uri.query);

    // Check the user input
    try {
      this.validateParameters(queryObject);
    } catch(exception) {
      if(this.configuration.__DEBUG__) {
        return HTTPError(response, 400, exception.stack);
      } else {
        return HTTPError(response, 400, exception.message);
      }
    }

    var requestedLatencies = this.filterLatencies(queryObject);

    // Write 204
    if(requestedLatencies.length === 0) {
      return HTTPError(response, 204);
    }

    // Write information to logfile
    response.on("finish", function() {
      this.logger.write(JSON.stringify({
        "timestamp": new Date().toISOString(),
        "method": request.method,
        "query": uri.query,
        "path": uri.pathname,
        "client": request.headers["x-forwarded-for"] || request.connection.remoteAddress,
        "agent": request.headers["user-agent"] || null,
        "statusCode": response.statusCode,
        "type": "HTTP Request",
        "msRequestTime": (Date.now() - initialized),
        "nLatencies": requestedLatencies.length
      }) + "\n");
    }.bind(this));

    // Write 200 JSON
    response.writeHead(200, {"Content-Type": "application/json"});
    response.write(JSON.stringify(requestedLatencies));
    response.end();

  }.bind(this));

  // Get process environment variables (Docker)
  var host = process.env.SERVICE_HOST || this.configuration.HOST;
  var port = Number(process.env.SERVICE_PORT) || this.configuration.PORT;

  // Listen to incoming HTTP connections
  Server.listen(port, host, function() {
    callback(configuration.__NAME__, host, port);
  });

  // Get initial latencies
  this.getLatencies();

}

SeedlinkLatencyProxy.prototype.setupLogger = function() {

  /* SeedlinkLatencyProxy.setupLogger
   * Sets up log directory and file for logging
   */

  // Create the log directory if it does not exist
  fs.existsSync(path.join(__dirname, "logs")) || fs.mkdirSync(path.join(__dirname, "logs"));
  return fs.createWriteStream(path.join(__dirname, "logs", "service.log"), {"flags": "a"});

}

SeedlinkLatencyProxy.prototype.validateParameters = function(queryObject) {

  /* SeedlinkLatencyProxy.validateParameters
   * Checks parameters passed to API request
   */

  function isValidParameter(key, value) {
  
    /* function isValidParameter
     * Returns boolean whether parameter attributes are valid
     */
  
    const NETWORK_REGEXP = new RegExp(/^([0-9a-z?*]{1,2},){0,}([0-9a-z?*]{1,2})$/i)
    const STATION_REGEXP = new RegExp(/^([0-9a-z?*]{1,5},){0,}([0-9a-z?*]{1,5})$/i);
    const LOCATION_REGEXP = new RegExp(/^([0-9a-z-?*]{1,2},){0,}([0-9a-z-?*]{1,2})$/i);
    const CHANNEL_REGEXP = new RegExp(/^([0-9a-z?*]{1,3},){0,}([0-9a-z?*]{1,3})$/i);
  
    // Check individual parameters
    switch(key) {
      case "network":
        return NETWORK_REGEXP.test(value);
      case "station":
        return STATION_REGEXP.test(value);
      case "location":
        return LOCATION_REGEXP.test(value);
      case "channel":
        return CHANNEL_REGEXP.test(value);
      default:
        throw new Error("Invalid parameter passed.");
      }
  
  }

  // Parameters allowed by the service
  const ALLOWED_PARAMETERS = [
    "network",
    "station",
    "location",
    "channel"
  ];

  // Check if all parameters are allowed
  Object.keys(queryObject).forEach(function(x) {

    // Must be supported by the service
    if(!ALLOWED_PARAMETERS.includes(x)) {
      throw new Error("Key " + x + " is not supported.");
    }

    if(!isValidParameter(x, queryObject[x])) {
      throw new Error("Key " + x + " is not valid.");
    }

  });

}

SeedlinkLatencyProxy.prototype.filterLatencies = function(queryObject) {

  /* function SeedlinkLatencyProxy.filterLatencies
   * Filters latencies from the cached object, naive and low performance
   */

  function matchArray(code, values) {

    /* function matchArray
     * Returns elements from array that match a wildcard expression
     */

    function testWildcard(code, x) {

      /* function testWildcard
       * Converts ? * wildcards to regular expressions
       */

      function convertWildcard(x) {
 
        /* function testWildcard
         * Converts ? * wildcards to regular expressions
         */

        return x.replace(/\?/g, ".").replace(/\*/g, ".*");

      }

      return new RegExp("^" + convertWildcard(x) + "$").test(code);

    }

    return values.filter(function(x) {
      return testWildcard(code, x);
    }).length;

  }

  var bool;

  if(!queryObject.network && !queryObject.station && !queryObject.location && !queryObject.channel) {
    return this.cachedLatencies;
  }

  return this.cachedLatencies.filter(function(latency) {

    bool = true;

    // Check all passed variables
    if(queryObject.network) {
      bool &= matchArray(latency.network, queryObject.network.split(","));
    }
    if(bool && queryObject.station) {
      bool &= matchArray(latency.station, queryObject.station.split(","));
    }
    if(bool && queryObject.location) {
      bool &= matchArray(latency.location, queryObject.location.split(",").map(x => x.replace("--", "")))
    }
    if(bool && queryObject.channel) {
      bool &= matchArray(latency.channel, queryObject.channel.split(","));
    }

    return bool;

  });

}

SeedlinkLatencyProxy.prototype.getLatencies = function() {

  /* function SeedlinkLatencyProxy.getLatencies
   * Connects to Seedlink to get current stream latencies
   */

  const INFO = new Buffer("INFO STREAMS\r\n");

  // Open a new TCP socket
  const socket = new net.Socket()

  // Create a new empty buffer
  var buffer = new Buffer(0);
  var latencyData = new Array();
  var SLPACKET;
 
  // When the connection is established write INFO
  socket.connect(Number(process.env.SEEDLINK_PORT) || this.configuration.SEEDLINK.PORT, process.env.SEEDLINK_HOST || this.configuration.SEEDLINK.HOST, function() {
    socket.write(INFO);
  });

  // Data is written over the socket
  socket.on("data", function(data) {

    // Extend the buffer with newly received data
    buffer = Buffer.concat([buffer, data]);

    // Keep reading 512 byte latencyData from the buffer
    while(buffer.length >= 520) {

      SLPACKET = buffer.slice(0, 8).toString();

      // Extract the ASCII from the record
      latencyData.push(new Record(buffer.slice(8, 520)).data);

      // The final record was received 
      if(SLPACKET === "SLINFO  ") {

        // Update the global variable
        this.cachedLatencies = this.parseRecords(latencyData.join(""));

        if(this.configuration.__SORT__) {
          this.cachedLatencies.sort(function(a, b) { return a.msLatency - b.msLatency });
        }

        // Destroy the TCP socket
        socket.destroy();

      }

      buffer = buffer.slice(520);

    }

  }.bind(this));

  // Error on socket connection
  socket.on("error", function(error) {
    this.cachedLatencies = new Array();
  }.bind(this));

  // Set up for the next caching request
  setTimeout(this.getLatencies.bind(this), this.configuration.REFRESH_INTERVAL);

}

SeedlinkLatencyProxy.prototype.parseRecords = function(XMLString) {

  /* function SeedlinkLatencyProxy.extractXML
   * Extracts XML from mSEED log latencyData..
   */

  var latencies = new Array();
  var current = Date.now();
  var end;

  // Go over all station nodes
  // For each station go over all streams
  libxmljs.parseXmlString(XMLString).root().childNodes().forEach(function(station) {

    station.childNodes().forEach(function(stream) {

      // Skip identifiers that are not D
      if(stream.attr("type").value() !== "D") {
        return;
      }

      // Get the end time from Seedlink
      end = Date.parse(stream.attr("end_time").value() + " GMT");

      // Collect all latencies
      latencies.push({
        "network": station.attr("network").value(),
        "station": station.attr("name").value(),
        "location": stream.attr("location").value(),
        "channel": stream.attr("seedname").value(),
        "end": new Date(end).toISOString(),
        "msLatency": current - end,
      });

    });

  });

  return latencies;

}

// Expose the class
module.exports.server = SeedlinkLatencyProxy;
module.exports.__VERSION__ = __VERSION__;

if(require.main === module) {

  const CONFIG = require("./config");

  // Start up the WFCatalog
  new module.exports.server(CONFIG, function(name, host, port) {
    console.log(name + " microservice has been started on " + host + ":" + port);
  });

}
