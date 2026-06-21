import { useState, useEffect } from 'react';
import axios from 'axios';

export default function Home() {
  const [commander, setCommander] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [collectionData, setCollectionData] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [finalDeck, setFinalDeck] = useState([]);
  const [strategy, setStrategy] = useState('Submit a commander to generate your gameplan...');
  const [missingCards, setMissingCards] = useState([]);

  useEffect(() => {
    if (commander.length < 3) { setSuggestions([]); return; }
    const delayDebounce = setTimeout(async () => {
      try {
        const res = await axios.get(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(commander)}`);
        setSuggestions(res.data.data || []);
      } catch (err) { console.error(err); }
    }, 200);
    return () => clearTimeout(delayDebounce);
  }, [commander]);

  const handleJsonUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          setCollectionData(JSON.parse(event.target.result));
        } catch (err) { alert("Invalid descriptive collection JSON file format."); }
      };
      reader.readAsText(file);
    }
  };

  const processBrewPipeline = async (selectedCommander) => {
    setLoading(true);
    const targetName = selectedCommander || commander;
    try {
      const res = await axios.post('/api/brew', {
        commanderName: targetName,
        collectionData: collectionData
      });

      setFinalDeck(res.data.processedDecklist);
      setStrategy(res.data.strategy);
      setMissingCards(res.data.processedDecklist.filter(c => !c.owned));
    } catch (err) {
      alert("Error processing deck profile: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '20px', padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#1a1a1a', color: '#fff', minHeight: '100vh' }}>
      
      {/* COLUMN 1: CONTROLS */}
      <div style={{ flex: 1, borderRight: '1px solid #444', paddingRight: '20px' }}>
        <h2>🛠️ Input Controls</h2>
        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Commander Name:</label>
          <input 
            type="text" value={commander} onChange={(e) => setCommander(e.target.value)}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #666', background: '#333', color: '#fff' }}
            placeholder="Type your commander..."
          />
          {suggestions.length > 0 && (
            <ul style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#222', border: '1px solid #444', listStyle: 'none', padding: 0, margin: 0, zIndex: 10 }}>
              {suggestions.map((name, i) => (
                <li key={i} onClick={() => { setCommander(name); setSuggestions([]); processBrewPipeline(name); }} style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid #333' }}>{name}</li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Feed Local Collection (.json):</label>
          <input type="file" accept=".json" onChange={handleJsonUpload} />
          {collectionData && <p style={{ color: '#4caf50', fontSize: '12px' }}>✓ Collection Loaded ({collectionData.length} records)</p>}
        </div>

        <button onClick={() => processBrewPipeline()} disabled={loading} style={{ width: '100%', padding: '12px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
          {loading ? 'Brewing deck structures...' : 'Assemble Historic Brawl Deck'}
        </button>
      </div>

      {/* COLUMN 2: DECKLIST VISUALIZER */}
      <div style={{ flex: 1.5, padding: '0 10px' }}>
        <h2>🎴 Generated Decklist ({finalDeck.length} cards)</h2>
        <div style={{ background: '#111', padding: '15px', borderRadius: '6px', maxHeight: '75vh', overflowY: 'auto', border: '1px solid #333' }}>
          {finalDeck.length === 0 ? <p style={{ color: '#777' }}>Deck list is currently empty.</p> : (
            <pre style={{ margin: 0, fontSize: '14px', lineHeight: '1.6' }}>
              {finalDeck.map((card, idx) => (
                <div key={idx} style={{ color: card.owned ? '#fff' : '#ff4d4d', display: 'flex', justifyContent: 'space-between' }}>
                  <span>1 {card.name}</span>
                  <span style={{ fontSize: '11px', color: card.owned ? '#4caf50' : '#ff4d4d' }}>{card.owned ? '[OWNED]' : '[MISSING]'}</span>
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>

      {/* COLUMN 3: STRATEGY & ALTERNATIVES */}
      <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '20px', paddingLeft: '20px', borderLeft: '1px solid #444' }}>
        <div style={{ flex: 1, background: '#252526', padding: '15px', borderRadius: '6px', border: '1px solid #3c3c3c' }}>
          <h3 style={{ marginTop: 0, color: '#00adb5' }}>🧠 Gameplan & Strategy Insights</h3>
          <div style={{ fontSize: '14px', lineHeight: '1.5', color: '#e0e0e0', whiteSpace: 'pre-line' }}>{strategy}</div>
        </div>

        <div style={{ flex: 1, background: '#252526', padding: '15px', borderRadius: '6px', border: '1px solid #3c3c3c' }}>
          <h3 style={{ marginTop: 0, color: '#ff5722' }}>⚠️ Unmatched/Missing Replacements</h3>
          <div style={{ maxHeight: '25vh', overflowY: 'auto' }}>
            {missingCards.length === 0 ? <p style={{ color: '#777', fontSize: '13px' }}>No severe collection missing discrepancies found.</p> : (
              <ul style={{ paddingLeft: '20px', margin: 0, fontSize: '13px', color: '#ff8a65' }}>
                {missingCards.map((card, i) => (
                  <li key={i} style={{ marginBottom: '6px' }}><strong>{card.name}</strong> - <span style={{ color: '#ccc', fontSize: '12px' }}>{card.type_line}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}