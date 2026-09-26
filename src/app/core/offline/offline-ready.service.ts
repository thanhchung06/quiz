import { Injectable, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/** Angular SW asset group with the quiz pictures (ngsw-config.json) — cached lazily, then warmed here. */
const IMAGE_GROUP = 'quiz-images';
const POLL_MS = 2000;
const WARM_CONCURRENCY = 4;

interface NgswManifest {
  assetGroups?: Array<{ name: string; installMode: 'prefetch' | 'lazy'; urls: string[] }>;
}

/**
 * Offline readiness (FR-051), reported from what is actually in Cache Storage
 * rather than from `navigator.serviceWorker.ready` — the worker activates long
 * before it has cached anything, and going offline mid-install used to leave
 * the app unable to open at all.
 *
 * - `ready`: every *prefetch* group of the active app version (the app code,
 *   index.html, icons) is cached, so the app opens with no network.
 * - `imagesCached` / `imagesTotal`: the quiz pictures. They are a lazy group
 *   (one failed picture must not break the app's offline install the way a
 *   failed prefetch does), so once the app itself is ready this service
 *   fetches the missing ones in the background — through the worker, which
 *   caches each on the way — and keeps retrying while online.
 *
 * Reads the worker's own control DB (`ngsw:<scope>:db:control` → `/latest`,
 * `/manifests`) to know which version and files to check, so it also works
 * while offline. In dev mode (no service worker) it reports ready at once.
 */
@Injectable({ providedIn: 'root' })
export class OfflineReadyService {
  private readonly _ready = signal(false);
  private readonly _imagesTotal = signal(0);
  private readonly _imagesCached = signal(0);
  readonly ready = this._ready.asReadonly();
  readonly imagesTotal = this._imagesTotal.asReadonly();
  readonly imagesCached = this._imagesCached.asReadonly();

  private warming = false;

  constructor(private readonly swUpdate: SwUpdate) {
    if (!this.swUpdate.isEnabled || typeof caches === 'undefined') {
      this._ready.set(true);
      return;
    }
    void this.watch();
  }

  private async watch(): Promise<void> {
    const registration = await navigator.serviceWorker.ready.catch(() => undefined);
    if (!registration) return;
    const scope = new URL(registration.scope).pathname;
    for (;;) {
      try {
        await this.check(scope);
      } catch {
        /* Cache Storage unavailable for a moment — try again on the next tick */
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  private async check(scope: string): Promise<void> {
    const manifest = await this.activeManifest(scope);
    if (!manifest) return;
    const groups = manifest.assetGroups ?? [];

    const prefetchUrls = groups.filter((g) => g.installMode === 'prefetch').flatMap((g) => g.urls);
    this._ready.set(prefetchUrls.length > 0 && (await this.countCached(prefetchUrls)) === prefetchUrls.length);

    const imageUrls = groups.find((g) => g.name === IMAGE_GROUP)?.urls ?? [];
    const cached = await this.cachedSubset(imageUrls);
    this._imagesTotal.set(imageUrls.length);
    this._imagesCached.set(cached.size);

    if (this._ready() && cached.size < imageUrls.length && navigator.onLine && navigator.serviceWorker.controller) {
      void this.warmImages(imageUrls.filter((u) => !cached.has(u)));
    }
  }

  /** The manifest of the version the worker currently serves, from its own control DB. */
  private async activeManifest(scope: string): Promise<NgswManifest | undefined> {
    const control = await caches.open(`ngsw:${scope}:db:control`);
    const latest = (await (await control.match('/latest'))?.json()) as { latest?: string } | undefined;
    const manifests = (await (await control.match('/manifests'))?.json()) as Record<string, NgswManifest> | undefined;
    return latest?.latest ? manifests?.[latest.latest] : undefined;
  }

  private async countCached(urls: string[]): Promise<number> {
    return (await this.cachedSubset(urls)).size;
  }

  private async cachedSubset(urls: string[]): Promise<Set<string>> {
    const hits = await Promise.all(urls.map(async (u) => ((await caches.match(u)) ? u : undefined)));
    return new Set(hits.filter((u): u is string => !!u));
  }

  /** Fetches missing pictures through the worker (which caches them), a few at a time; failures are retried on a later tick. */
  private async warmImages(urls: string[]): Promise<void> {
    if (this.warming) return;
    this.warming = true;
    try {
      const queue = [...urls];
      const worker = async () => {
        for (let url = queue.shift(); url; url = queue.shift()) {
          if (!navigator.onLine) return;
          await fetch(url).catch(() => undefined);
        }
      };
      await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
    } finally {
      this.warming = false;
    }
  }
}
