const SeedlinkInfoSocket = function() {

  /*
   * Class SeedlinkInfoSocket
   * Wrapper for a Seedlink connection requesting latency information
   */

  const { Socket } = require("net");

  this.initialized = Date.now();

  this.socket = new Socket();
  this.buffer = Buffer.allocUnsafe(0);
  this.records = new Array();

  this.socket.on("error", this.finish.bind(this));
  this.socket.on("data", this.handleData.bind(this));

}

SeedlinkInfoSocket.prototype.finish = function(error) {

  /*
   * Function SeedlinkInfoSocket.finish
   * Call to wrap up the seedlink socket
   */

  if(error) {
    return this.callback(error);
  }

  this.socket.destroy();

  // Fire the callback with the records
  this.callback(null, this.parseRecords(this.records));

}

SeedlinkInfoSocket.prototype.handleData = function(data) {

  /*
   * Function SeedlinkInfoSocket.handleData
   * Handler for incoming bytes over the raw socket
   */

  const mSEEDRecord = require("libmseedjs");
  const SLEND = Buffer.from("SLINFO  ");

  // Extend the buffer with newly received data
  this.buffer = Buffer.concat([this.buffer, data]);

  // Keep reading 512 byte latencyData from the buffer
  while(this.buffer.length >= 520) {

    // Extract the ASCII encoded XML from the 512 byte mSEED record
    this.records.push(new mSEEDRecord(this.buffer.slice(8)).data);

    // The final record was received with no error
    if(this.buffer.slice(0, 8).equals(SLEND)) {
      return this.finish(null);
    }

    // Slice off the finished record
    this.buffer = this.buffer.slice(520);

  }

}

SeedlinkInfoSocket.prototype.getLatencies = function(server, callback) {

  /*
   * Function SeedlinkInfoSocket.connect
   * Connects the raw TCP socket to the specified server {host, port}
   */

  const SLINFO = Buffer.from("INFO STREAMS\r\n");

  this.callback = callback;

  // Write latency request (INFO)
  this.socket.connect(server.port, server.host, function() {
    this.write(SLINFO);
  });

}

SeedlinkInfoSocket.prototype.parseRecords = function(records) {

  /*
   * Function SeedlinkLatencyProxy.extractXML
   * Extracts XML from mSEED log latencyData..
   */

  // Third party library for pasing XML
  const libxmljs = require("libxmljs");

  var latencies = new Array();
  var current = new Date();

  // Nothing to do
  if(records.length === 0) {
    return latencies;
  }

  // The lantency information is written as XML within mSEED
  // Go over all station nodes
  libxmljs.parseXmlString(records.join("")).root().childNodes().forEach(function(station) {

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

module.exports = SeedlinkInfoSocket;
