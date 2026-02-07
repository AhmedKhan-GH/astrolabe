import type { File } from '../db/schema';
import type { IFileService } from './IFileService';

/**
 * Remote file service implementation
 * Handles file operations via API calls to a remote server
 * Currently unused - API URL to be specified
 */
export class RemoteFileService implements IFileService {
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

  async importFiles(filePaths: string[], folderId?: number): Promise<File[]> {
    const response = await this.fetchApi('/files/import', {
      method: 'POST',
      body: JSON.stringify({ filePaths, folderId }),
    });

    return response.json();
  }

  async referenceFiles(filePaths: string[], folderId?: number): Promise<File[]> {
    const response = await this.fetchApi('/files/reference', {
      method: 'POST',
      body: JSON.stringify({ filePaths, folderId }),
    });

    return response.json();
  }

  async moveFile(fileId: number, folderId: number): Promise<void> {
    await this.fetchApi(`/files/${fileId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ folderId }),
    });
  }

  async addFileToFolder(fileId: number, folderId: number): Promise<void> {
    await this.fetchApi(`/files/${fileId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ folderId }),
    });
  }

  async removeFileFromFolder(fileId: number, folderId: number): Promise<void> {
    await this.fetchApi(`/files/${fileId}/folders/${folderId}`, {
      method: 'DELETE',
    });
  }

  async deleteFile(fileId: number): Promise<void> {
    await this.fetchApi(`/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  async getAllFiles(): Promise<File[]> {
    const response = await this.fetchApi('/files');
    return response.json();
  }
}
