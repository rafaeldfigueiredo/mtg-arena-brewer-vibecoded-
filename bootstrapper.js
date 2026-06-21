const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("🚀 Initializing Arena Historic Brawl Deckbuilder Project Setup...");

const ROOT_DIR = process.cwd();
const SERVER_DIR = path.join(ROOT_DIR, 'server');
const CLIENT_DIR = path.join(ROOT_DIR, 'client');

// --- Helper function to create directories ---
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// --- Helper function to write files ---
function writeFile(filePath, content) {
    fs.writeFileSync(filePath, content.trim(), 'utf-8');
    console.log(`📝 Created: ${path.relative(ROOT_DIR, filePath)}`);
}

// ==========================================
// 1. ROOT DIRECTORY CONFIGURATION
// ==========================================
ensureDir(SERVER_DIR);
ensureDir(CLIENT_DIR);

const rootPackageJson = {
  "name": "arena-brawl-builder-root",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "install-all": "npm install && npm run install-server && npm run install-client",
    "install-server": "cd server && npm install",
    "install-client": "cd client && npm install",
    "server": "cd server && node app.js",
    "client": "cd client && npm run dev",
    "dev": "npx concurrently \"npm run server\" \"npm run client\""
  }
};
writeFile(path.join(ROOT_DIR, 'package.json'), JSON.stringify(rootPackageJson, null, 2));

// ==========================================
// 2. SERVER (BACKEND) CONFIGURATION
// ==========================================
const serverPackageJson = {
  "name": "brawl-builder-backend",
  "version": "1.0.0",
  "main": "app.js",
  "dependencies": {
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "express": "^4.18.2"
  }
};
writeFile(path.join(SERVER_DIR, 'package.json'), JSON.stringify(serverPackageJson, null, 2));

// server/app.js (Your Node Pipeline)
const appJsContent = `
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
        .replace(/['"’.,\\-]/g, '')
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
            const lines = collectionCsv.split('\\n');
            lines.forEach(line => {
                const parts = line.split(',');
                if (parts.length >= 1) {
                    const name = parts[0].replace(/['"\\r]/g, '').trim().toLowerCase();
                    parsedCollection[name] = true;
                }
            });
        }

        const slug = getCommanderSlug(commanderName);
        console.log(\`Fetching EDHREC data for slug: \${slug}\`);
        const edhrecRes = await axios.get(\`https://json.edhrec.com/pages/commanders/\${slug}.json\`);
        
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
        console.log(\`Found \${uniqueEdhrecNames.length} unique cards suggested by EDHREC.\`);

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

        const decklistTxtContent = ["Commander", \`1 \${commanderName}\`, "\\nDeck"];
        legalDecklist.forEach(c => decklistTxtContent.push(\`1 \${c.name}\`));
        fs.writeFileSync(path.join(__dirname, 'decklist.txt'), decklistTxtContent.join('\\n'), 'utf-8');

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
`;
writeFile(path.join(SERVER_DIR, 'app.js'), appJsContent);

