function formatError(error) {
  if (!error) {
    return '';
  }

  if (error instanceof Error) {
    return `${error.message}\n${error.stack || ''}`.trim();
  }

  return String(error);
}

function createLogger() {
  const base = (level, message, error) => {
    const time = new Date().toISOString();
    const suffix = error ? `\n${formatError(error)}` : '';
    console.log(`[${time}] [${level}] ${message}${suffix}`);
  };

  return {
    info(message) {
      base('INFO', message);
    },
    warn(message, error) {
      base('WARN', message, error);
    },
    error(message, error) {
      base('ERROR', message, error);
    }
  };
}

const logger = createLogger();

module.exports = { logger };
