import { chromium } from "playwright";

// onProgress(current, total) is an optional callback called after each product
// is checked — used by the server to expose live progress via /progress endpoint.
export async function getProducts(categoryUrl, maxPages = 2, onProgress = null) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        extraHTTPHeaders: { "accept-language": "en-GB,en;q=0.9" }
    });

    const CONCURRENCY = 4;

    // FIX 1: Add ERR_FAILED / net:: errors to the suppressed list — these are
    // caused by intentionally aborted requests (images, fonts, CSS) and are
    // harmless noise. Playwright logs them as browser console errors even though
    // we deliberately aborted them.
    const suppressedErrors = [
        "GraphQL", "Apollo", "getCCStock", "preloaded using link preload",
        "OneTrust", "_br_uid_2", "status of 400", "status of 403",
        "ERR_FAILED", "ERR_ABORTED", "net::", "Failed to load resource"
    ];

    async function makePage() {
        const page = await context.newPage();
        page.on("console", msg => {
            const text = msg.text();
            if (suppressedErrors.some(e => text.includes(e))) return;
            if (msg.type() === "error") console.log("BROWSER ERROR:", text);
        });
        // Block images, fonts and CSS — not needed, saves bandwidth and time.
        // Note: we also suppress the resulting ERR_FAILED console noise above.
        await page.route("**/*", route => {
            const type = route.request().resourceType();
            if (["image", "font", "stylesheet", "media"].includes(type)) {
                route.abort();
            } else {
                route.continue();
            }
        });
        return page;
    }

    // Step 1: Scrape product URLs
    const categoryPage = await makePage();
    const productUrls = [];

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = `${categoryUrl}?page=${pageNum}`;
        console.log(`Scraping category page ${pageNum}: ${url}`);

        await categoryPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await categoryPage.waitForFunction(
            () => {
                const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                return Array.from(scripts).some(s => {
                    try {
                        const json = JSON.parse(s.textContent);
                        return json["@type"] === "ItemList" || json["@type"] === "ProductGroup";
                    } catch { return false; }
                });
            },
            { timeout: 15000 }
        );

        const urlsOnPage = await categoryPage.evaluate(() => {
            const urls = [];
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            scripts.forEach(script => {
                try {
                    const json = JSON.parse(script.textContent);
                    if (json["@type"] === "ProductGroup" && json.url) urls.push(json.url);
                    if (json["@type"] === "ItemList" && Array.isArray(json.itemListElement)) {
                        json.itemListElement.forEach(el => { if (el.item?.url) urls.push(el.item.url); });
                    }
                } catch {}
            });
            return urls;
        });

        console.log(`Found ${urlsOnPage.length} product URLs on page ${pageNum}`);
        productUrls.push(...urlsOnPage);
    }

    await categoryPage.close();
    console.log(`Total products to check: ${productUrls.length}`);

    // Step 2: Check stock in parallel using a concurrency pool
    const results = [];
    const queue = [...productUrls];
    // Tell the server the total upfront so the progress bar has a denominator
    if (onProgress) onProgress(0, productUrls.length);

    async function worker() {
        const page = await makePage();

        while (queue.length > 0) {
            const productUrl = queue.shift();
            if (!productUrl) break;

            // FIX 3: Avoid shared-counter race condition across concurrent workers.
            // Using queue length remaining is safe because queue.shift() is synchronous.
            console.log(`[${productUrls.length - queue.length}/${productUrls.length}] ${productUrl}`);

            try {
                await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

                const jsonLdFound = await page.waitForFunction(
                    () => {
                        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                        return Array.from(scripts).some(s => {
                            try { return JSON.parse(s.textContent)["@type"] === "ProductGroup"; }
                            catch { return false; }
                        });
                    },
                    { timeout: 10000 }
                ).then(() => true).catch(() => false);

                if (!jsonLdFound) {
                    console.warn(`  Skipping — no product data for ${productUrl}`);
                    continue;
                }

                const productData = await page.evaluate(() => {
                    // FIX 2: Robust size matching helper.
                    // - Handles size being a string OR an array (Primark's schema is inconsistent)
                    // - Uses exact equality only: "S" and "SMALL", NOT substring match.
                    //   This prevents "XS", "XS/S", "2XS" etc. from matching.
                    function isSmallSize(sizeValue) {
                        const normalize = s => s.trim().toUpperCase();
                        const isExactSmall = s => s === "S" || s === "SMALL";

                        if (Array.isArray(sizeValue)) {
                            return sizeValue.map(normalize).some(isExactSmall);
                        }
                        if (typeof sizeValue === "string") {
                            return isExactSmall(normalize(sizeValue));
                        }
                        return false;
                    }

                    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                    for (const script of scripts) {
                        try {
                            const json = JSON.parse(script.textContent);
                            if (json["@type"] !== "ProductGroup") continue;

                            const variants = Array.isArray(json.hasVariant) ? json.hasVariant : [];
                            let smallInStock = false;

                            if (variants.length > 0) {
                                // Normal path: product has colour/size variants
                                for (const variant of variants) {
                                    const inStock = variant.offers?.availability === "https://schema.org/InStock";
                                    if (inStock && isSmallSize(variant.size)) {
                                        smallInStock = true;
                                        break;
                                    }
                                }
                            } else {
                                // Fallback path: no hasVariant array — check top-level size/offers
                                const inStock = json.offers?.availability === "https://schema.org/InStock";
                                if (inStock && isSmallSize(json.size)) {
                                    smallInStock = true;
                                }
                            }

                            return {
                                title: json.name,
                                url: json.url,
                                img: json.image,
                                pid: json.productGroupID,
                                smallOutOfStock: !smallInStock
                            };
                        } catch {}
                    }
                    return null;
                });

                if (productData) {
                    console.log(`  ${productData.title} — small ${productData.smallOutOfStock ? "OUT OF STOCK" : "IN STOCK"}`);
                    results.push(productData);
                } else {
                    console.warn(`  Skipping — could not parse data for ${productUrl}`);
                }

            } catch (err) {
                console.warn(`  Skipping — ${productUrl}: ${err.message.split('\n')[0]}`);
            }

            // Report progress after every product regardless of success/skip/error
            if (onProgress) onProgress(productUrls.length - queue.length, productUrls.length);
        }

        await page.close();
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    await browser.close();
    console.log(`Done. Total products: ${results.length}`);
    return results;
}