import { Injectable } from '@nestjs/common';

interface RegistryCache<T> {
  data: T | null;
  expiresAt: number;
}

@Injectable()
export class ModuleRegistryService {
  private readonly cacheTtlMs = Number(process.env.MODULE_REGISTRY_CACHE_TTL_MS || 60000);
  private cache: RegistryCache<unknown[]> = { data: null, expiresAt: 0 };

  async getRegistry(forceRefresh = false): Promise<unknown[]> {
    const now = Date.now();
    if (!forceRefresh && this.cache.data && this.cache.expiresAt > now) {
      return this.cache.data;
    }

    const mainBaseUrl = process.env.MAIN_BASE_URL || 'http://main-system:3000';
    const url = `${mainBaseUrl}/api/main-system/v1/modules/registry`;

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Registry fetch failed: ${res.status}`);
      }

      const data = (await res.json()) as unknown[];
      this.cache = { data, expiresAt: now + this.cacheTtlMs };
      return data;
    } catch {
      return this.cache.data || [];
    }
  }
}
