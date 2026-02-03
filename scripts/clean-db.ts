import path from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

// Get the data directory path
function getDataDir(): string {
  if (process.env.DATA_DIR) {
    // Resolve relative paths from project root
    return path.resolve(__dirname, '..', process.env.DATA_DIR);
  }

  // Default based on OS (same logic as Electron's app.getPath('userData'))
  const appName = 'astrolabe';
  let userDataPath: string;

  if (process.platform === 'darwin') {
    userDataPath = path.join(os.homedir(), 'Library', 'Application Support', appName);
  } else if (process.platform === 'win32') {
    userDataPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  } else {
    // Linux
    userDataPath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
  }

  return path.join(userDataPath, 'data');
}

const dbPath = getDataDir();
const drizzlePath = path.join(__dirname, '..', 'drizzle');

console.log('Cleaning database...');
console.log('Database path:', dbPath);

// Clean database directory
if (fs.existsSync(dbPath)) {
  fs.rmSync(dbPath, { recursive: true, force: true });
  console.log('✓ Database cleaned');
} else {
  console.log('✓ No database found');
}

// Clean drizzle migrations folder
if (fs.existsSync(drizzlePath)) {
  fs.rmSync(drizzlePath, { recursive: true, force: true });
  console.log('✓ Drizzle folder cleaned');
} else {
  console.log('✓ No drizzle folder found');
}

console.log('Done!');
