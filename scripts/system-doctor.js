const { systemDoctor } = require('../src/systemManager');

const report = systemDoctor();
console.log(JSON.stringify(report, null, 2));
