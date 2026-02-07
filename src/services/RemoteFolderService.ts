import type { Folder } from '../db/schema';
import type { IFolderService } from './IFolderService';

/**
 * Remote folder service implementation
 * Handles folder operations via API calls to a remote server
 * Currently unused - API URL to be specified
 */
export class RemoteFolderService implements IFolderService {
  private apiUrl: string;
  private apiKey?: string;

  constructor(apiUrl: string, apiKey?: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  private async fetchApi(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
      ...options.headers,
    };

    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response;
  }

  async createFolder(name: string, parentId?: number): Promise<Folder> {
    const response = await this.fetchApi('/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId: parentId ?? 0 }),
    });

    return response.json();
  }

  async moveFolder(
    folderId: number,
    newParentId: number,
    forceMerge?: boolean
  ): Promise<{ success: boolean; errorCode?: string }> {
    const response = await this.fetchApi(`/folders/${folderId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ newParentId, forceMerge }),
    });

    return response.json();
  }

  async removeFolder(folderId: number): Promise<void> {
    await this.fetchApi(`/folders/${folderId}`, {
      method: 'DELETE',
    });
  }

  async toggleFolderExpanded(folderId: number): Promise<void> {
    await this.fetchApi(`/folders/${folderId}/toggle-expanded`, {
      method: 'PATCH',
    });
  }

  async getAllFolders(): Promise<Folder[]> {
    const response = await this.fetchApi('/folders');
    return response.json();
  }
}
