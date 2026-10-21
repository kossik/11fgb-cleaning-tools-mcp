import { afterEach, describe, expect, it, vi } from "vitest";
import ratesJson from "../data/rates.json" with { type: "json" };
import { loadConfig } from "../src/config.js";
import { RateFeed } from "../src/rates.js";
import { CalculationService } from "../src/service.js";
import type { RateDataset } from "../src/types.js";

const FEED_URL = "https://11fgb.test/json/calculator-rates";

function feedResponse(version: string, cacheControl = "private, max-age=300") {
  const dataset: RateDataset = { ...(ratesJson as RateDataset), version };
  return new Response(JSON.stringify(dataset), { headers: { "content-type": "application/json", "cache-control": cacheControl } });
}

/** Stand-in for the website: every rate feed request waits until the test answers it. */
function slowSite() {
  const requests: Array<{ init?: RequestInit; respond: (response: Response) => void }> = [];
  const fetchImpl = ((_url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    requests.push({ init, respond: resolve });
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as typeof fetch;
  return { requests, fetchImpl };
}

async function primed(feed: RateFeed, site: ReturnType<typeof slowSite>, version = "feed-v1", cacheControl?: string) {
  const refreshing = feed.refresh();
  site.requests.at(-1)?.respond(feedResponse(version, cacheControl));
  await refreshing;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rate feed cache", () => {
  it("serves the last good copy while a single slow refresh runs in the background", async () => {
    let now = 0;
    const site = slowSite();
    const feed = new RateFeed(FEED_URL, "feed-token", { fetchImpl: site.fetchImpl, now: () => now });
    await primed(feed, site);
    expect(site.requests[0]?.init?.headers).toEqual({ Authorization: "Bearer feed-token" });
    expect(feed.current().version).toBe("feed-v1");

    now = 299_000;
    expect(feed.current().version).toBe("feed-v1");
    expect(site.requests).toHaveLength(1);

    now = 300_000;
    for (let call = 0; call < 5; call += 1) expect(feed.current().version).toBe("feed-v1");
    expect(site.requests).toHaveLength(2);

    const refreshing = feed.refresh();
    site.requests[1]?.respond(feedResponse("feed-v2"));
    await refreshing;
    expect(feed.current().version).toBe("feed-v2");
    expect(site.requests).toHaveLength(2);
  });

  it("serves the bundled defaults instead of waiting on a cold cache", async () => {
    const site = slowSite();
    const feed = new RateFeed(FEED_URL, undefined, { fetchImpl: site.fetchImpl });
    expect(feed.current().version).toBe(ratesJson.version);
    expect(site.requests).toHaveLength(1);

    const refreshing = feed.refresh();
    site.requests[0]?.respond(feedResponse("feed-v1"));
    await refreshing;
    expect(feed.current().version).toBe("feed-v1");
  });

  it("keeps the last good copy and backs off after a failed refresh", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let now = 0;
    const site = slowSite();
    const feed = new RateFeed(FEED_URL, undefined, { fetchImpl: site.fetchImpl, now: () => now, retryAfterMs: 60_000 });
    await primed(feed, site);

    now = 300_000;
    expect(feed.current().version).toBe("feed-v1");
    const refreshing = feed.refresh();
    site.requests[1]?.respond(new Response("Gateway Timeout", { status: 504 }));
    await refreshing;
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rate_feed_fallback"));

    for (let call = 0; call < 5; call += 1) expect(feed.current().version).toBe("feed-v1");
    expect(site.requests).toHaveLength(2);

    now = 360_000;
    expect(feed.current().version).toBe("feed-v1");
    expect(site.requests).toHaveLength(3);
    await primed(feed, site, "feed-v2");
    expect(feed.current().version).toBe("feed-v2");
  });

  it("uses the feed's max-age as the cache lifetime", async () => {
    let now = 0;
    const site = slowSite();
    const feed = new RateFeed(FEED_URL, undefined, { fetchImpl: site.fetchImpl, now: () => now });
    await primed(feed, site, "feed-v1", "private, max-age=600");

    now = 599_000;
    feed.current();
    expect(site.requests).toHaveLength(1);

    now = 600_000;
    feed.current();
    expect(site.requests).toHaveLength(2);
    await primed(feed, site, "feed-v2");
  });

  it("finishes calculations from the cache while the site is slow to answer", async () => {
    let now = 0;
    const site = slowSite();
    const config = loadConfig();
    config.calculatorDataUrl = FEED_URL;
    const service = new CalculationService(config, new RateFeed(FEED_URL, undefined, { fetchImpl: site.fetchImpl, now: () => now }));
    await primed(service.rates, site);

    now = 301_000;
    const started = performance.now();
    const result = await service.calculate("home-cleaning-cost", { postal_code: "78704", square_feet: 1800, bedrooms: 3, bathrooms: 2 });
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.location.data_version).toBe("feed-v1");
    expect(site.requests).toHaveLength(2);

    await primed(service.rates, site, "feed-v2");
    const next = await service.calculate("home-cleaning-cost", { postal_code: "78704", square_feet: 1800, bedrooms: 3, bathrooms: 2 });
    expect(next.location.data_version).toBe("feed-v2");
  });
});
