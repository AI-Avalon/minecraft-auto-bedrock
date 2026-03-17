#!/usr/bin/env node
'use strict';

const path = require('path');

try {
  const configPath = path.join(process.cwd(), 'config.json');
  const cfg = require(configPath);
  process.exit(cfg && cfg.llm && cfg.llm.enabled ? 0 : 1);
} catch {
  process.exit(1);
}
