const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// SECURITY FIX 1: Strict payload caps to completely stop memory exhaustion DoS vectors
app.use(express.json({ limit: '2mb' }));

// SECURITY FIX 2: Configured CORS guard explicitly checking against origin rules
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Blocked by CORS configuration rules'));
        }
    }
}));

const SCRYFALL_BATCH_URL = "https://api.scryfall.com/cards/collection";
const DELAY_MS = 100;

// SECURITY FIX 3: Strict, safe alphanumeric filtering to prevent ReDoS or command injection attacks
function cleanCommanderInput(name) {
    if (typeof name !== 'string') return '';
    return name.replace(/[^a-zA-Z0-9\s//'’.,-]/g, '').trim().substring(0, 100);
}

function getCommanderSlug(name) {
    return name.toLowerCase()
        .replace(/['"’.,\-]/g, '')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-');
}

function getColorNames(colorCodes) {
    if (!colorCodes || !Array.isArray(colorCodes)) return ["Colorless"];
    const mapping = { "W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green" };
    return colorCodes.map(c => mapping[c]).filter(Boolean);
}

function filterCardKeys(data) {
    if (typeof data === 'object' && data !== null) {
        if (Array.isArray(data)) {
            return data.map(item => filterCardKeys(item));
        }
        const cleaned = {};
        for (const [k, v] of Object.entries(data)) {
            const kLower = k.toLowerCase();
            if (['uri', 'url', 'set', 'flavor', 'stamp', 'promo'].some(term => kLower.includes(term))) continue;
            if (['object', 'lang', 'layout', 'legalities', 'id'].includes(kLower) || kLower.endsWith('_id') || kLower.endsWith('_ids')) continue;
            if ([
                'nonfoil', 'foil', 'finishes', 'oversized', 'booster', 'textless', 
                'full_art', 'frame', 'frame_effects', 'border_color', 'highres_image', 
                'image_status', 'prices', 'artist', 'released_at', 'digital', 
                'collector_number', 'games', 'preview', 'story_spotlight', 'reprint', 'variation'
            ].includes(kLower)) continue;
            
            cleaned[k] = filterCardKeys(v);
        }
        return cleaned;
    }
    return data;
}

// SECURITY FIX 4: ReDoS-Safe, deterministic state-machine parser for CSVs (No regex back-tracking)
function safeParseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

// SECURITY FIX 5: Simplified in-memory rate limiter guard to avoid external pipeline hammering
const rateLimitCache = new Map();
setInterval(() => rateLimitCache.clear(), 60000); // Reset tracking map every 60 seconds

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/api/brew', async (req, res) => {
    // Basic IP tracking block
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anonymous';
    const requestCount = rateLimitCache.get(clientIp) || 0;
    if (requestCount > 15) {
        return res.status(429).json({ error: "Too many optimization requests. Please try again in a minute." });
    }
    rateLimitCache.set(clientIp, requestCount + 1);

    try {
        const { commanderName, collectionCsv } = req.body;
        const sanitizedCommander = cleanCommanderInput(commanderName);
        if (!sanitizedCommander) return res.status(400).json({ error: "A valid commander name query is required" });

        const ownedMap = {};
        if (typeof collectionCsv === 'string' && collectionCsv.length > 0) {
            const lines = collectionCsv.split(/\r?\n/);
            if (lines.length > 0) {
                const headers = safeParseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
                const countIdx = headers.indexOf('Count');
                const nameIdx = headers.indexOf('Name');

                if (countIdx !== -1 && nameIdx !== -1) {
                    const maxRows = Math.min(lines.length, 10000); // Truncate abuse payloads
                    for (let i = 1; i < maxRows; i++) {
                        if (!lines[i]) continue;
                        const row = safeParseCsvLine(lines[i]).map(cell => cell.replace(/^"|"$/g, ''));
                        if (row[nameIdx]) {
                            const nameToken = row[nameIdx].toLowerCase().replace(/\s*\/\s*/g, " // ").trim();
                            ownedMap[nameToken] = parseInt(row[countIdx], 10) || 1;
                        }
                    }
                }
            }
        }

        const slug = getCommanderSlug(sanitizedCommander);
        console.log(`Fetching deck strategies safely for: ${slug}`);
        
        const edhrecRes = await axios.get(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
            headers: { 'User-Agent': 'BrawlBuilderSecure/1.0' },
            timeout: 5000
        });
        
        const cardlists = edhrecRes.data.container?.json_dict?.cardlists || [];
        let rawEdhrecCards = [];
        cardlists.forEach(list => {
            if (list.cardviews) {
                list.cardviews.forEach(card => {
                    if (card.name) rawEdhrecCards.push({ name: String(card.name) });
                });
            }
        });

        const uniqueEdhrecNames = [...new Set(rawEdhrecCards.map(c => c.name))].slice(0, 150); // Hard logical upper bound match cap
        console.log(`Verifying ${uniqueEdhrecNames.length} unique items safely via Scryfall processing engine...`);

        const finalProcessedDeck = [{"meta_type": "deck_info", "deck_name": `${sanitizedCommander} Historic Brawl Deck`}];
        const scryfallIdentifiers = uniqueEdhrecNames.map(name => ({ name }));
        
        const BATCH_SIZE = 75;
        for (let i = 0; i < scryfallIdentifiers.length; i += BATCH_SIZE) {
            const batch = scryfallIdentifiers.slice(i, i + BATCH_SIZE);
            await sleep(DELAY_MS); // Keeps network layer aligned with rate rules

            const scryfallRes = await axios.post(SCRYFALL_BATCH_URL, { identifiers: batch }, {
                headers: { 'User-Agent': 'BrawlBuilderSecure/1.0' },
                timeout: 5000
            });
            const cardsData = scryfallRes.data.data || [];

            cardsData.forEach(card => {
                const isBrawlLegal = card.legalities?.historicbrawl === 'legal' || card.legalities?.brawl === 'legal';
                
                if (isBrawlLegal) {
                    let rawColors = card.colors;
                    if (card.card_faces && !rawColors) {
                        const faceColors = new Set();
                        card.card_faces.forEach(face => {
                            if (face.colors) face.colors.forEach(c => faceColors.add(c));
                        });
                        rawColors = Array.from(faceColors);
                    }

                    const cleanedCard = filterCardKeys(card);
                    cleanedCard.colors = getColorNames(rawColors);

                    const normalizedTitle = card.name.toLowerCase().replace(/\s*\/\s*/g, " // ");
                    const basicTitle = normalizedTitle.split(" // ")[0].trim();

                    const isOwned = !!(ownedMap[normalizedTitle] || ownedMap[basicTitle]);
                    
                    cleanedCard.amount = 1; 
                    cleanedCard.owned = isOwned;
                    cleanedCard.oracle_text = card.oracle_text || (card.card_faces ? card.card_faces.map(f => f.oracle_text).join(" | ") : "");

                    finalProcessedDeck.push(cleanedCard);
                }
            });
        }

        res.json({
            commander: sanitizedCommander,
            processedDecklist: finalProcessedDeck
        });

    } catch (err) {
        console.error("Pipeline processing failure intercepted safely.");
        // SECURITY FIX 6: Never send err.message or system logs back to client endpoints
        res.status(500).json({ error: "Internal processing failed. Please verify the commander's spelling or your connection status." });
    }
});

app.listen(5000, () => console.log('🛡️ Hardened Processing Server running securely on port 5000'));