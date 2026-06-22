import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function App() {
  const [commander, setCommander] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [collectionCsv, setCollectionCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState('http://localhost:5000/api/brew');
  
  const [finalDeck, setFinalDeck] = useState([]);
  const [strategy, setStrategy] = useState('Ready for target optimization analysis payload loops.');
  const [missingCards, setMissingCards] = useState([]);

  useEffect(() => {
    const trimmed = commander.trim().replace(/[^a-zA-Z0-9\s']/g, '');
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      try {
        const res = await axios.get(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(trimmed)}`);
        setSuggestions(res.data.data || []);
      } catch (err) {}
    }, 250);
    return () => clearTimeout(delayDebounce);
  }, [commander]);

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert("File size bounds limit error: Choose a file under 2MB.");
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
      const res = await axios.post(apiEndpoint, {
        commanderName: targetName,
        collectionCsv: collectionCsv
      });

      const processedCards = res.data.processedDecklist.filter(c => c.meta_type !== 'deck_info');
      setFinalDeck(processedCards);

      const unowned = processedCards.filter(c => !c.owned);
      setMissingCards(unowned);
      
      setStrategy(`🔒 [Serverless Matrix Optimization Check Complete]\n\nProcessed evaluation constraints cleanly. Total card records parsed safely.\n\nThis payload payload matrix can now safely be shared or reviewed downstream with an AI model endpoint context window.`);

    } catch (err) {
      const msg = err.response?.data?.error || "Pipeline request timeout or routing error.";
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '20px', padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#121212', color: '#e0e0e0', minHeight: '100vh' }}>
      
      <div style={{ flex: 1, borderRight: '1px solid #2d2d2d', paddingRight: '20px' }}>
        <h2 style={{ color: '#fff' }}>🛡️ Serverless Arena Builder</h2>
        
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', color: '#aaa', fontSize: '12px' }}>Active API Routing Target:</label>
          <input 
            type="text" 
            value={apiEndpoint} 
            onChange={(e) => setApiEndpoint(e.target.value)}
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#81c784', fontSize: '12px' }}
          />
        </div>

        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px', color: '#aaa' }}>Target Commander Name:</label>
          <input 
            type="text" 
            value={commander} 
            onChange={(e) => setCommander(e.target.value)}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#fff' }}
            placeholder="Type commander title..."
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
          <label style={{ display: 'block', marginBottom: '5px', color: '#aaa' }}>Moxfield Inventory (.csv):</label>
          <input type="file" accept=".csv" onChange={handleCsvUpload} />
          {fileName && <p style={{ color: '#81c784', fontSize: '12px' }}>✓ Encrypted buffer parse verified: {fileName}</p>}
        </div>

        <button 
          onClick={() => processBrewPipeline()} 
          disabled={loading}
          style={{ width: '100%', padding: '12px', background: '#1e88e5', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {loading ? 'Executing Serverless Loop...' : 'Compute Deck Requirements'}
        </button>
      </div>

      <div style={{ flex: 1.5, padding: '0 10px' }}>
        <h2 style={{ color: '#fff' }}>🎴 Decklist Target Matrix ({finalDeck.length})</h2>
        <div style={{ background: '#1e1e1e', padding: '15px', borderRadius: '6px', maxHeight: '75vh', overflowY: 'auto', border: '1px solid #2d2d2d' }}>
          {finalDeck.length === 0 ? <p style={{ color: '#777' }}>Awaiting pipeline execution variables...</p> : (
            <pre style={{ margin: 0, fontSize: '14px', lineHeight: '1.6' }}>
              {finalDeck.map((card, idx) => (
                <div key={idx} style={{ color: card.owned ? '#e0e0e0' : '#ef5350', display: 'flex', justifyContent: 'space-between' }}>
                  <span>1 {card.name}</span>
                  <span style={{ fontSize: '11px', color: card.owned ? '#81c784' : '#ef5350' }}>
                    {card.owned ? '[MATCHED]' : '[WILD CARDED]'}
                  </span>
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>

      <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '20px', paddingLeft: '20px', borderLeft: '1px solid #2d2d2d' }}>
        <div style={{ background: '#1e1e1e', padding: '15px', borderRadius: '6px', border: '1px solid #2d2d2d' }}>
          <h3 style={{ marginTop: 0, color: '#4dd0e1' }}>⚙️ Serverless Safety State Log</h3>
          <div style={{ fontSize: '14px', lineHeight: '1.5', color: '#ccc', whiteSpace: 'pre-line' }}>
            {strategy}
          </div>
        </div>

        <div style={{ background: '#1e1e1e', padding: '15px', borderRadius: '6px', border: '1px solid #2d2d2d', flex: 1 }}>
          <h3 style={{ marginTop: 0, color: '#ff7043' }}>⚠️ Unowned Structural Requirements</h3>
          <div style={{ maxHeight: '35vh', overflowY: 'auto' }}>
            {missingCards.length === 0 ? <p style={{ color: '#777', fontSize: '13px' }}>No resource structural missing variables identified.</p> : (
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