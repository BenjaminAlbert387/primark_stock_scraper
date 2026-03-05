import { chromium } from "playwright";

export async function getProducts(categoryUrl, maxPages = 2) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const results = [];

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = `${categoryUrl}?page=${pageNum}`;
        console.log(`Navigating to ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

        // wait until JSON-LD scripts exist
        await page.waitForFunction(() =>
            document.querySelectorAll('script[type="application/ld+json"]').length > 0
        );
        await page.waitForTimeout(1500);

        const productsOnPage = await page.evaluate(() => {
            const products = [];
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');

            scripts.forEach(script => {
                try {
                    const json = JSON.parse(script.textContent);

                    const processItem = (item, pidField) => {
                        const offer = item.offers;
                        // true = out of stock, false = in stock
                        const smallOutOfStock = offer["@type"] === "AggregateOffer";

                        products.push({
                            title: item.name,
                            url: item.url,
                            img: item.image,
                            pid: item[pidField],
                            smallOutOfStock
                        });
                    };

                    if (json["@type"] === "ProductGroup") {
                        processItem(json, "productGroupID");
                    }

                    if (json["@type"] === "ItemList" && Array.isArray(json.itemListElement)) {
                        json.itemListElement.forEach(el => processItem(el.item, "sku"));
                    }

                } catch {}
            });

            return products;
        });

        console.log(`Page ${pageNum} done, found ${productsOnPage.length} products`);
        results.push(...productsOnPage);
    }

    await browser.close();
    console.log(`Scraping complete, total products: ${results.length}`);
    return results;
}