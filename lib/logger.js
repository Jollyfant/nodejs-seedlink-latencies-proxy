var Logger = function(root) {

  /*
   * Class Logger
   * Sets up log directory and file for logging
   */

  const fs = require("fs");
  const path = require("path");

  // Create the log directory if it does not exist
  fs.existsSync(path.join(__dirname, "logs")) || fs.mkdirSync(path.join(__dirname, "logs"));

  this.stream = fs.createWriteStream(path.join(root, "logs", "service.log"), {"flags": "a"});

}

Logger.prototype.info = function(message) {

  /*
   * Function Logger.write
   * Writes to the opened stream
   */

  const object = new Object({
    "level": "INFO",
    "timestamp": new Date().toISOString(),
    "message": message
  });

  // Write to file
  this.stream.write(JSON.stringify(object) + "\n");

}

module.exports = Logger;
