const path = require('path');

function resolveWorkspacePath(...parts) {
  return path.resolve(process.cwd(), ...parts);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = {
  resolveWorkspacePath,
  sleep
};
