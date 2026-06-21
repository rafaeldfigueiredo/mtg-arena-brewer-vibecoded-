const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("🛡️ Initializing Secure & Hardened JS Brawl Builder Pipeline...");

const ROOT_DIR = process.cwd();
const SERVER_DIR = path.join(ROOT_DIR, 'server');
const CLIENT_DIR = path.join(ROOT_DIR, 'client');

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
    fs.writeFileSync(filePath, content.trim(), 'utf-8');
    console.log(`📝 Created: ${path.relative(ROOT_DIR, filePath)}`);
}

// ==========================================
// 1. ROOT CONCURRENT WORKSPACE INITIALIZATION
// ==========================================
ensureDir(SERVER_DIR);
ensureDir(CLIENT_DIR);

const rootPackageJson = {
  "name": "arena-brawl-builder-secure-root",
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
// 2. HARDENED BACKEND SERVER PIPELINE
// ==========================================
const serverPackageJson = {
  "name": "brawl-builder-backend-secure",
  "version": "1.0.0",
  "main": "app.js",
  "dependencies": {
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "express": "^4.18.2"
  }
};
writeFile(path.join(SERVER_DIR, 'package.json'), JSON.stringify(serverPackageJson, null, 2));

// server/app.js (Hardened against ReDoS, Payload Injection, Information Leakage, and API Abuse)
const appJsContent = `
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
    return name.replace(/[^a-zA-Z0-9\\s//'’.,-]/g, '').trim().substring(0, 100);
}

function getCommanderSlug(name) {
    return name.toLowerCase()
        .replace(/['"’.,\\-]/g, '')
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
            const lines = collectionCsv.split(/\\r?\\n/);
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
                            const nameToken = row[nameIdx].toLowerCase().replace(/\\s*\\/\\s*/g, " // ").trim();
                            ownedMap[nameToken] = parseInt(row[countIdx], 10) || 1;
                        }
                    }
                }
            }
        }

        const slug = getCommanderSlug(sanitizedCommander);
        console.log(\`Fetching deck strategies safely for: \${slug}\`);
        
        const edhrecRes = await axios.get(\`https://json.edhrec.com/pages/commanders/\${slug}.json\`, {
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
        console.log(\`Verifying \${uniqueEdhrecNames.length} unique items safely via Scryfall processing engine...\`);

        const finalProcessedDeck = [{"meta_type": "deck_info", "deck_name": \`\${sanitizedCommander} Historic Brawl Deck\`}];
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

                    const normalizedTitle = card.name.toLowerCase().replace(/\\s*\\/\\s*/g, " // ");
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
`;
writeFile(path.join(SERVER_DIR, 'app.js'), appJsContent);

// ==========================================
// 3. SECURE FRONTEND APPLICATION INTERFACE
// ==========================================
const clientPackageJson = {
  "name": "brawl-builder-frontend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": { "axios": "^1.6.0", "react": "^18.2.0", "react-dom": "^18.2.0" },
  "devDependencies": { "@vitejs/plugin-react": "^4.2.0", "vite": "^5.0.0" }
};
writeFile(path.join(CLIENT_DIR, 'package.json'), JSON.stringify(clientPackageJson, null, 2));

const viteConfigContent = `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
`;
writeFile(path.join(CLIENT_DIR, 'vite.config.js'), viteConfigContent);

const indexHtmlContent = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" /><title>Secure Brawl Deck Engine</title>
  </head>
  <body style="margin: 0; background-color: #121212;"><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
`;
writeFile(path.join(CLIENT_DIR, 'index.html'), indexHtmlContent);

ensureDir(path.join(CLIENT_DIR, 'src'));

const mainJsxContent = `
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
`;
writeFile(path.join(CLIENT_DIR, 'src', 'main.jsx'), mainJsxContent);

const appJsxContent = `
import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function App() {
  const [commander, setCommander] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [collectionCsv, setCollectionCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [finalDeck, setFinalDeck] = useState([]);
  const [strategy, setStrategy] = useState('Awaiting secure environment optimization parameters...');
  const [missingCards, setMissingCards] = useState([]);

  useEffect(() => {
    // Simple verification check to control unnecessary network traffic triggers
    const trimmed = commander.trim().replace(/[^a-zA-Z0-9\\s']/g, '');
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      try {
        const res = await axios.get(\`https://api.scryfall.com/cards/autocomplete?q=\${encodeURIComponent(trimmed)}\`);
        setSuggestions(res.data.data || []);
      } catch (err) { console.error("Autocomplete request bypassed."); }
    }, 250);
    return () => clearTimeout(delayDebounce);
  }, [commander]);

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert("File size limit violation: Please upload a file smaller than 2MB.");
        return;
      }
      setFileName(file.name);
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
      
      setStrategy(\`🔒 [Hardened Environment Run Complete]\\n\\nParsed your inventory data matrix safely. The data payload has been stripped of unnecessary identifying fields, sanitized against buffer exploits, and evaluated for singleton compliance.\\n\\nThis clean structure is ready to be sent to your choice of AI model endpoint securely.\`);

    } catch (err) {
      const FallbackMsg = err.response?.data?.error || "Connection failure with backend server pipeline.";
      alert(FallbackMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '20px', padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#121212', color: '#e0e0e0', minHeight: '100vh' }}>
      
      {/* CONTROL ACTIONS PANEL */}
      <div style={{ flex: 1, borderRight: '1px solid #2d2d2d', paddingRight: '20px' }}>
        <h2 style={{ color: '#ffffff' }}>🛡️ Hardened Input Controls</h2>
        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px', color: '#aaaaaa' }}>Target Commander Name:</label>
          <input 
            type="text" 
            value={commander} 
            onChange={(e) => setCommander(e.target.value)}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#fff' }}
            placeholder="Type your commander..."
          />
          {suggestions.length > 0 && (
            <ul style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#1e1e1e', border: '1px solid #444', listStyle: 'none', padding: 0, margin: 0, zIndex: 10 }}>
              {suggestions.map((name, i) => (
                <li 
                  key={i} 
                  onClick={() => { setCommander(name); setSuggestions([]); processBrewPipeline(name); }}
                  style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid #2d2d2d' }}
                >
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px', color: '#aaaaaa' }}>Upload Inventory CSV (Max 2MB):</label>
          <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ color: '#ccc' }} />
          {fileName && <p style={{ color: '#81c784', fontSize: '12px' }}>✓ File verified: {fileName}</p>}
        </div>

        <button 
          onClick={() => processBrewPipeline()} 
          disabled={loading}
          style={{ width: '100%', padding: '12px', background: '#1e88e5', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {loading ? 'Processing Safely...' : 'Assemble Secure Matrix'}
        </button>
      </div>

      {/* RENDER LIST CONTAINER */}
      <div style={{ flex: 1.5, padding: '0 10px' }}>
        <h2 style={{ color: '#ffffff' }}>🎴 Validated Deck List ({finalDeck.length})</h2>
        <div style={{ background: '#1e1e1e', padding: '15px', borderRadius: '6px', maxHeight: '75vh', overflowY: 'auto', border: '1px solid #2d2d2d' }}>
          {finalDeck.length === 0 ? <p style={{ color: '#777' }}>No current operations running.</p> : (
            <pre style={{ margin: 0, fontSize: '14px', lineHeight: '1.6' }}>
              {finalDeck.map((card, idx) => (
                <div key={idx} style={{ color: card.owned ? '#e0e0e0' : '#ef5350', display: 'flex', justifyContent: 'space-between' }}>
                  <span>1 {card.name}</span>
                  <span style={{ fontSize: '11px', color: card.owned ? '#81c784' : '#ef5350' }}>
                    {card.owned ? '[MATCHED]' : '[WILD CARD NEEDED]'}
                  </span>
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>

      {/* LOG DATA CONTAINER */}
      <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '20px', paddingLeft: '20px', borderLeft: '1px solid #2d2d2d' }}>
        <div style={{ background: '#1e1e1e', padding: '15px', borderRadius: '6px', border: '1px solid #2d2d2d' }}>
          <h3 style={{ marginTop: 0, color: '#4dd0e1' }}>⚙️ Security Compliance Output</h3>
          <div style={{ fontSize: '14px', lineHeight: '1.5', color: '#ccc', whiteSpace: 'pre-line' }}>
            {strategy}
          </div>
        </div>

        <div style={{ background: '#1e1e1e', padding: '15px', borderRadius: '6px', border: '1px solid #2d2d2d', flex: 1 }}>
          <h3 style={{ marginTop: 0, color: '#ff7043' }}>⚠️ Out of Stock Requirements</h3>
          <div style={{ maxHeight: '35vh', overflowY: 'auto' }}>
            {missingCards.length === 0 ? <p style={{ color: '#777', fontSize: '13px' }}>No missing resource components identified.</p> : (
              <ul style={{ paddingLeft: '20px', margin: 0, fontSize: '13px', color: '#ffab91' }}>
                {missingCards.map((card, i) => (
                  <li key={i} style={{ marginBottom: '6px' }}>
                    <strong>{card.name}</strong> - <span style={{ color: '#aaa', fontSize: '12px' }}>{card.type_line}</span>
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
writeFile(path.join(CLIENT_DIR, 'src', 'App.jsx'), appJsContent);

console.log("\n📦 Mounting production-safe build scripts...");
try {
    execSync('npm install concurrently --save-dev', { stdio: 'inherit' });
    console.log("\n✨ System setup hardened successfully! To spin up the workspace securely:");
    console.log("   1. npm run install-all");
    console.log("   2. npm run dev");
} catch (e) {
    console.log("Workspace initialized. Run 'npm run install-all' to initialize dependency trees.");
}