import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AppConfig } from '../shared/types';

// Config file path (same as Python version for compatibility)
const CONFIG_DIR = path.join(os.homedir(), '.omada-wlan-manager');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const defaultConfig: AppConfig = {
  url: '',
  username: '',
  password: '',
  language: 'es'
};

/**
 * Load configuration from disk
 */
export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const config = JSON.parse(data) as Partial<AppConfig>;
      return {
        url: config.url || '',
        username: config.username || '',
        password: config.password || '',
        language: config.language || 'es'
      };
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  return { ...defaultConfig };
}

/**
 * Save configuration to disk
 */
export function saveConfig(config: AppConfig): boolean {
  try {
    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

/**
 * Get a single config value
 */
export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  const config = loadConfig();
  return config[key];
}
