const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [
  ['v0.9.16 package version', packageJson.version === '0.9.16'],
  ['Bedrock package identity', main.includes("const BEDROCK_PACKAGE_NAME = 'Microsoft.MinecraftUWP'" )],
  ['Windows-only detection', main.includes("if (process.platform !== 'win32')")],
  ['PowerShell package lookup', main.includes('Get-AppxPackage -Name')],
  ['registered URI launcher', main.includes("const BEDROCK_URI = 'minecraft://'" ) && main.includes('shell.openExternal(BEDROCK_URI)')],
  ['narrow Bedrock IPC', main.includes("ipcMain.handle('get-bedrock-state'") && main.includes("ipcMain.handle('launch-bedrock'" )],
  ['safe preload bridge', preload.includes("getBedrockState: () => ipcRenderer.invoke('get-bedrock-state')") && preload.includes("launchBedrock: () => ipcRenderer.invoke('launch-bedrock')")],
  ['Bedrock navigation', html.includes('data-page="bedrock"') && html.includes('id="bedrock"')],
  ['separation notice', html.includes('What stays Java-only') && html.includes('not loaded into Bedrock')],
  ['renderer status and action', renderer.includes('function updateBedrockView') && renderer.includes('async function startBedrock') && renderer.includes('window.vortex.launchBedrock()')],
  ['page styling', css.includes('.bedrock-hero') && css.includes('.bedrock-notice')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
if (failed.length) process.exitCode = 1;
