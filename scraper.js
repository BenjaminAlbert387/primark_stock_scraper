import { chromium } from "playwright";

export async function getProducts(categoryUrl, maxPages = 2) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        extraHTTPHeaders: { "accept-language": "en-GB,en;q=0.9" }
    });

    const CONCURRENCY = 4;

    const suppressedErrors = [
        "GraphQL", "Apollo", "getCCStock", "preloaded using link preload",
        "OneTrust", "_br_uid_2", "status of 400", "status of 403"
    ];

    async function makePage() {
        const page = await context.newPage();
        page.on("console", msg => {
            const text = msg.text();
            if (suppressedErrors.some(e => text.includes(e))) return;
            if (msg.type() === "error") console.log("BROWSER ERROR:", text);
        });
        // Block images, fonts and CSS — not needed, saves a lot of bandwidth and time
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

    // Step 1: Scrape product URLs (single page, fast enough)
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
    let completed = 0;

    async function worker() {
        const page = await makePage();

        while (queue.length > 0) {
            const productUrl = queue.shift();
            if (!productUrl) break;

            console.log(`[${++completed}/${productUrls.length}] ${productUrl}`);

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
                    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                    for (const script of scripts) {
                        try {
                            const json = JSON.parse(script.textContent);
                            if (json["@type"] !== "ProductGroup") continue;

                            const variants = json.hasVariant || [];
                            let smallInStock = false;

                            for (const variant of variants) {
                                const sizes = variant.size || [];
                                const inStock = variant.offers?.availability === "https://schema.org/InStock";
                                const hasSmall = sizes.some(s => {
                                    const size = s.toUpperCase();
                                    return size === "S" || size === "SMALL";
                                });
                                if (hasSmall && inStock) { smallInStock = true; break; }
                            }

                            if (!smallInStock && variants.length === 0) {
                                const sizes = json.size || [];
                                const inStock = json.offers?.availability === "https://schema.org/InStock";
                                const hasSmall = sizes.some(s => s.toUpperCase() === "S" || s.toUpperCase() === "SMALL");
                                if (hasSmall && inStock) smallInStock = true;
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
        }

        await page.close();
    }

    // Spin up CONCURRENCY workers and wait for all to finish
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    await browser.close();
    console.log(`Done. Total products: ${results.length}`);
    return results;
}