// server/deckSeeker.py (Your original parsing logic)
const deckSeekerPythonContent = `
import os
import time
import json
import re
import requests

def parse_decklist_file(filename="decklist.txt"):
    if not os.path.exists(filename):
        print(f"❌ Error: The file '{filename}' was not found.")
        return None, None

    deck_name = "Untitled Deck"
    deck_items = []
    
    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    for i, line in enumerate(lines):
        line = line.strip()
        if line.startswith("About"):
            if i + 1 < len(lines) and lines[i+1].strip().startswith("Name "):
                deck_name = lines[i+1].replace("Name ", "").strip()
            continue
            
        if not line or line.lower() in ['commander', 'deck', 'sideboard', 'about'] or line.startswith(('//', '#', 'Name ')):
            continue
            
        match = re.match(r"^['\\\"]?(\\d+)\\s+(.+?)(?:\\s+\\([^)]+\\)(?:\\s+\\d+)?)?['\\\"]?$", line)
        
        if match:
            quantity = int(match.group(1))
            card_name = match.group(2).strip().replace(" / ", " // ").replace(" // ", " // ")
            deck_items.append({"name": card_name, "amount": quantity})
            
    return deck_name, deck_items

def get_color_names(color_codes):
    if not color_codes:
        return ["Colorless"]
    mapping = {"W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green"}
    return [mapping[c] for c in color_codes if c in mapping]

def filter_card_keys(data):
    if isinstance(data, dict):
        cleaned = {}
        for k, v in data.items():
            k_lower = k.lower()
            if any(term in k_lower for term in ['uri', 'url', 'set', 'flavor', 'stamp', 'promo']):
                continue
            if k_lower in ('object', 'lang', 'layout', 'legalities', 'id') or k_lower.endswith(('_id', '_ids')):
                continue
            if k_lower in ('nonfoil', 'foil', 'finishes', 'oversized', 'booster', 'textless', 
                           'full_art', 'frame', 'frame_effects', 'border_color', 'highres_image', 
                           'image_status', 'prices', 'artist', 'released_at', 'digital', 
                           'collector_number', 'games', 'preview', 'story_spotlight', 'reprint', 'variation'):
                continue
            cleaned[k] = filter_card_keys(v)
        return cleaned
    elif isinstance(data, list):
        return [filter_card_keys(item) for item in data]
    else:
        return data

def fetch_deck_data_from_scryfall(input_filename="decklist.txt", output_filename="deck_data.json"):
    deck_name, parsed_deck = parse_decklist_file(input_filename)
    if not parsed_deck:
        return

    MAX_BATCH_SIZE = 75
    final_json_output = [{"meta_type": "deck_info", "deck_name": deck_name}]
    
    amount_map = {item["name"].lower().replace("/", "//").replace("////", "//"): item["amount"] for item in parsed_deck}
    identifiers = [{"name": item["name"]} for item in parsed_deck]

    headers = {"User-Agent": "MTGArenaDeckConverter/3.0", "Accept": "application/json"}

    for i in range(0, len(identifiers), MAX_BATCH_SIZE):
        batch = identifiers[i:i + MAX_BATCH_SIZE]
        response = requests.post("https://api.scryfall.com/cards/collection", json={"identifiers": batch}, headers=headers)
        time.sleep(0.1)

        if response.status_code != 200:
            continue

        data = response.json()
        for card in data.get('data', []):
            raw_colors = card.get('colors')
            if 'card_faces' in card:
                face_colors = set()
                for face in card['card_faces']:
                    if 'colors' in face: face_colors.update(face['colors'])
                if not raw_colors and face_colors: raw_colors = list(face_colors)

            cleaned_card = filter_card_keys(card)
            cleaned_card['colors'] = get_color_names(raw_colors)

            card_title = card.get('name', '').lower().replace("/", "//").replace("////", "//")
            cleaned_card['amount'] = amount_map.get(card_title, amount_map.get(card_title.split(" // ")[0], 1))

            final_json_output.append(cleaned_card)

    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(final_json_output, f, indent=4, ensure_ascii=False)

if __name__ == "__main__":
    fetch_deck_data_from_scryfall()
`;
writeFile(path.join(SERVER_DIR, 'deckSeeker.py'), deckSeekerPythonContent);

// ==========================================
// 3. CLIENT (FRONTEND VITE REACTION APPARATUS)
// ==========================================
const clientPackageJson = {
  "name": "brawl-builder-frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0"
  }
};
writeFile(path.join(CLIENT_DIR, 'package.json'), JSON.stringify(clientPackageJson, null, 2));

// Vite Configuration Setup
const viteConfigContent = `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`;
writeFile(path.join(CLIENT_DIR, 'vite.config.js'), viteConfigContent);

// Basic HTML root container frame template file
const indexHtmlContent = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Historic Brawl Brewmaster</title>
  </head>
  <body style="margin: 0; background-color: #1a1a1a;">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
writeFile(path.join(CLIENT_DIR, 'index.html'), indexHtmlContent);

// Fronted Application Source Subtrees
ensureDir(path.join(CLIENT_DIR, 'src'));

const mainJsxContent = `
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`;
writeFile(path.join(CLIENT_DIR, 'src', 'main.jsx'), mainJsxContent);

