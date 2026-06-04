const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

let mainWindow;
let serialPort = null;
let parser = null;
let isConnected = false;
let commandQueue = [];
let isProcessingCommand = false;
let currentCommandCallback = null;
let responseBuffer = [];
let responseTimeout = null;

// ─── Window Creation ──────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0e27',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    icon: path.join(__dirname, 'src', 'assets', 'icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    if (serialPort && serialPort.isOpen) {
      serialPort.close();
    }
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── Window Controls ──────────────────────────────────────────────────────────

ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
});

// ─── Serial Port Management ──────────────────────────────────────────────────

ipcMain.handle('serial:list-ports', async () => {
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || 'Unknown',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      serialNumber: p.serialNumber || '',
      friendlyName: p.friendlyName || p.path,
      pnpId: p.pnpId || ''
    }));
  } catch (err) {
    console.error('Error listing ports:', err);
    return [];
  }
});

ipcMain.handle('serial:connect', async (event, portPath, baudRate = 115200) => {
  try {
    if (serialPort && serialPort.isOpen) {
      await new Promise((resolve, reject) => {
        serialPort.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    serialPort = new SerialPort({
      path: portPath,
      baudRate: parseInt(baudRate),
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    return new Promise((resolve, reject) => {
      serialPort.open((err) => {
        if (err) {
          console.error('Error opening port:', err);
          isConnected = false;
          sendConnectionStatus(false, err.message);
          reject(err.message);
          return;
        }

        // Try to enable DTR/RTS — virtual COM ports (like DW5821e) may not support this
        try {
          serialPort.set({ dtr: true, rts: true }, () => {});
        } catch (e) {
          // Silently ignore — not required for virtual serial ports
        }

        isConnected = true;
        sendConnectionStatus(true);

        // Handle incoming data
        parser.on('data', (data) => {
          const line = data.toString().trim();
          if (line.length === 0) return;

          // Send raw data to renderer
          mainWindow?.webContents.send('serial:data', line);

          // Buffer response for command processing
          responseBuffer.push(line);

          // Check if we got a terminal response (OK, ERROR, etc.)
          if (isTerminalResponse(line)) {
            clearTimeout(responseTimeout);
            if (currentCommandCallback) {
              currentCommandCallback(responseBuffer.join('\n'));
              currentCommandCallback = null;
              responseBuffer = [];
              isProcessingCommand = false;
              processNextCommand();
            }
          }
        });

        serialPort.on('error', (err) => {
          console.error('Serial error:', err);
          mainWindow?.webContents.send('serial:error', err.message);
        });

        serialPort.on('close', () => {
          isConnected = false;
          sendConnectionStatus(false);
        });

        resolve({ success: true, port: portPath });
      });
    });
  } catch (err) {
    console.error('Connection error:', err);
    throw err;
  }
});

ipcMain.handle('serial:disconnect', async () => {
  try {
    if (serialPort && serialPort.isOpen) {
      commandQueue = [];
      isProcessingCommand = false;
      currentCommandCallback = null;
      responseBuffer = [];

      await new Promise((resolve, reject) => {
        serialPort.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    isConnected = false;
    sendConnectionStatus(false);
    return { success: true };
  } catch (err) {
    console.error('Disconnect error:', err);
    throw err;
  }
});

ipcMain.handle('serial:send', async (event, command) => {
  return new Promise((resolve, reject) => {
    if (!serialPort || !serialPort.isOpen) {
      reject('Serial port is not connected');
      return;
    }

    commandQueue.push({ command, callback: resolve });
    processNextCommand();
  });
});

// Raw write — sends data without appending \r\n (used for SMS PDU payloads + Ctrl+Z)
ipcMain.handle('serial:send-raw', async (event, data) => {
  return new Promise((resolve, reject) => {
    if (!serialPort || !serialPort.isOpen) {
      reject('Serial port is not connected');
      return;
    }

    commandQueue.push({ command: data, callback: resolve, raw: true });
    processNextCommand();
  });
});

ipcMain.handle('serial:is-connected', () => {
  return isConnected && serialPort && serialPort.isOpen;
});

// ─── Command Queue Processing ─────────────────────────────────────────────────

function processNextCommand() {
  if (isProcessingCommand || commandQueue.length === 0) return;

  const { command, callback, raw } = commandQueue.shift();
  isProcessingCommand = true;
  currentCommandCallback = callback;
  responseBuffer = [];

  // Send command — raw mode skips \r\n (used for SMS PDU payloads)
  const payload = raw ? command : command + '\r\n';
  serialPort.write(payload, (err) => {
    if (err) {
      console.error('Write error:', err);
      isProcessingCommand = false;
      currentCommandCallback = null;
      callback('ERROR: ' + err.message);
      processNextCommand();
      return;
    }
  });

  // Set timeout for response
  responseTimeout = setTimeout(() => {
    if (currentCommandCallback) {
      const response = responseBuffer.length > 0
        ? responseBuffer.join('\n')
        : 'TIMEOUT: No response from modem';
      currentCommandCallback(response);
      currentCommandCallback = null;
      responseBuffer = [];
      isProcessingCommand = false;
      processNextCommand();
    }
  }, 10000); // 10 second timeout
}

function isTerminalResponse(line) {
  const terminals = ['OK', 'ERROR', '+CME ERROR', '+CMS ERROR', 'NO CARRIER', 'BUSY', 'NO ANSWER'];
  return terminals.some(t => line.startsWith(t));
}

function sendConnectionStatus(connected, error = null) {
  mainWindow?.webContents.send('serial:connection-status', { connected, error });
}
