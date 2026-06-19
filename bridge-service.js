/**
 * Business One Test Environment — Bridge Service
 * Virtual hardware engine. In the Electron build this is loaded by main.js.
 * Full peripheral interception requires com0com (virtual COM ports) installed separately.
 */

const net = require('net');
const { exec, spawn } = require('child_process');
const path = require('path');

const state = {
  posProcess: null,
  emulatorProcess: null,
  devices: {
    printer: { active: false },
    drawer: { active: false, open: false },
    display: { active: false },
    terminal: { active: false },
    scanner: { active: false },
  },
};

function getStatus() {
  return {
    bridge: 'running',
    devices: state.devices,
    pos: state.posProcess ? { running: true, pid: state.posProcess.pid } : { running: false },
  };
}

function scanBarcode(barcode) {
  const escaped = barcode.replace(/"/g, '`"');
  exec(`powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${escaped}{ENTER}')"`);
}

function kickDrawer() {
  state.devices.drawer.open = true;
  setTimeout(() => { state.devices.drawer.open = false; }, 5000);
}

function launchPos(exePath, args, workDir) {
  const opts = { cwd: workDir || path.dirname(exePath) };
  const argList = (args || '').split(' ').filter(Boolean);
  state.posProcess = spawn(exePath, argList, opts);
  state.posProcess.on('exit', () => { state.posProcess = null; });
  return { pid: state.posProcess.pid };
}

function stopPos() {
  if (state.posProcess) { state.posProcess.kill(); state.posProcess = null; }
}

function startAndroidEmulator(avd) {
  const emulatorPath = process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, 'emulator', 'emulator.exe')
    : 'emulator';
  state.emulatorProcess = spawn(emulatorPath, ['-avd', avd || 'Pixel_Tablet', '-no-snapshot']);
  state.emulatorProcess.on('exit', () => { state.emulatorProcess = null; });
}

function installApk(apkPath) {
  const adb = process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe')
    : 'adb';
  exec(`"${adb}" install -r "${apkPath}"`);
}

function stopAndroid() {
  const adb = process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe')
    : 'adb';
  exec(`"${adb}" emu kill`);
  if (state.emulatorProcess) { state.emulatorProcess.kill(); state.emulatorProcess = null; }
}

function bootIosSimulator(device) {
  exec(`xcrun simctl boot "${device || 'iPad-Pro-12-9-inch-6th-generation'}"`, (err) => {
    if (!err) exec('open -a Simulator');
  });
}

function stopIos() {
  exec('xcrun simctl shutdown booted');
}

module.exports = { getStatus, scanBarcode, kickDrawer, launchPos, stopPos, startAndroidEmulator, installApk, stopAndroid, bootIosSimulator, stopIos };
