import { net } from 'electron';
import { AccessPoint, WlanGroup, OmadaApiResponse } from '../shared/types';

/**
 * Omada Controller API Client
 * Handles authentication and communication with TP-Link Omada Controller
 */
export class OmadaController {
  private baseUrl: string;
  private username: string;
  private password: string;
  private omadacId: string | null = null;
  private csrfToken: string | null = null;
  private cookies: string[] = [];

  constructor(baseUrl: string, username: string, password: string) {
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
  }

  /**
   * Connect to the Omada controller and authenticate
   */
  async connect(): Promise<boolean> {
    try {
      // Step 1: Get controller info to retrieve omadacId
      const infoResponse = await this.request<{ omadacId: string }>('/api/info', 'GET');

      if (!infoResponse.result?.omadacId) {
        throw new Error('No se pudo obtener el ID del controlador');
      }

      this.omadacId = infoResponse.result.omadacId;

      // Step 2: Login to get CSRF token
      const loginResponse = await this.request<{ token: string }>(
        `/${this.omadacId}/api/v2/login`,
        'POST',
        { username: this.username, password: this.password }
      );

      if (loginResponse.errorCode !== 0) {
        throw new Error(loginResponse.msg || 'Error de autenticación');
      }

      if (!loginResponse.result?.token) {
        throw new Error('No se recibió token de autenticación');
      }

      this.csrfToken = loginResponse.result.token;
      return true;
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  /**
   * Get all access points from the controller
   */
  async getAccessPoints(): Promise<AccessPoint[]> {
    if (!this.omadacId || !this.csrfToken) {
      throw new Error('No conectado al controlador');
    }

    const response = await this.request<AccessPoint[]>(
      `/${this.omadacId}/api/v2/sites/Default/devices`,
      'GET'
    );

    if (response.errorCode !== 0) {
      throw new Error(response.msg || 'Error al obtener access points');
    }

    // Filter only access points (type === 'ap')
    const aps = (response.result || []).filter(device => device.type === 'ap');

    // Sort alphabetically by name
    return aps.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get all WLAN groups from the controller
   */
  async getWlanGroups(): Promise<WlanGroup[]> {
    if (!this.omadacId || !this.csrfToken) {
      throw new Error('No conectado al controlador');
    }

    // The API returns { result: { ssids: [...] } } not { result: [...] }
    const response = await this.request<{ ssids: WlanGroup[] }>(
      `/${this.omadacId}/api/v2/sites/Default/setting/ssids`,
      'GET'
    );

    if (response.errorCode !== 0) {
      throw new Error(response.msg || 'Error al obtener grupos WLAN');
    }

    const wlans = response.result?.ssids || [];

    // Sort alphabetically by name
    return wlans.sort((a, b) => a.wlanName.localeCompare(b.wlanName));
  }

  /**
   * Assign a WLAN group to an access point
   */
  async setApWlanGroup(mac: string, wlanId: string): Promise<boolean> {
    if (!this.omadacId || !this.csrfToken) {
      throw new Error('No conectado al controlador');
    }

    const response = await this.request(
      `/${this.omadacId}/api/v2/sites/Default/eaps/${mac}`,
      'PATCH',
      { wlanId }
    );

    if (response.errorCode !== 0) {
      throw new Error(response.msg || 'Error al asignar grupo WLAN');
    }

    return true;
  }

  /**
   * Make an HTTP request to the Omada API using Electron's net module
   */
  private request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH',
    body?: Record<string, unknown>
  ): Promise<OmadaApiResponse<T>> {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${endpoint}`;

      const request = net.request({
        method,
        url,
        // Electron's net module handles SSL certificates via the app's certificate-error event
      });

      // Set headers
      request.setHeader('Content-Type', 'application/json');
      request.setHeader('Accept', 'application/json');

      if (this.csrfToken) {
        request.setHeader('Csrf-Token', this.csrfToken);
      }

      if (this.cookies.length > 0) {
        request.setHeader('Cookie', this.cookies.join('; '));
      }

      let responseData = '';

      request.on('response', (response) => {
        // Store cookies from response
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
          this.cookies = Array.isArray(setCookie)
            ? setCookie.map(c => c.split(';')[0].trim())
            : [setCookie.split(';')[0].trim()];
        }

        response.on('data', (chunk) => {
          responseData += chunk.toString();
        });

        response.on('end', () => {
          try {
            const data = JSON.parse(responseData) as OmadaApiResponse<T>;
            resolve(data);
          } catch (error) {
            reject(new Error(`Error parsing response: ${responseData}`));
          }
        });

        response.on('error', (error: Error) => {
          reject(error);
        });
      });

      request.on('error', (error: Error) => {
        reject(new Error(`No se pudo conectar al controlador: ${error.message}`));
      });

      // Send body if present
      if (body) {
        request.write(JSON.stringify(body));
      }

      request.end();
    });
  }
}
