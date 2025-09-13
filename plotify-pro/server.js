// Import necessary packages
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadEngine } = require("./plantQueryEngine");

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000;
const geminiApiKey = process.env.GEMINI_API_KEY;
const systemPrompt = process.env.SYSTEM_PROMPT;
const geminiModel = process.env.GEMINI_MODEL;
const jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';

if (!geminiApiKey || !geminiModel) {
  console.error("Error: API keys for GEMINI_API_KEY, and a GEMINI_MODEL must be set in the .env file.");
  process.exit(1);
}

// Check for JSONBin.io API key (optional for projects endpoint)
const jsonbinApiKey = process.env.JSONBIN_API_KEY;
if (!jsonbinApiKey) {
  console.warn("Warning: JSONBIN_API_KEY not set. Projects API will return configuration error.");
}

// JWT Helper Functions
const generateToken = (userId) => {
  return jwt.sign({ userId }, jwtSecret, { expiresIn: jwtExpiresIn });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, jwtSecret);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: geminiModel });

// Load the engine once at startup
const engine = loadEngine("./data/plants.json");

// --- Middleware ---
app.use(express.json());
app.use(express.static('public')); // Serve static files from public directory


// --- Login Endpoint ---
app.post('/api/auth/login', (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ 
      error: 'User ID required',
      message: 'Please provide userId in request body'
    });
  }
  
  try {
    const token = generateToken(userId);
    console.log(`Generated JWT token for user: ${userId}`);
    
    res.json({
      success: true,
      token,
      userId,
      expiresIn: jwtExpiresIn
    });
  } catch (error) {
    console.error('Error generating token:', error);
    res.status(500).json({
      error: 'Token generation failed',
      message: error.message
    });
  }
});

// --- Project Endpoint (RESTful nested resource) ---
app.get('/users/projects/:id', (req, res) => {
  const projectId = req.params.id;
  console.log(`Serving project page for project ID: ${projectId}`);
  res.sendFile('project.html', { root: 'public' });
});