const appJsxContent = `
import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function App() {
  const [commander, setCommander] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [collectionCsv, setCollectionCsv] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [finalDeck, setFinalDeck] = useState([]);
  const [strategy, setStrategy] = useState('Submit a commander to generate your gameplan...');
  const [missingCards, setMissingCards] = useState([]);

  useEffect(() => {
    if (commander.length < 3) {
      setSuggestions([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      try {
        const res = await axios.get(\`https://api.scryfall.com/cards/autocomplete?q=\${encodeURIComponent(commander)}\`);
        setSuggestions(res.data.data || []);
      } catch (err) { console.error(err); }
    }, 200);

    return () => clearTimeout(delayDebounce);
  }, [commander]);

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setCollectionCsv(event.target.result);
      reader.readAsText(file);
    }
  };

  const processBrewPipeline = async (selectedCommander) => {
    setLoading(true);
    const targetName = selectedCommander || commander;
    try {
      const res = await axios.post('http://localhost:5000/api/brew', {
        commanderName: targetName,
        collectionCsv: collectionCsv
      });

      const processedCards = res.data.processedDecklist.filter(c => c.meta_type !== 'deck_info');
      setFinalDeck(processedCards);

      const unowned = processedCards.filter(c => !c.owned);
      setMissingCards(unowned);
      
      setStrategy(\`🔮 [Data Ready] Historic brawl card analysis assembled for \${targetName}! Pass this layout context payload downstream into your customized Gemini API integration deployment layer to evaluate budget options dynamically.\`);

    } catch (err) {
      alert("Error assembling deck metrics payload: " + err.message);
    } final {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '20px', padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#1a1a1a', color: '#fff', minHeight: '100vh' }}>
      
      {/* LEFT COL */}
      <div style={{ flex: 1, borderRight: '1px solid #444', paddingRight: '20px' }}>
        <h2>🛠️ Input Controls</h2>
        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Commander Name:</label>
          <input 
            type="text" 
            value={commander} 
            onChange={(e) => setCommander(e.target.value)}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #666', background: '#333', color: '#fff' }}
            placeholder="Type your commander..."
          />
          {suggestions.length > 0 && (
            <ul style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#222', border: '1px solid #444', listStyle: 'none', padding: 0, margin: 0, zIndex: 10 }}>
              {suggestions.map((name, i) => (
                <li 
                  key={i} 
                  onClick={() => { setCommander(name); setSuggestions([]); processBrewPipeline(name); }}
                  style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid #333' }}
                >
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Feed Local Collection (.csv):</label>
          <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ color: '#ccc' }} />
          {collectionCsv && <p style={{ color: '#4caf50', fontSize: '12px' }}>✓ Collection loaded</p>}
        </div>

        <button 
          onClick={() => processBrewPipeline()} 
          disabled={loading}
          style={{ width: '100%', padding: '12px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {loading ? 'Brewing...' : 'Assemble Historic Brawl Deck'}
        </button>
      </div>

      {/* MIDDLE COL */}
      <div style={{ flex: 1.5, padding: '0 10px' }}>
        <h2>🎴 Generated Decklist ({finalDeck.length})</h2>
        <div style={{ background: '#111', padding: '15px', borderRadius: '6px', maxHeight: '75vh', overflowY: 'auto', border: '1px solid #333' }}>
          {finalDeck.length === 0 ? <p style={{ color: '#777' }}>Deck list is empty.</p> : (
            <pre style={{ margin: 0, fontSize: '14px', lineHeight: '1.6' }}>
              {finalDeck.map((card, idx) => (
                <div key={idx} style={{ color: card.owned ? '#fff' : '#ff4d4d', display: 'flex', justifyContent: 'space-between' }}>
                  <span>1 {card.name}</span>
                  <span style={{ fontSize: '11px', color: card.owned ? '#4caf50' : '#ff4d4d' }}>
                    {card.owned ? '[OWNED]' : '[MISSING]'}
                  </span>
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>

      {/* RIGHT COL */}
      <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '20px', paddingLeft: '20px', borderLeft: '1px solid #444' }}>
        <div style={{ flex: 1, background: '#252526', padding: '15px', borderRadius: '6px', border: '1px solid #3c3c3c' }}>
          <h3 style={{ marginTop: 0, color: '#00adb5' }}>🧠 Gameplan & Strategy Insights</h3>
          <div style={{ fontSize: '14px', lineHeight: '1.5', color: '#e0e0e0', whiteSpace: 'pre-line' }}>
            {strategy}
          </div>
        </div>

        <div style={{ flex: 1, background: '#252526', padding: '15px', borderRadius: '6px', border: '1px solid #3c3c3c' }}>
          <h3 style={{ marginTop: 0, color: '#ff5722' }}>⚠️ Unmatched/Missing Replacements</h3>
          <div style={{ maxHeight: '25vh', overflowY: 'auto' }}>
            {missingCards.length === 0 ? <p style={{ color: '#777', fontSize: '13px' }}>No missing cards.</p> : (
              <ul style={{ paddingLeft: '20px', margin: 0, fontSize: '13px', color: '#ff8a65' }}>
                {missingCards.map((card, i) => (
                  <li key={i} style={{ marginBottom: '6px' }}>
                    <strong>{card.name}</strong> - <span style={{ color: '#ccc', fontSize: '12px' }}>{card.type_line}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
`;
writeFile(path.join(CLIENT_DIR, 'src', 'App.jsx'), appJsxContent);

// ==========================================
// 4. DEPENDENCY INSTALLATION TRIGGER
// ==========================================
console.log("\n📦 Running global dependency installations via npm (installing root utilities + concurrently)...");
try {
    execSync('npm install concurrently --save-dev', { stdio: 'inherit' });
    console.log("\n⚙️ Root configurations linked successfully!");
    console.log("\n👉 Next steps to run your application:");
    console.log("   1. Run: npm run install-all  (This installs both frontend and backend packages automatically)");
    console.log("   2. Run: npm run dev          (This starts both your client UI and pipeline server at once!)");
} catch (e) {
    console.log("⚠️ Could not run npm install automatically. Please run 'npm run install-all' manually inside the root folder.");
}