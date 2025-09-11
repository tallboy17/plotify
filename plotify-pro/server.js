// Import necessary packages
require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadEngine } = require("./plantQueryEngine");

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000;
const geminiApiKey = process.env.GEMINI_API_KEY;
const systemPrompt = process.env.SYSTEM_PROMPT;
const geminiModel = process.env.GEMINI_MODEL;

if (!geminiApiKey || !geminiModel) {
  console.error("Error: API keys for GEMINI_API_KEY, and a GEMINI_MODEL must be set in the .env file.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: geminiModel });

// Load the engine once at startup
const engine = loadEngine("./data/plants.json");

// --- Middleware ---
app.use(express.json());
app.use(express.static('public')); // Serve static files from public directory


// --- Project Endpoint ---
app.get('/project', (req, res) => {
  res.sendFile('project.html', { root: 'public' });
});

// --- Search Endpoint ---
app.post('/search', async (req, res) => {
  const { query, context } = req.body;

  if (!query || context === undefined) {
    return res.status(400).json({ error: "Request body must contain 'query' and 'context' fields." });
  }

  console.log(`Received query: "${query}"`);
  console.log(`With context: "${context}"`);

  try {
    // --- Step 1: First LLM call to get plant characteristics and a conversational response ---
    console.log(`Asking Gemini (${geminiModel}) to interpret user intent...`);
    const initialPrompt = `${systemPrompt}\n\nConversation Context: "${context}"\n\nUser's New Query: "${query}"`;
    const initialResult = await model.generateContent(initialPrompt);
    const initialResponseText = initialResult.response.text();
    const cleanedInitialResponse = initialResponseText.replace(/```json|```/g, '').trim();
    const { plantCharacteristics, llmResponse } = JSON.parse(cleanedInitialResponse);

    console.log(`Gemini identified characteristics: "${plantCharacteristics}"`);
    
    // If the LLM doesn't return characteristics, we can still return the conversational response.
    if (!plantCharacteristics) {
        return res.status(200).json({ response: llmResponse, plants: [] });
    }

    // --- Step 2: Use the plantCharacteristics phrase to query the local engine directly ---
    console.log(`Querying local engine with characteristics: "${plantCharacteristics}"`);
    const allPlants = engine.query({
        q: plantCharacteristics,
    });

    console.log(`Successfully fetched details for ${allPlants.length} plants from local engine.`);

    // --- Step 3: Send the final response ---
    const finalResponse = {
      response: llmResponse,
      search_phrase: plantCharacteristics, // Added the search phrase to the response
      plants: allPlants, // Return the raw results from the local search
    };

    res.status(200).json(finalResponse);

  } catch (error) {
    console.error("An error occurred in the process:", error.message);
    if (error.response) {
      console.error('Error details:', error.response.data);
    }
    res.status(500).json({ error: "Failed to process the request." });
  }
});

// New query endpoint
app.get("/q", (req, res) => {
  const { q, plant_id, family, plant_type, scientific_name, limit, offset } = req.query;

  const filters = {};
  if (plant_id) filters["plant_id"] = plant_id;
  if (family) filters["family"] = family;
  if (plant_type) filters["plant_type"] = plant_type;
  if (scientific_name) filters["scientific_name"] = scientific_name;

  const results = engine.query({
    q,
    filters,
    limit: limit ? parseInt(limit) : 20,
    offset: offset ? parseInt(offset) : 0,
  });

  res.json({ count: results.length, results });
});

// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`🌿 Plant search server is running on http://localhost:${PORT}`);
});

