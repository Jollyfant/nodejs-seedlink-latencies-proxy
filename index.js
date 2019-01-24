/*
 * NodeJS SeedlinkLatencyProxy
 *
 * Requests latency information from multiple seedlink server in intervals
 * These latencies are cached and are exposed using a basic HTTP API
 * Supported parameters: network, station, latency, channel
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans
 * Licensed under MIT
 *
 * Updated: 2019-01-24
 *
 */

"use strict";

const __VERSION__ = "1.0.0";

const SeedlinkLatencyProxy = function(configuration, callback) {

  /*
   * Class SeedlinkLatencyProxy
   * NodeJS proxy for getting Seedlink latency information
   */

  const { createServer} = require("http");
  const url = require("url");
  const querystring = require("querystring");

  // Save the configuration
  this.configuration = configuration;

  // Set up a logger
  this.logger = this.setupLogger();

  // Class global for caching latencies
  this.cachedLatencies = new Array();

  // Create a HTTP server
  const Server = createServer(function(request, response) {

    var initialized = Date.now();

    // Enable CORS headers when required
    if(this.configuration.__CORS__) {
      EnableCORS(response);
    }

    // Write 204 No Content
    if(this.cachedLatencies.length === 0) {
      return HTTPError(response, 204);
    }

    // Handle each incoming request
    var uri = url.parse(request.url);

    // Only root path is supported
    if(uri.pathname !== "/") {
      return HTTPError(response, 404, "Method not supported.");
    }

    var queryObject = querystring.parse(uri.query);

    // Validate the user input
    try {
      validateParameters(queryObject);
    } catch(exception) {
      if(this.configuration.__DEBUG__) {
        return HTTPError(response, 400, exception.stack);
      } else {
        return HTTPError(response, 400, exception.message);
      }
    }

    // Make sure to filter the latencies to the request
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

    // OK! Write 200 JSON
    response.writeHead(200, {"Content-Type": "application/json"});
    response.write(JSON.stringify(requestedLatencies));
    response.end();

  }.bind(this));

  // Get process environment variables (account for Docker env)
  var host = process.env.SERVICE_HOST || this.configuration.HOST;
  var port = Number(process.env.SERVICE_PORT) || this.configuration.PORT;

  // Listen to incoming HTTP connections
  Server.listen(port, host, function() {
    callback(configuration.__NAME__, host, port);
  });

  // Get initial latencies to cache
  this.refreshCacheFull();

}

SeedlinkLatencyProxy.prototype.setupLogger = function() {

  /*
   * Function SeedlinkLatencyProxy.setupLogger
   * Sets up log directory and file for logging
   */

  const fs = require("fs");
  const path = require("path");

  // Create the log directory if it does not exist
  fs.existsSync(path.join(__dirname, "logs")) || fs.mkdirSync(path.join(__dirname, "logs"));
  return fs.createWriteStream(path.join(__dirname, "logs", "service.log"), {"flags": "a"});

}

