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
            
        match = re.match(r"^['\"]?(\d+)\s+(.+?)(?:\s+\([^)]+\)(?:\s+\d+)?)?['\"]?$", line)
        
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