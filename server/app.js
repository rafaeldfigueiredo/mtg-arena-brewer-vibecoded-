const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const SCRYFALL_BATCH_URL = "https://api.scryfall.com/cards/collection";
const DELAY_MS = 100;

function getCommanderSlug(name) {
    return name.toLowerCase()
        .replace(/['"’.,\-]/g, '')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/api/brew', async (req, res) => {
    try {
        const { commanderName, collectionCsv } = req.body;
        if (!commanderName) return res.status(400).json({ error: "Commander name required" });

        const parsedCollection = {};
        if (collectionCsv) {
            const lines = collectionCsv.split('\n');
            lines.forEach(line => {
                const parts = line.split(',');
                if (parts.length >= 1) {
                    const name = parts[0].replace(/['"\r]/g, '').trim().toLowerCase();
                    parsedCollection[name] = true;
                }
            });
        }

        const slug = getCommanderSlug(commanderName);
        console.log(`Fetching EDHREC data for slug: ${slug}`);
        const edhrecRes = await axios.get(`https://json.edhrec.com/pages/commanders/${slug}.json`);
        
        const cardlists = edhrecRes.data.container?.json_dict?.cardlists || [];
        let rawEdhrecCards = [];
        cardlists.forEach(list => {
            if (list.cardviews) {
                list.cardviews.forEach(card => {
                    rawEdhrecCards.push({ name: card.name });
                });
            }
        });

        const uniqueEdhrecNames = [...new Set(rawEdhrecCards.map(c => c.name))];
        console.log(`Found ${uniqueEdhrecNames.length} unique cards suggested by EDHREC.`);

        const legalDecklist = [];
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
                    const normalizedName = card.name.toLowerCase();
                    const isOwned = !!parsedCollection[normalizedName];

                    legalDecklist.push({
                        name: card.name,
                        mana_cost: card.mana_cost || (card.card_faces ? card.card_faces[0].mana_cost : ""),
                        type_line: card.type_line,
                        color_identity: card.color_identity,
                        oracle_text: card.oracle_text || (card.card_faces ? card.card_faces.map(f => f.oracle_text).join(" | ") : ""),
                        owned: isOwned
                    });
                }
            });
        }

        const decklistTxtContent = ["Commander", `1 ${commanderName}`, "\nDeck"];
        legalDecklist.forEach(c => decklistTxtContent.push(`1 ${c.name}`));
        fs.writeFileSync(path.join(__dirname, 'decklist.txt'), decklistTxtContent.join('\n'), 'utf-8');

        // Spawns your custom python script wrapper inside the server context
        const pythonProcess = spawn('python', ['deckSeeker.py']);

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return res.status(500).json({ error: "Failed to run deckSeeker.py utility wrapper" });
            }

            const rawCleanData = fs.readFileSync(path.join(__dirname, 'deck_data.json'), 'utf-8');
            const cleanDeckData = JSON.parse(rawCleanData);

            const enrichedDeck = cleanDeckData.map(item => {
                if (item.meta_type === 'deck_info') return item;
                const match = legalDecklist.find(l => l.name.toLowerCase() === item.name?.toLowerCase());
                return {
                    ...item,
                    owned: match ? match.owned : false,
                    oracle_text: match ? match.oracle_text : ""
                };
            });

            res.json({
                commander: commanderName,
                processedDecklist: enrichedDeck,
                rawCollectionReference: parsedCollection
            });
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(5000, () => console.log('🚀 Server running on port 5000'));