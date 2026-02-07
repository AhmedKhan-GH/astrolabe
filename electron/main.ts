import { app, BrowserWindow } from 'electron';
import path from 'path';
import { initDatabase } from './database';
import { setupIpcHandlers } from './ipc';
import { logger } from './utils/logger';

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function createWindow(): void {
  logger.info('Creating application window...');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (!app.isPackaged) {
    logger.info('Loading development URL: http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173');
    //mainWindow.webContents.openDevTools();
  } else {
    const htmlPath = path.join(__dirname, '../../dist/index.html');
    logger.info({ htmlPath }, 'Loading production HTML file');
    mainWindow.loadFile(htmlPath);
  }

  mainWindow.on('closed', () => {
    logger.info('Main window closed');
    mainWindow = null;
  });

  logger.info('Application window created');
}

app.whenReady().then(async () => {
  logger.info('Electron app ready, starting initialization...');

  try {
    logger.info('Step 1/3: Initializing database...');
    initDatabase();

    logger.info('Step 2/3: Setting up IPC handlers...');
    setupIpcHandlers();

    logger.info('Step 3/3: Creating main window...');
    createWindow();

    logger.info('Application started successfully');

    app.on('activate', () => {
      logger.info('App activated (macOS)');
      if (BrowserWindow.getAllWindows().length === 0) {
        logger.info('No windows open, creating new window...');
        createWindow();
      }
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start application');
    app.quit();
  }
});

app.on('window-all-closed', () => {
  logger.info({ platform: process.platform }, 'All windows closed');
  if (process.platform !== 'darwin') {
    logger.info('Quitting application (non-macOS)');
    app.quit();
  } else {
    logger.info('Keeping app alive (macOS behavior)');
  }
});
