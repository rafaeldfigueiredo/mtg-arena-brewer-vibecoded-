import axios from 'axios';

const SCRYFALL_BATCH_URL = "https://api.scryfall.com/cards/collection";
const DELAY_MS = 100;

function getCommanderSlug(name) {
    return name.toLowerCase()
        .replace(/['"’.,\-]/g, '')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { commanderName, collectionData } = req.body;
        if (!commanderName) return res.status(400).json({ error: "Commander name required" });

        // Cloaked Environment Variable key lookup
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: "Gemini API Key missing on the cloud server settings platform." });
        }

        // Map uploaded collection data for fast true/false lookups
        const ownedMap = {};
        if (Array.isArray(collectionData)) {
            collectionData.forEach(card => {
                if (card.name) ownedMap[card.name.toLowerCase().trim()] = true;
            });
        }

        // Fetch EDHREC Data via proxy helper to eliminate blockages
        const slug = getCommanderSlug(commanderName);
        const edhrecRes = await axios.get(`https://json.edhrec.com/pages/commanders/${slug}.json`);
        const cardlists = edhrecRes.data.container?.json_dict?.cardlists || [];
        
        let rawEdhrecCards = [];
        cardlists.forEach(list => {
            if (list.cardviews) list.cardviews.forEach(card => rawEdhrecCards.push(card.name));
        });
        const uniqueEdhrecNames = [...new Set(rawEdhrecCards)];

        // Query Scryfall to match cards and evaluate collection status
        const processedDecklist = [];
        const scryfallIdentifiers = uniqueEdhrecNames.map(name => ({ name }));
        const BATCH_SIZE = 75;

        for (let i = 0; i < scryfallIdentifiers.length; i += BATCH_SIZE) {
            const batch = scryfallIdentifiers.slice(i, i + BATCH_SIZE);
            await sleep(DELAY_MS);

            const scryfallRes = await axios.post(SCRYFALL_BATCH_URL, { identifiers: batch });
            const cardsData = scryfallRes.data.data || [];

            cardsData.forEach(card => {
                const isBrawlLegal = card.legalities?.historicbrawl === 'legal' || card.legalities?.brawl === 'legal';
                if (isBrawlLegal) {
                    const normName = card.name.toLowerCase().trim();
                    const baseName = normName.split(" // ")[0];
                    const isOwned = !!(ownedMap[normName] || ownedMap[baseName]);

                    processedDecklist.push({
                        name: card.name,
                        type_line: card.type_line,
                        owned: isOwned
                    });
                }
            });
        }

        // Extract missing items to send to Gemini
        const missingCards = processedDecklist.filter(c => !c.owned).map(c => `${c.name} (${c.type_line})`);
        
        const geminiPayload = {
            contents: [{
                parts: [{
                    text: `You are an expert Magic: The Gathering Arena deck builder specializing in Historic Brawl.\nThe player is brewing a deck commanded by: "${commanderName}".\nHere are the core cards they are MISSING from their collection:\n${JSON.stringify(missingCards)}\n\nPlease provide:\n1. A concise 3-sentence strategy overview for running this commander.\n2. Suggest common Historic Brawl alternative cards that match the mechanics of the missing cards.`
                }]
            }]
        };

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const geminiRes = await axios.post(geminiUrl, geminiPayload);
        const strategyText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Strategy guidelines currently unavailable.";

        // Deliver clean processed packages back to the frontend UI layout
        res.status(200).json({
            processedDecklist,
            strategy: strategyText
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
}