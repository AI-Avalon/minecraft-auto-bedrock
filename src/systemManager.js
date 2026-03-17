const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args = [], cwd = process.cwd()) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8'
  });
  return {
    ok: result.status === 0,
    code: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function readPackageVersion() {
  try {
    const packagePath = path.resolve(process.cwd(), 'package.json');
    const text = fs.readFileSync(packagePath, 'utf8');
    const json = JSON.parse(text);
    return String(json.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function commandExists(cmd) {
  if (process.platform === 'win32') {
    return run('where', [cmd]).ok;
  }
  return run('which', [cmd]).ok;
}

function detectTool(tool, args = ['--version']) {
  const exists = commandExists(tool);
  if (!exists) {
    return { exists: false, version: null };
  }
  const res = run(tool, args);
  return {
    exists: true,
    version: res.ok ? (res.stdout.split('\n')[0] || '').trim() : null,
    error: res.ok ? null : res.stderr
  };
}

function hasSupportedNode() {
  const node = detectTool('node', ['--version']);
  if (!node.exists || !node.version) {
    return false;
  }

  const major = Number(String(node.version).replace(/^v/, '').split('.')[0]);
  return Number.isFinite(major) && major >= 20;
}

function systemDoctor() {
  return {
    platform: process.platform,
    node: detectTool('node'),
    npm: detectTool('npm', ['-v']),
    java: detectTool('java', ['-version']),
    git: detectTool('git'),
    pm2: detectTool('pm2', ['-v'])
  };
}

function detectJavaVersion() {
  const res = run('java', ['-version']);
  if (!res.ok) {
    return {
      exists: false,
      version: null,
      error: 'Java is not installed'
    };
  }

  // Parse Java version from output (stdout or stderr)
  const output = res.stdout + res.stderr;
  const versionMatch = output.match(/version\s+"([^"]+)"/);
  if (versionMatch) {
    const version = versionMatch[1];
    const majorVersion = parseInt(version.split('.')[0]);
    return {
      exists: true,
      version: version,
      majorVersion: majorVersion,
      isSuitable: majorVersion >= 8
    };
  }

  return {
    exists: true,
    version: 'unknown',
    error: 'Could not parse Java version'
  };
}

function buildStepRows({ syncBedrockSamples = true, includePrerequisites = 'auto', includeOllama = false } = {}) {
  const steps = [];

  const shouldRunPrerequisites = includePrerequisites === 'auto'
    ? (!hasSupportedNode() || !commandExists('npm'))
    : Boolean(includePrerequisites);

  if (shouldRunPrerequisites) {
    if (process.platform === 'win32') {
      const flags = includeOllama ? '--with-ollama' : '--skip-ollama';
      steps.push({
        label: 'Install prerequisites',
        cmd: 'cmd',
        args: ['/c', 'scripts\\install-prereqs.bat', '--auto', flags]
      });
    } else {
      const flags = includeOllama ? '--with-ollama' : '--skip-ollama';
      steps.push({
        label: 'Install prerequisites',
        cmd: 'bash',
        args: ['scripts/install-prereqs.sh', '--auto', flags]
      });
    }
  }

  steps.push({ label: 'Install dependencies', cmd: 'npm', args: ['install'] });
  steps.push({ label: 'Project setup', cmd: 'npm', args: ['run', 'setup'] });

  if (syncBedrockSamples) {
    steps.push({ label: 'Sync bedrock samples', cmd: 'npm', args: ['run', 'bedrock:sync'] });
  }

  return steps;
}

function oneClickBootstrap({
  syncBedrockSamples = true,
  includePrerequisites = 'auto',
  includeOllama = false,
  onStep
} = {}) {
  const steps = [];

  const rows = buildStepRows({ syncBedrockSamples, includePrerequisites, includeOllama });

  function pushStep(row, stepIndex, totalSteps) {
    const { label, cmd, args } = row;
    const result = run(cmd, args);
    steps.push({ label, cmd: `${cmd} ${args.join(' ')}`, ...result });

    if (typeof onStep === 'function') {
      onStep({
        stepIndex,
        totalSteps,
        label,
        ok: result.ok,
        percent: Math.round((stepIndex / totalSteps) * 100)
      });
    }

    if (!result.ok) {
      throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
    }
  }

  const totalSteps = rows.length;
  rows.forEach((row, i) => {
    pushStep(row, i + 1, totalSteps);
  });

  if (typeof onStep === 'function') {
    onStep({
      stepIndex: totalSteps,
      totalSteps,
      label: 'Complete',
      ok: true,
      percent: 100
    });
  }

  return {
    ok: true,
    steps
  };
}

function checkStartupUpdates() {
  const currentVersion = readPackageVersion();
  const npmLookup = run('npm', ['view', 'minecraft-auto-bedrock', 'version']);
  const gitAhead = run('git', ['rev-list', '--count', 'HEAD..@{upstream}']);

  const latestVersion = npmLookup.ok ? (npmLookup.stdout || '').trim() : null;
  const hasNpmUpdate = Boolean(latestVersion && latestVersion !== currentVersion);
  const behindBy = gitAhead.ok ? Number(gitAhead.stdout || 0) : null;

  return {
    currentVersion,
    latestVersion,
    hasNpmUpdate,
    gitRemoteBehindCount: Number.isNaN(behindBy) ? null : behindBy,
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  systemDoctor,
  detectJavaVersion,
  oneClickBootstrap,
  checkStartupUpdates
};