function validateParameters(queryObject) {

  /* 
   * Function SeedlinkLatencyProxy.validateParameters
   * Checks parameters passed to API request
   */

  function isValidParameter(key, value) {
  
    /*
     * Function SeedlinkLatencyProxy.validateParameters::isValidParameter
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
      }
  
  }

  // Parameters allowed by the service
  const ALLOWED_PARAMETERS = new Array("network", "station", "location", "channel");

  // Check if all parameters are allowed
  Object.keys(queryObject).forEach(function(x) {

    // Must be supported by the service
    if(!ALLOWED_PARAMETERS.includes(x)) {
      throw new Error("Query parameter " + x + " is not supported.");
    }

    if(!isValidParameter(x, queryObject[x])) {
      throw new Error("Query parameter " + x + " is not valid.");
    }

  });

}

SeedlinkLatencyProxy.prototype.filterLatencies = function(queryObject) {

  /*
   * Function SeedlinkLatencyProxy.filterLatencies
   * Filters latencies from the cached object, naive and low performance
   */

  function matchArray(code, values) {

    /* 
     * Function matchArray
     * Returns elements from array that match a wildcard expression
     */

    function testWildcard(code, x) {

      /* 
       * Function testWildcard
       * Converts ? * wildcards to regular expressions
       */

      function convertWildcard(x) {
 
        /*
         * Function testWildcard
         * Converts ? * wildcards to regular expressions
         */

        return x.replace(/\?/g, ".").replace(/\*/g, ".*");

      }

      return new RegExp("^" + convertWildcard(x) + "$").test(code);

    }

    return values.filter(x => testWildcard(code, x)).length;

  }

  // If all fields are missing return everything
  if(!queryObject.network && !queryObject.station && !queryObject.location && !queryObject.channel) {
    return this.cachedLatencies;
  }

  return this.cachedLatencies.filter(function(latency) {

    var bool = true;

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

SeedlinkLatencyProxy.prototype.refreshCacheFull = function() {

  /*
   * Function SeedlinkLatencyProxy.refreshCacheFull
   * Asynchronously goes over an array of servers and extends the result
   * with a number of returned latencies
   */

  var next;
  var servers = this.configuration.servers.slice(0);
  var latencies = new Array();

  (next = function() {

    // No more servers to check
    if(servers.length === 0) {
      return this.setLatencyCache(latencies);
    }

    var server = servers.pop();

    // Get the latencies for a single server
    this.getLatencies(server, function(error, result) {

      // Extend the result when no error
      if(error === null) {
        latencies = latencies.concat(result);
      }

      return next();

    });

  }.bind(this))();

}

SeedlinkLatencyProxy.prototype.setLatencyCache = function(latencies) {

  /*
   * Function SeedlinkLatencyProxy.setLatencyCache
   * Sets the passed array of latencies to the exposed cache
   */

  function sortLatencies(a, b) {

    /*
     * Function SeedlinkLatencyProxy.setLatencyCache::sortLatencies
     * Sorts the latencies from low to high
     */

    return a.msLatency - b.msLatency;

  }

  // A sort was requested on the submitted latencies
  if(this.configuration.__SORT__) {
    latencies.sort(sortLatencies);
  }

  // Overwrite the cached latencies with the new result
  this.cachedLatencies = latencies;

  // Queue for the next request
  setTimeout(this.refreshCacheFull.bind(this), this.configuration.REFRESH_INTERVAL);

}

SeedlinkLatencyProxy.prototype.getLatencies = function(server, callback) {

  /*
   * Function SeedlinkLatencyProxy.getLatencies
   * Connects to Seedlink to get current stream latencies
   */

  // libmseedjs
  const net = require("net");
  const mSEEDRecord = require("libmseedjs");

  const INFO = new Buffer("INFO STREAMS\r\n");

  // Open a new TCP socket
  const socket = new net.Socket()

  // Create a new empty buffer
  var buffer = new Buffer(0);
  var latencyData = new Array();
  var SLPACKET;
 
  // When the connection is established write INFO
  socket.connect(server.port, server.host, function() {
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
      latencyData.push(new mSEEDRecord(buffer.slice(8, 520)).data);

      // The final record was received 
      if(SLPACKET === "SLINFO  ") {

        // Destroy the TCP socket
        socket.destroy();

        // Update the global variable
        return callback(null, parseRecords(latencyData.join("")));

      }

      // Prepare to read the next record
      buffer = buffer.slice(520);

    }

  });

  // Error on socket connection
  socket.on("error", callback);

}

function HTTPError(response, statusCode, message) {

  /*
   * Function HTTPError
   * Writes HTTP reponse to the client
   */

  response.writeHead(statusCode, {"Content-Type": "text/plain"});
  response.write(message);
  response.end();

}

function EnableCORS(response) {

  /*
   * Function EnableCORS
   * Enables the cross origin headers
   */

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET");

}

function parseRecords(XMLString) {

  /* function SeedlinkLatencyProxy.extractXML
   * Extracts XML from mSEED log latencyData..
   */

  // Third party library for pasing XML
  const libxmljs = require("libxmljs");

  var latencies = new Array();
  var current = Date.now();

  // Go over all station nodes
  // For each station go over all streams
  libxmljs.parseXmlString(XMLString).root().childNodes().forEach(function(station) {

    // Go over all children (streams)
    station.childNodes().forEach(function(stream) {

      // Skip identifiers that do not have quality D
      if(stream.attr("type").value() !== "D") {
        return;
      }

      // Get the end time from Seedlink
      var end = Date.parse(stream.attr("end_time").value() + " GMT");

      // Collect all latencies
      latencies.push({
        "network": station.attr("network").value(),
        "station": station.attr("name").value(),
        "location": stream.attr("location").value(),
        "channel": stream.attr("seedname").value(),
        "end": new Date(end).toISOString(),
        "msLatency": Number(current - end),
      });

    });

  });

  return latencies;

}

// Expose the class
module.exports.server = SeedlinkLatencyProxy;
module.exports.__VERSION__ = __VERSION__;

if(require.main === module) {

  /*
   * Function __main__
   * Launched when the script is initialized
   */

  const CONFIG = require("./config");

  // Start up the WFCatalog
  new module.exports.server(CONFIG, function(name, host, port) {
    console.log(name + " microservice has been started on " + host + ":" + port);
  });

}
