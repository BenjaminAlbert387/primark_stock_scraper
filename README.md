# primark_stock_scraper

---

# Primark Stock Scraper

This project scrapes Primark category pages for product stock status using **Playwright** and the internal stock API.

> ⚠️ Live scraping can be slow and may fail intermittently due to site changes, network issues, or internal API restrictions.

---

## Prerequisites

* **Node.js 18+** installed
* Internet connection
* Enough system memory to run Chromium via Playwright

---

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/primark-stock-scraper.git
cd primark-stock-scraper
```

2. Install dependencies:

```bash
npm install
```

Playwright will automatically download Chromium.

---

## Running the scraper

```bash
node server.js
```

The server will start on:

```
http://localhost:3000
```

---

## API Endpoint

* **GET** `/products`
  Returns a JSON array of all products in the category with their stock status:

```json
[
  {
    "url": "https://www.primark.com/en-gb/p/microfleece-joggers-light-grey-991149561704",
    "smallOutOfStock": false
  },
  {
    "url": "https://www.primark.com/en-gb/p/crew-neck-jumper-pink-991135479306",
    "smallOutOfStock": true
  }
]
```

* `smallOutOfStock: true` → no stock available.
* `smallOutOfStock: false` → at least one variant in stock.

---

## Notes

* The scraper uses **live Playwright browser automation**.
* For large categories, scraping may take several seconds per product.
* Occasionally, pages may fail to load or return empty results due to network or site changes. Restart the server and try again if this happens.

---

## Optional: Debugging

* Check console logs to see which SKUs are being fetched.
* Increase timeouts in `server.js` if pages fail to load.
* Ensure your network allows Chromium to access the Primark site.

---

This README is **enough for someone else to run the scraper live** without changing code.

---

Do you want me to add that?
