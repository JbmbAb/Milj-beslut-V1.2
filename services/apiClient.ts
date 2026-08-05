/**
 * API Client utilities with error handling and request/response interceptors
 */

interface RequestOptions extends RequestInit {
  params?: Record<string, any>;
  timeout?: number;
}

interface ApiResponse<T> {
  data: T;
  status: number;
  ok: boolean;
}

class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private timeout: number;

  constructor(baseUrl: string = '', timeout: number = 30000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(endpoint: string, params?: Record<string, any>): string {
    let url = this.baseUrl + endpoint;
    if (params) {
      const query = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query.append(key, String(value));
        }
      });
      url += `?${query.toString()}`;
    }
    return url;
  }

  /**
   * Make HTTP request with timeout
   */
  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const { params, timeout = this.timeout, ...fetchOptions } = options;
    const url = this.buildUrl(endpoint, params);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          ...this.defaultHeaders,
          ...fetchOptions.headers,
        },
      });

      clearTimeout(timeoutId);

      const data = (await response.json()) as T;

      if (!response.ok) {
        if (response.status === 401) {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem('miljobeslut_admin_bearer');
            window.localStorage.removeItem('miljobeslut_admin_refresh');
            window.localStorage.removeItem('miljobeslut_admin_project');
            window.location.reload();
          }
        }
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
      }

      return { data, status: response.status, ok: true };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const response = await this.request<T>(endpoint, { ...options, method: 'GET' });
    return response.data;
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    const response = await this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.data;
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    const response = await this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.data;
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const response = await this.request<T>(endpoint, { ...options, method: 'DELETE' });
    return response.data;
  }

  /**
   * Update base URL
   */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  /**
   * Update default headers
   */
  setHeaders(headers: Record<string, string>): void {
    this.defaultHeaders = { ...this.defaultHeaders, ...headers };
  }
}

// Export singleton instance
const defaultBaseUrl = typeof process !== 'undefined' ? (process.env.VITE_API_URL || '') : '';
export const apiClient = new ApiClient(defaultBaseUrl);

export default ApiClient;
