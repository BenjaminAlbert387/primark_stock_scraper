// Step 1: Run the backend server
// Use node server.js in terminal to start the server
// It should say "API running on http://localhost:3000"

import express from "express";
import cors from "cors";
import { getProducts } from "./scraper.js";

const app = express();
const PORT = 3000;

app.use(cors());

// Shared progress state — updated by the scraper, read by /progress endpoint.
// Only one scrape runs at a time so a single object is fine.
let progress = { current: 0, total: 0, running: false };

// GET /progress — polled by the frontend every second during a scrape.
// Returns { current, total, running } so the UI can show a live progress bar.
app.get("/progress", (req, res) => {
    res.json(progress);
});

app.get("/products", async (req, res) => {
    const categoryUrl = "https://www.primark.com/en-gb/c/sale/men";
    const maxPages = parseInt(req.query.pages) || 2;

    // Reset progress at the start of each scrape
    progress = { current: 0, total: 0, running: true };

    try {
        // Pass a callback into getProducts so the scraper can update progress
        // as each product is checked, without needing to know about Express.
        const products = await getProducts(categoryUrl, maxPages, (current, total) => {
            progress.current = current;
            progress.total = total;
        });

        progress.running = false;

        console.log(products.map(p => ({ title: p.title, smallOutOfStock: p.smallOutOfStock })));
        res.json(products);
    } catch (err) {
        progress.running = false;
        console.error(err);
        res.status(500).json({ error: "Failed to fetch products" });
    }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));