// --- Create Project Endpoint ---
app.post('/users/projects', async (req, res) => {
  const newProject = req.body;
  
  console.log('Creating new project:', newProject);
  
  // Extract and verify JWT token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'No token provided',
      message: 'Please provide Authorization: Bearer token'
    });
  }
  
  const token = authHeader.substring(7);
  try {
    const decoded = verifyToken(token);
    const userId = decoded.userId;
    
    console.log(`Authenticated user: ${userId} creating new project`);
    
    try {
      // Add user_id and project_id to the project data
      const projectDataWithIds = {
        ...newProject,
        user_id: userId,
        project_id: null // Will be set after JSONBin creation
      };
      
      // Create new project in JSONBin
      const jsonbinResponse = await fetch('https://api.jsonbin.io/v3/b', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': process.env.JSONBIN_API_KEY,
          'X-Bin-Name': newProject.project_name || 'New Project'
        },
        body: JSON.stringify(projectDataWithIds)
      });

      if (!jsonbinResponse.ok) {
        const errorText = await jsonbinResponse.text();
        console.error('JSONBin creation failed:', errorText);
        return res.status(500).json({
          error: 'Failed to create project',
          message: 'Could not save project data to storage',
          details: errorText
        });
      }

      const jsonbinData = await jsonbinResponse.json();
      const projectId = jsonbinData.metadata.id;
      
      // Update the project data with the actual project_id
      const finalProjectData = {
        ...projectDataWithIds,
        project_id: projectId
      };
      
      // Update the JSONBin with the complete project data including project_id
      const updateResponse = await fetch(`https://api.jsonbin.io/v3/b/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': process.env.JSONBIN_API_KEY
        },
        body: JSON.stringify(finalProjectData)
      });

      if (!updateResponse.ok) {
        console.warn('Failed to update project with project_id, but project was created');
      }
      
      console.log('Project created successfully in JSONBin:', projectId);
      
      // Add project ID to user's owned projects list
      try {
        const userBinResponse = await fetch(`https://api.jsonbin.io/v3/b/${userId}`, {
          method: 'GET',
          headers: {
            'X-Master-Key': process.env.JSONBIN_API_KEY
          }
        });

        if (userBinResponse.ok) {
          const userData = await userBinResponse.json();
          const ownedProjects = userData.record.ownedProjects || [];
          
          // Add new project ID to the list
          ownedProjects.push(projectId);
          
          // Update user's owned projects list
          const updateUserResponse = await fetch(`https://api.jsonbin.io/v3/b/${userId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Master-Key': process.env.JSONBIN_API_KEY
            },
            body: JSON.stringify({
              ...userData.record,
              ownedProjects: ownedProjects
            })
          });

          if (!updateUserResponse.ok) {
            console.warn('Failed to update user\'s owned projects list, but project was created');
          }
        }
      } catch (userUpdateError) {
        console.warn('Failed to update user\'s owned projects list:', userUpdateError);
        // Don't fail the entire request if user update fails
      }
      
      res.status(201).json({ 
        success: true, 
        message: 'Project created successfully',
        projectId: projectId,
        userId: userId,
        project: finalProjectData,
        jsonbinVersion: jsonbinData.version
      });
      
    } catch (jsonbinError) {
      console.error('JSONBin API error:', jsonbinError);
      res.status(500).json({
        error: 'Storage creation failed',
        message: 'Could not connect to storage service',
        details: jsonbinError.message
      });
    }
    
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({ 
      error: 'Invalid token',
      message: 'Please login again'
    });
  }
});

// --- Delete Project Endpoint ---
app.delete('/users/projects/:id', async (req, res) => {
  const projectId = req.params.id;
  
  console.log(`Deleting project ID: ${projectId}`);
  
  // Extract and verify JWT token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'No token provided',
      message: 'Please provide Authorization: Bearer token'
    });
  }
  
  const token = authHeader.substring(7);
  try {
    const decoded = verifyToken(token);
    const userId = decoded.userId;
    
    console.log(`Authenticated user: ${userId} deleting project: ${projectId}`);
    
    try {
      // Delete the project from JSONBin
      const deleteResponse = await fetch(`https://api.jsonbin.io/v3/b/${projectId}`, {
        method: 'DELETE',
        headers: {
          'X-Master-Key': process.env.JSONBIN_API_KEY
        }
      });

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json();
        console.error('JSONBin delete failed:', errorData);
        return res.status(400).json({ 
          success: false, 
          error: 'Failed to delete project from storage',
          details: errorData
        });
      }

      // Remove project from user's owned projects list
      const userResponse = await fetch(`https://api.jsonbin.io/v3/b/${userId}`, {
        method: 'GET',
        headers: {
          'X-Master-Key': process.env.JSONBIN_API_KEY
        }
      });

      if (!userResponse.ok) {
        console.error('Failed to fetch user data for project removal');
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to update user project list'
        });
      }

      const userData = await userResponse.json();
      const ownedProjects = userData.record.ownedProjects || [];
      const updatedOwnedProjects = ownedProjects.filter(id => id !== projectId);

      // Update user's owned projects list
      const updateUserResponse = await fetch(`https://api.jsonbin.io/v3/b/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': process.env.JSONBIN_API_KEY
        },
        body: JSON.stringify({
          ...userData.record,
          ownedProjects: updatedOwnedProjects
        })
      });

      if (!updateUserResponse.ok) {
        console.error('Failed to update user project list');
        return res.status(500).json({ 
          success: false, 
          error: 'Project deleted but failed to update user project list'
        });
      }

      console.log('Project deleted successfully from JSONBin and user project list');
      
      res.json({ 
        success: true, 
        message: 'Project deleted successfully',
        projectId: projectId,
        userId: userId
      });

    } catch (error) {
      console.error('Error deleting project:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error while deleting project',
        details: error.message
      });
    }

  } catch (error) {
    console.error('JWT verification failed:', error);
    res.status(401).json({ 
      success: false,
      error: 'Invalid token',
      message: 'Please provide a valid JWT token'
    });
  }
});

// --- Update Project Endpoint ---
app.put('/users/projects/:id', async (req, res) => {
  const projectId = req.params.id;
  const updatedProject = req.body;
  
  console.log(`Updating project ID: ${projectId}`);
  console.log('Updated project data:', updatedProject);
  
  // Extract and verify JWT token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'No token provided',
      message: 'Please provide Authorization: Bearer token'
    });
  }
  
  const token = authHeader.substring(7);
  try {
    const decoded = verifyToken(token);
    const userId = decoded.userId;
    
    console.log(`Authenticated user: ${userId} updating project: ${projectId}`);
    
    // Update project in JSONBin using project_id as bin ID
    try {
      const jsonbinResponse = await fetch(`https://api.jsonbin.io/v3/b/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': process.env.JSONBIN_API_KEY
        },
        body: JSON.stringify(updatedProject)
      });

      if (!jsonbinResponse.ok) {
        const errorText = await jsonbinResponse.text();
        console.error('JSONBin update failed:', errorText);
        return res.status(500).json({
          error: 'Failed to update project',
          message: 'Could not save project data to storage',
          details: errorText
        });
      }

      const jsonbinData = await jsonbinResponse.json();
      console.log('Project updated successfully in JSONBin:', jsonbinData);
      
      res.json({ 
        success: true, 
        message: 'Project updated successfully',
        projectId: projectId,
        userId: userId,
        updatedProject: updatedProject,
        jsonbinVersion: jsonbinData.version
      });
      
    } catch (jsonbinError) {
      console.error('JSONBin API error:', jsonbinError);
      res.status(500).json({
        error: 'Storage update failed',
        message: 'Could not connect to storage service',
        details: jsonbinError.message
      });
    }
    
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({ 
      error: 'Invalid token',
      message: 'Please login again'
    });
  }
});

