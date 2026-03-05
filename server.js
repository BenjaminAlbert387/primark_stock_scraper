// Step 1: Run the backend server
// Use node server.js in terminal to start the server 
// It should say "API running on http://localhost:3000"

import express from "express";
import cors from "cors";
import { getProducts } from "./scraper.js";

const app = express();
const PORT = 3000;

app.use(cors());

app.get("/products", async (req, res) => {
    const categoryUrl = "https://www.primark.com/en-gb/c/sale/men";
    const maxPages = parseInt(req.query.pages) || 2;

    try {
        const products = await getProducts(categoryUrl, maxPages);
        // log to check correctness
        console.log(products.map(p => ({ title: p.title, smallOutOfStock: p.smallOutOfStock })));
        res.json(products);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch products" });
    }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));