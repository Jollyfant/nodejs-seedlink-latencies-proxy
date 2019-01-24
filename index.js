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
const fs = require("fs");

const SeedlinkLatencyProxy = function(configuration, callback) {

  /*
   * Class SeedlinkLatencyProxy
   * NodeJS proxy for getting Seedlink latency information
   */

  const { createServer} = require("http");
  const url = require("url");
  const querystring = require("querystring");
  const Logger = require("./lib/logger");

  const logger = new Logger(__dirname);

  // Save the configuration
  this.configuration = configuration;

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
      return HTTPResponse(response, 204);
    }

    // Handle each incoming request
    var uri = url.parse(request.url);

    // Check the requested path
    switch(uri.pathname) {
      case "/":
        break;
      case "/version":
        return HTTPResponse(response, 200, __VERSION__);
      case "/swagger.yml":
        return fs.createReadStream("swagger.yml").pipe(response);
      default:
        return HTTPResponse(response, 404, "Not found.");
    }

    var queryObject = querystring.parse(uri.query);

    // Validate the user input
    try {
      validateParameters(queryObject);
    } catch(exception) {
      if(this.configuration.__DEBUG__) {
        return HTTPResponse(response, 400, exception.stack);
      } else {
        return HTTPResponse(response, 400, exception.message);
      }
    }

    // Make sure to filter the latencies to the request
    var requestedLatencies = this.filterLatencies(queryObject);

    // Write 204
    if(requestedLatencies.length === 0) {
      return HTTPResponse(response, 204);
    }

    // Write information to logfile
    response.on("finish", function() {
      logger.info({
        "method": request.method,
        "query": uri.query,
        "path": uri.pathname,
        "client": request.headers["x-forwarded-for"] || request.connection.remoteAddress,
        "agent": request.headers["user-agent"] || null,
        "statusCode": response.statusCode,
        "type": "HTTP Request",
        "msRequestTime": (Date.now() - initialized),
        "nLatencies": requestedLatencies.length
      });
    }.bind(this));

    // OK! Write 200 JSON
    response.writeHead(200, {"Content-Type": "application/json"});
    response.write(JSON.stringify(requestedLatencies));
    response.end();

  }.bind(this));

  // Get process environment variables (account for Docker env)
  const host = process.env.SERVICE_HOST || this.configuration.HOST;
  const port = Number(process.env.SERVICE_PORT) || this.configuration.PORT;

  // Listen to incoming HTTP connections
  Server.listen(port, host, function() {
    callback(configuration.__NAME__, host, port);
  });

  // Get initial latencies to cache
  this.refreshCacheFull();

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
  
    const NETWORK_REGEXP = new RegExp(/^([0-9a-z?*]{1,2},){0,}([0-9a-z?*]{1,2})$/i);
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

  const SeedlinkInfoSocket = require("./lib/seedlinkInfoSocket");

  // Attach callback
  const socket = new SeedlinkInfoSocket();
 
  // When the connection is established write INFO
  socket.getLatencies(server, callback);

}

function HTTPResponse(response, statusCode, message) {

  /*
   * Function HTTPResponse
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
