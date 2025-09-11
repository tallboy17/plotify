// plantQueryEngine.js
const fs = require("fs");

function tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1); // remove single-char noise
  }

class PlantQueryEngine {
  constructor(records) {
    this.records = records;
    this.invertedIndex = {};   // token -> Set of indices
    this.fieldIndex = {};      // field -> { value -> Set(indices) }
    this._buildIndexes();
  }

  _addToIndex(map, key, idx) {
    if (!map[key]) map[key] = new Set();
    map[key].add(idx);
  }

  _buildIndexes() {
    this.records.forEach((rec, i) => {
      // --- Full-text index (common_name, scientific_name, family, plant_type) ---
      let tokens = [];
      tokens = tokens.concat(tokenize(rec.common_name));
      tokens = tokens.concat(tokenize(rec.scientific_name));
      tokens = tokens.concat(tokenize(rec.family));
      tokens = tokens.concat(tokenize(rec.plant_type));
      tokens = tokens.concat(tokenize(rec.sun_exposure)); 

      [...new Set(tokens)].forEach((t) => {
        if (!this.invertedIndex[t]) this.invertedIndex[t] = new Set();
        this.invertedIndex[t].add(i);
      });

      // --- Field indexes for direct lookups ---
      ["plant_id", "family", "plant_type", "scientific_name"].forEach((field) => {
        const val = rec[field];
        if (val) {
          const key = typeof val === "string" ? val.toLowerCase() : val;
          if (!this.fieldIndex[field]) this.fieldIndex[field] = {};
          if (!this.fieldIndex[field][key]) this.fieldIndex[field][key] = new Set();
          this.fieldIndex[field][key].add(i);
        }
      });
    });
  }

  query({ q = null, filters = {}, limit = 20, offset = 0 } = {}) {
    let candidateIds = new Set(this.records.map((_, i) => i));

    // --- Full-text search ---
    if (q) {
      const tokens = tokenize(q);
      if (tokens.length > 0) {
        let postings = tokens.map((t) => this.invertedIndex[t] || new Set());
        // Use OR logic instead of AND - find records that contain ANY of the tokens
        let matches = new Set();
        postings.forEach((s) => {
          matches = new Set([...matches, ...s]);
        });
        candidateIds = new Set([...candidateIds].filter((x) => matches.has(x)));
      }
    }

    // --- Field filters ---
    for (let [field, value] of Object.entries(filters)) {
      if (this.fieldIndex[field]) {
        let v = typeof value === "string" ? value.toLowerCase() : value;
        let ids = this.fieldIndex[field][v] || new Set();
        candidateIds = new Set([...candidateIds].filter((x) => ids.has(x)));
      } else {
        candidateIds = new Set(
          [...candidateIds].filter((idx) => this.records[idx][field] === value)
        );
      }
    }

    // --- Slice results ---
    let results = [...candidateIds].map((i) => this.records[i]);
    results = results.slice(offset, offset + limit);

    return results;
  }
}

// Factory to load JSON and return engine
function loadEngine(jsonPath) {
  const raw = fs.readFileSync(jsonPath, "utf-8");
  const data = JSON.parse(raw);
  return new PlantQueryEngine(data);
}

module.exports = { PlantQueryEngine, loadEngine };
