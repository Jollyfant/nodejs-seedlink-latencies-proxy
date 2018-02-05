const Network = require("net");
const Libxmljs = require("libxmljs");
const Record = require("./Record");
const Http = require("http");
const CONFIG = require("./config");

// Global container for latencies
var GLOBAL_LATENCIES = null;

module.exports = function(callback) {

  // Refresh latency information
  setInterval(getLatencies, CONFIG.REFRESH_INTERVAL);

  // Create a HTTP server
  const Server = Http.createServer(function(request, response) {

    // Write 204 No Content
    if(GLOBAL_LATENCIES === null) {
      response.writeHead(204);
      response.end();
      return;
    }

    // Write 200 JSON
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(GLOBAL_LATENCIES));

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
