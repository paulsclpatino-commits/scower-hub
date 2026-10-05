// Entry point: `npm start`, `npm run demo`, or double-click start.cmd / start-demo.cmd.
// Flags:
//   --demo  sample data, no API keys needed
//   --open  running on your own computer: open the browser once ready, and only
//           accept connections from this computer (no firewall prompt, and
//           nobody else on your Wi-Fi can run searches on your API keys)

import { spawn } from 'node:child_process';

const MIN_NODE = [20, 9];
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  console.error(`\n  Scower needs Node.js ${MIN_NODE.join('.')} or newer, but this is Node.js ${process.versions.node}.`);
  console.error('  Install the current "LTS" version from https://nodejs.org and try again.\n');
  process.exit(1);
}

// Loaded after the version check so an old Node.js gets the message above
// instead of a cryptic import error.
let createApp;
let config;
let enabledFeatures;
try {
  ({ createApp } = await import('./src/app.js'));
  ({ config, enabledFeatures } = await import('./src/config.js'));
} catch (err) {
  console.error("\n  Scower's packages are missing or out of date.");
  console.error('  On Windows, double-click start.cmd (or start-demo.cmd) again. In a terminal, run');
  console.error('  "npm install" ("npm.cmd install" in PowerShell) in the Scower folder, then try again.');
  console.error(`\n  Details: ${String(err?.message || err).split('\n')[0]}\n`);
  process.exit(1);
}

const localLaunch = process.argv.includes('--open');
const host = process.env.HOST || (localLaunch ? '127.0.0.1' : undefined);

function openBrowser(target) {
  const [command, args, options] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', target], { windowsVerbatimArguments: true }]
      : process.platform === 'darwin'
        ? ['open', [target], {}]
        : ['xdg-open', [target], {}];
  try {
    spawn(command, args, { ...options, detached: true, stdio: 'ignore', windowsHide: true })
      .on('error', () => {})
      .unref();
  } catch {
    // Opening the browser is a convenience; the URL is printed either way.
  }
}

function logStartup(url) {
  const f = enabledFeatures();
  const mark = (on) => (on ? 'on ' : 'off');
  console.log(`\n  Scower is running at ${url}`);
  console.log(
    localLaunch
      ? '  Keep this window open while you use Scower. Close it to stop Scower.'
      : '  Press Ctrl+C to stop.',
  );
  if (process.platform === 'win32') console.log('  If Scower ever seems stuck, click this window and press Esc.');
  console.log('');
  if (f.demo) {
    console.log('  DEMO MODE - every search returns the same sample listings, whatever photo you use.\n');
    return;
  }
  console.log(`  [${mark(f.identify)}] AI item identification   (ANTHROPIC_API_KEY)`);
  console.log(`  [${mark(f.googleLens)}] Google Lens + Shopping    (SERPAPI_KEY)`);
  if (f.ebay) console.log(`  [on ] eBay photo + keyword      (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)`);
  else console.log(`  [${mark(f.ebaySerpApi)}] eBay                      (via SERPAPI_KEY, or EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)`);
  if (!f.identify && !f.googleLens && !f.ebay) {
    console.log('\n  No API keys found. Put them in the .env file in the Scower folder (see README),');
    console.log('  or run the demo (start-demo.cmd, or `npm run demo`) to try it with sample data.');
  }
  console.log('');
}

/** What's already answering on this port: 'demo', 'real' (another Scower), or null. */
async function scowerOnPort(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1500) });
    const body = await response.json();
    if (!body?.features) return null;
    return body.features.demo ? 'demo' : 'real';
  } catch {
    return null;
  }
}

const wantDemo = enabledFeatures().demo;

async function handleListenError(err, port, attempt) {
  const portBlocked = err.code === 'EADDRINUSE' || err.code === 'EACCES';
  if (!portBlocked) {
    console.error('\n  Scower could not start:', err.message, '\n');
    process.exit(1);
  }

  const running = err.code === 'EADDRINUSE' ? await scowerOnPort(port) : null;
  if (running && (running === 'demo') === wantDemo) {
    // Same Scower started twice: just show the one that's running.
    console.log(`\n  Scower is already running in another window at http://localhost:${port}`);
    if (localLaunch) {
      console.log('  Opening it in your browser.\n');
      openBrowser(`http://localhost:${port}`);
    }
    process.exit(0);
  }
  if (running === 'demo') {
    console.error('\n  The Scower demo is still running in another window.');
    console.error('  Close the demo window, then start Scower again.\n');
    process.exit(1);
  }
  if (running === 'real') {
    console.error('\n  Scower (with your API keys) is already running in another window.');
    console.error('  Close that window first if you want to run the demo.\n');
    process.exit(1);
  }

  // Something else has the port (or Windows reserved it): try the next one.
  if (config.portIsFlexible && attempt < 10) return start(port + 1, attempt + 1);
  console.error(
    err.code === 'EACCES'
      ? `\n  This computer doesn't allow Scower to use port ${port}.`
      : `\n  Another program is already using port ${port}.`,
  );
  console.error('  Pick another port: add a line like PORT=3010 to the .env file in the Scower folder');
  console.error('  (on Windows, double-click edit-settings.cmd to open it), then start again.\n');
  process.exit(1);
}

function start(port, attempt = 0) {
  // Express 5 calls this with an error when the port can't be opened.
  createApp().listen(port, host, (err) => {
    if (err) return handleListenError(err, port, attempt);
    if (port !== config.port) console.log(`\n  Port ${config.port} was busy, so Scower is using port ${port} instead.`);
    const url = `http://localhost:${port}`;
    logStartup(url);
    if (localLaunch) openBrowser(url);
  });
}

start(config.port);