// --- Dashboard Endpoint (HTML) ---
app.get('/users/projects', (req, res) => {
  // Extract user ID from Authorization header or query parameter
  const authHeader = req.headers.authorization;
  let userId = null;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Extract and verify JWT token
    const token = authHeader.substring(7);
    try {
      const decoded = verifyToken(token);
      userId = decoded.userId;
      console.log(`JWT verified for user: ${userId}`);
    } catch (error) {
      console.error('JWT verification failed:', error.message);
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Please login again'
      });
    }
  }
  
  // Fallback to query parameter for testing
  if (!userId) {
    userId = req.query.userId || '68c492f0d0ea881f407bf5dc';
  }
  
  console.log(`Serving dashboard for user: ${userId}`);
  
  // Set user ID in response header for frontend use
  res.set('X-User-ID', userId);
  res.sendFile('project-dashboard.html', { root: 'public' });
});

// --- Projects Data API Endpoint ---
app.get('/api/users/projects', async (req, res) => {
  try {
    // Extract user ID from Authorization header
    const authHeader = req.headers.authorization;
    let userId = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // Extract and verify JWT token
      const token = authHeader.substring(7);
      try {
        const decoded = verifyToken(token);
        userId = decoded.userId;
        console.log(`JWT verified for user: ${userId}`);
      } catch (error) {
        console.error('JWT verification failed:', error.message);
        return res.status(401).json({
          error: 'Invalid token',
          message: 'Please login again'
        });
      }
    }
    
    // Fallback to query parameter for testing
    if (!userId) {
      userId = req.query.userId;
    }
    
    if (!userId) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please provide Authorization header with Bearer token or userId query parameter'
      });
    }
    
    // Get JSONBin.io API key from environment
    const jsonbinApiKey = process.env.JSONBIN_API_KEY;
    if (!jsonbinApiKey) {
      return res.status(500).json({ 
        error: 'Configuration error',
        message: 'JSONBIN_API_KEY not configured in environment variables'
      });
    }
    
    // Use user ID as bin ID
    const binId = userId;
    const jsonbinUrl = `https://api.jsonbin.io/v3/b/${binId}/latest`;
    
    console.log(`Fetching data from JSONBin.io: ${jsonbinUrl}`);
    
    const response = await fetch(jsonbinUrl, {
      method: 'GET',
      headers: {
        'X-Master-Key': jsonbinApiKey,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`JSONBin.io API error: ${response.status} ${response.statusText}`);
    }
    
    const binData = await response.json();
    console.log('JSONBin.io response received');
    
    // Get the array of project IDs
    const ownedProjects = binData.record.ownedProjects || [];
    console.log(`Found ${ownedProjects.length} project IDs to fetch`);
    
    // Fetch details for each project
    const projects = [];
    for (const projectId of ownedProjects) {
      try {
        console.log(`Fetching project details for ID: ${projectId}`);
        
        const projectResponse = await fetch(`https://api.jsonbin.io/v3/b/${projectId}/latest`, {
          method: 'GET',
          headers: {
            'X-Master-Key': jsonbinApiKey,
            'Content-Type': 'application/json'
          }
        });
        
        if (projectResponse.ok) {
          const projectData = await projectResponse.json();
          projects.push(projectData.record || projectData);
          console.log(`Successfully fetched project: ${projectId}`);
        } else {
          console.error(`Failed to fetch project ${projectId}: ${projectResponse.status}`);
        }
      } catch (projectError) {
        console.error(`Error fetching project ${projectId}:`, projectError.message);
      }
    }
    
    console.log(`Successfully fetched ${projects.length} project details`);
    res.json(projects);
    
  } catch (error) {
    console.error('Error fetching projects from JSONBin.io:', error);
    res.status(500).json({
      error: 'Failed to fetch projects',
      message: error.message
    });
  }
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

