const Network = require("net");
const Libxmljs = require("libxmljs");
const Record = require("./lib/Record");
const Http = require("http");
const CONFIG = require("./config");
const ALLOWED_PARAMETERS = ["network","station","location","channel"];

// Global container for latencies
var GLOBAL_LATENCIES = null;
var url = require('url');

module.exports = function(callback) {
  // Refresh latency information
  setInterval(getLatencies, CONFIG.REFRESH_INTERVAL);

  // Create a HTTP server
  const Server = Http.createServer(function(request, response) {
    var url_parts = url.parse(request.url, true);
    var query = url_parts.query;

    // Write 204 No Content
    if(GLOBAL_LATENCIES === null) {
      response.writeHead(204);
      response.end();
      return;
    }
    
    if (url_parts.pathname == "/") {
      filter_object = {}

      ALLOWED_PARAMETERS.forEach(function(key) {
        if (!(key in query)) {
          HTTPResponse(response, 400, ": Bad Request. Key " + key + " is missing") 
        }
        if (query[key].includes(",")){
	  filter_object[key] = true
        } else if (query[key] == "*" || query[key] == ""){
          filter_object[key] = false
        } else if (!(isAlphaNumeric(query[key]))) {
          HTTPResponse(response, 400, ": Bad Request. Key " + key + " is not Alphanumeric.")
        } else if (query[key] != ("*" || "")) {
          filter_object[key] = true
        }

      });

      // Write 200 JSON
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(filterLatencies(query, filter_object)));

    }
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

function filterLatencies(query, filter_object) {
  var result = GLOBAL_LATENCIES;

  if (filter_object['network']) {
    requestedNetworks = query["network"].split(","); 
    result = result.filter(function(x) {return requestedNetworks.indexOf(x.network) !== -1})
  }
  if (filter_object['station']) {
    requestedStations = query["station"].split(",");
    result = result.filter(function(x) {return requestedStations.indexOf(x.station) !== -1})
  }
  if (filter_object['location']) {
    requestedLocations = query["location"].split(",");
    result = result.filter(function(x) {return requestedLocations.indexOf(x.location) !== -1})
  }
  if (filter_object['channel']) {
    requestedChannels = query["channel"].split(",");
    result = result.filter(function(x) {return requestedChannels.indexOf(x.channel) !== -1})
  }

  return result
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
  socket.connect(CONFIG.SEEDLINK_PORT, CONFIG.SEEDLINK_HOST, function() {
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

function HTTPResponse(response, status, message) {
  if (status == 400){
    response.writeHead(status, { "Content-Type": "application/json" });
    return response.end(JSON.stringify("HTTP status " +  status + message)); 
  } else if (status == 500) {
    response.writeHead(status, { "Content-Type": "application/json" });
    return response.end(JSON.stringify("HTTP status " +  status + ": Internal Server Error."));
  }
}

function isAlphaNumeric(str) {
  var code, i, len;

  for (i = 0, len = str.length; i < len; i++) {
    code = str.charCodeAt(i);
    if (!(code > 47 && code < 58) && // numeric (0-9)
        !(code > 64 && code < 91) && // upper alpha (A-Z)
        !(code > 96 && code < 123)) { // lower alpha (a-z)
      return false;
    }
  }
  return true;
};
