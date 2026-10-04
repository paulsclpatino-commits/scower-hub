// Entry point: `npm start`, `npm run demo`, or double-click start.cmd / start-demo.cmd.
// Flags: --demo (sample data, no API keys needed), --open (open the browser once running).

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
const { createApp } = await import('./src/app.js');
const { config, enabledFeatures } = await import('./src/config.js');

function openBrowser(url) {
  const [command, args, options] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url], { windowsVerbatimArguments: true }]
      : process.platform === 'darwin'
        ? ['open', [url], {}]
        : ['xdg-open', [url], {}];
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
  console.log('  Keep this window open while you use it. Press Ctrl+C to stop.\n');
  if (f.demo) {
    console.log('  DEMO MODE - every search returns sample data.\n');
    return;
  }
  console.log(`  [${mark(f.identify)}] AI item identification   (ANTHROPIC_API_KEY)`);
  console.log(`  [${mark(f.googleLens)}] Google Lens + Shopping    (SERPAPI_KEY)`);
  console.log(`  [${mark(f.ebay)}] eBay                      (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)`);
  if (!f.identify && !f.googleLens && !f.ebay) {
    console.log('\n  No API keys found. Put them in the .env file in the Scower folder (see README),');
    console.log('  or run the demo (start-demo.cmd, or `npm run demo`) to try it with sample data.');
  }
  console.log('');
}

function failToStart(err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${config.port} is already in use. Scower may already be running in another window:`);
    console.error(`  open http://localhost:${config.port} in your browser, or close the other window first.`);
    console.error('  To use a different port, add a line like PORT=3001 to the .env file.\n');
  } else {
    console.error('\n  Scower could not start:', err.message, '\n');
  }
  process.exit(1);
}

const url = `http://localhost:${config.port}`;
// Express 5 calls this with an error when the port can't be opened.
createApp().listen(config.port, (err) => {
  if (err) return failToStart(err);
  logStartup(url);
  if (process.argv.includes('--open')) openBrowser(url);
});
