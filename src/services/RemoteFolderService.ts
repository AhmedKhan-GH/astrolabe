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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
      ...(options.headers as Record<string, string>),
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

    return response.json() as Promise<Folder>;
  }

  async moveFolder(
    folderId: number,
    newParentId: number
  ): Promise<{ success: boolean }> {
    const response = await this.fetchApi(`/folders/${folderId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ newParentId }),
    });

    return response.json() as Promise<{ success: boolean }>;
  }

  async removeFolder(folderId: number): Promise<void> {
    await this.fetchApi(`/folders/${folderId}/remove`, {
      method: 'DELETE',
    });
  }

  async deleteFolder(folderId: number): Promise<void> {
    await this.fetchApi(`/folders/${folderId}`, {
      method: 'DELETE',
    });
  }

  async toggleFolderExpanded(folderId: number): Promise<void> {
    await this.fetchApi(`/folders/${folderId}/toggle-expanded`, {
      method: 'PATCH',
    });
  }

  async expandAllDescendants(folderId: number): Promise<void> {
    await this.fetchApi(`/folders/${folderId}/expand-all`, {
      method: 'PATCH',
    });
  }

  async collapseAllDescendants(folderId: number): Promise<void> {
    await this.fetchApi(`/folders/${folderId}/collapse-all`, {
      method: 'PATCH',
    });
  }

  async expandAllFolders(): Promise<void> {
    await this.fetchApi('/folders/expand-all', {
      method: 'PATCH',
    });
  }

  async collapseAllFolders(): Promise<void> {
    await this.fetchApi('/folders/collapse-all', {
      method: 'PATCH',
    });
  }

  async getAllFolders(): Promise<Folder[]> {
    const response = await this.fetchApi('/folders');
    return response.json() as Promise<Folder[]>;
  }

  async duplicateFolderTo(sourceFolderId: number, targetParentId: number): Promise<Folder> {
    const response = await this.fetchApi(`/folders/${sourceFolderId}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ targetParentId }),
    });

    return response.json() as Promise<Folder>;
  }
}
