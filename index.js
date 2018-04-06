const Network = require("net");
const Libxmljs = require("libxmljs");
const Record = require("./lib/Record");
const Http = require("http");
const CONFIG = require("./config");
const url = require("url");
const querystring = require("querystring");

// Global container for latencies
var GLOBAL_LATENCIES = null;

function validateParameters(queryObject) {

  const ALLOWED_PARAMETERS = [
    "network",
    "station",
    "location",
    "channel"
  ];

  // Check if all parameters are allowed
  Object.keys(queryObject).forEach(function(x) {
    if(ALLOWED_PARAMETERS.indexOf(x) === -1) {
      throw("Key " + x + " is not supported");
    }

    if(!isAlphaNumeric(queryObject[x], x)) {
      throw("Key " + x + " is not alphanumerical");
    }

  });

  if(queryObject.network === undefined) {
    throw("Network parameter is required");
  }

  return true;

}

module.exports = function(callback) {

  // Refresh latency information
  setInterval(getLatencies, CONFIG.REFRESH_INTERVAL);

  // Create a HTTP server
  const Server = Http.createServer(function(request, response) {

    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET");

    var uri = url.parse(request.url);

    // Write 204 No Content
    if(GLOBAL_LATENCIES === null) {
      return HTTPError(response, 204);
    }
    
    // Only root path is supported
    if(uri.pathname !== "/") {
      return HTTPError(response, 404, "Method not supported")
    }

    var queryObject = querystring.parse(uri.query);

    // Sanitize user input
    try {
      validateParameters(queryObject);
    } catch(exception) {
      return HTTPError(response, 400, exception);
    }

    var requestedLatencies = filterLatencies(queryObject);

    // Write 204
    if(requestedLatencies.length === 0) {
      return HTTPError(response, 204);
    }

    // Write 200 JSON
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(requestedLatencies));

  })

  // Listen to incoming HTTP connections
  Server.listen(CONFIG.PORT, CONFIG.HOST, function() {
    if(typeof callback === "function") {
      callback();
    }
  });

  // Get initial latencies
  getLatencies();

}

function filterLatencies(queryObject) {

  // Create a copy of the global latencies map
  var results = GLOBAL_LATENCIES.map(x => x);

  // Go over all submitted keys
  Object.keys(queryObject).forEach(function(parameter) {

    // Input values as array (support comma delimited)
    var values = queryObject[parameter].split(",");

    if(parameter === "location") {
      values = values.map(function(x) {
        return x.replace("--", "");
      });
    }

    // Check if the result should be filtered
    results = results.filter(function(latency) {
      return (values.indexOf(latency[parameter]) !== -1); 
    });

  });

  return results;

}

function getLatencies() {

  /* function getLantecies
   * Connects to Seedlink to get current stream latencies
   */

  const INFO = new Buffer("INFO STREAMS\r\n");

  // Open a new TCP socket
  var socket = new Network.Socket()

  // Create a new empty buffer
  var buffer = new Buffer(0);
  var records = new Array();
 
  // When the connection is established write INFO
  socket.connect(CONFIG.SEEDLINK.PORT, CONFIG.SEEDLINK.HOST, function() {
    socket.write(INFO);
  });

  // Data is written over the socket
  socket.on("data", function(data) {

    // Extend the buffer with new data
    buffer = Buffer.concat([buffer, data]);

    // Keep reading 512 byte records from the buffer
    while(buffer.length >= 520) {

      // Get the seedlink packet for this record
      var SLPACKET = buffer.slice(0, 8).toString();

      // Add a new record to the buffer and slice
      records.push(new Record(buffer.slice(8, 520)))
      buffer = buffer.slice(520);

      // Final record
      if(SLPACKET === "SLINFO  ") {

        // Update the global variable
        GLOBAL_LATENCIES = parseRecords(records);

        // Destroy the socket
        socket.destroy();

      }

    }

  });

  // Oops
  socket.on("error", function(error) {
    console.log(error);
  });

}

function parseRecords(json) {

  /* function extractXML
   * Extracts XML from mSEED log records..
   */

  // Merge ASCII data
  var XML = json.map(function(x) {
    return x.data
  }).join("");

  // Parse the XML using the provided library
  var xmlDoc = Libxmljs.parseXmlString(XML);

  var latencies = new Array();
  var current = Date.now();

  // Go over all station nodes
  // For each station go over all streams
  xmlDoc.root().childNodes().forEach(function(station) {

    station.childNodes().forEach(function(stream) {

      // Skip identifiers not D
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
        "msLatency": current - end,
      });

    });

  });

  return latencies;

}

// Start the NodeJS Seedlink Server
if(require.main === module) {

  // Start up the WFCatalog
  new module.exports(function() {
    console.log("NodeJS Latency Server has been initialized on " + CONFIG.HOST + ":" + CONFIG.PORT)
  });

}

function HTTPError(response, status, message) {

  response.writeHead(status, {"Content-Type": "text/plain"});
  response.end(message)

}

function isAlphaNumeric(code, level) {

  const NETWORK_REGEXP = new RegExp(/^([0-9a-z]{1,2},){0,}([0-9a-z]{1,2})$/i)
  const STATION_REGEXP = new RegExp(/^([0-9a-z]{1,5},){0,}([0-9a-z]{1,5})$/i);
  const LOCATION_REGEXP = new RegExp(/^([0-9a-z]{2},){0,}([0-9a-z]{2})$/i);
  const CHANNEL_REGEXP = new RegExp(/^([0-9a-z]{3},){0,}([0-9a-z]{3})$/i);

  switch(level) {
    case "network":
      return NETWORK_REGEXP.test(code);
    case "station":
      return STATION_REGEXP.test(code);
    case "location":
      return LOCATION_REGEXP.test(code);
    case "channel": 
      return CHANNEL_REGEXP.test(code);
    }
  return true;

};
