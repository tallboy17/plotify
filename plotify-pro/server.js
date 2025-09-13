// Import necessary packages
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadEngine } = require("./plantQueryEngine");

// Firebase Admin SDK Configuration
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000;
const geminiApiKey = process.env.GEMINI_API_KEY;
const systemPrompt = process.env.SYSTEM_PROMPT;
const geminiModel = process.env.GEMINI_MODEL;
const jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';

// --- JSONBin Configuration ---
const JSONBIN_CONFIG = {
  BASE_URL: 'https://api.jsonbin.io/v3',
  VERSION: 'v3',
  getUrl: function(endpoint) {
    return `${this.BASE_URL}${endpoint}`;
  }
};

if (!geminiApiKey || !geminiModel) {
  console.error("Error: API keys for GEMINI_API_KEY, and a GEMINI_MODEL must be set in the .env file.");
  process.exit(1);
}

// Check for JSONBin.io API key (optional for projects endpoint)
const jsonbinApiKey = process.env.JSONBIN_API_KEY;
if (!jsonbinApiKey) {
  console.warn("Warning: JSONBIN_API_KEY not set. Projects API will return configuration error.");
}

// Check for USERS_BIN ID
const usersBinId = process.env.USERS_BIN;
if (!usersBinId) {
  console.warn("Warning: USERS_BIN not set. User management will not work properly.");
}
const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: geminiModel });

// Load the engine once at startup
const engine = loadEngine("./data/plants.json");

// --- Middleware ---
app.use(express.json());
app.use(express.static('public')); // Serve static files from public directory




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

// User Management Functions
const getUserData = async (userId) => {
  if (!jsonbinApiKey || !usersBinId) {
    throw new Error('JSONBin configuration missing. USERS_BIN and JSONBIN_API_KEY must be set.');
  }

  try {
    const usersResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${usersBinId}/latest`), {
      method: 'GET',
      headers: {
        'X-Master-Key': jsonbinApiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!usersResponse.ok) {
      throw new Error(`Failed to fetch users data: ${usersResponse.status}`);
    }

    const usersData = await usersResponse.json();
    const users = usersData.record || {};
    
    return users[userId] || null;
  } catch (error) {
    console.error('Error fetching user data:', error);
    throw error;
  }
};

const updateUserData = async (userId, updatedUserData) => {
  if (!jsonbinApiKey || !usersBinId) {
    throw new Error('JSONBin configuration missing. USERS_BIN and JSONBIN_API_KEY must be set.');
  }

  try {
    // First, get all users data
    const usersResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${usersBinId}/latest`), {
      method: 'GET',
      headers: {
        'X-Master-Key': jsonbinApiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!usersResponse.ok) {
      throw new Error(`Failed to fetch users data: ${usersResponse.status}`);
    }

    const usersData = await usersResponse.json();
    const users = usersData.record || {};

    // Update the specific user
    users[userId] = updatedUserData;

    // Save updated users data back to JSONBin
    const updateResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${usersBinId}`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': jsonbinApiKey
      },
      body: JSON.stringify(users)
    });

    if (!updateResponse.ok) {
      throw new Error(`Failed to update user data: ${updateResponse.status}`);
    }

    console.log(`Updated user data for ${userId}`);
    return true;
  } catch (error) {
    console.error('Error updating user data:', error);
    throw error;
  }
};

const verifyAndCreateUser = async (googleUserId, name, email) => {
  if (!jsonbinApiKey || !usersBinId) {
    throw new Error('JSONBin configuration missing. USERS_BIN and JSONBIN_API_KEY must be set.');
  }

  try {
    // Fetch the users JSON from JSONBin
    const usersResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${usersBinId}/latest`), {
      method: 'GET',
      headers: {
        'X-Master-Key': jsonbinApiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!usersResponse.ok) {
      throw new Error(`Failed to fetch users data: ${usersResponse.status}`);
    }

    const usersData = await usersResponse.json();
    const users = usersData.record || {};

    // Check if user already exists
    if (users[googleUserId]) {
      // Update lastLogin timestamp
      users[googleUserId].lastLogin = new Date().toISOString();
      
      // Ensure ownedProjects and sharedProjects arrays exist (migration for existing users)
      if (!users[googleUserId].ownedProjects) {
        users[googleUserId].ownedProjects = [];
      }
      if (!users[googleUserId].sharedProjects) {
        users[googleUserId].sharedProjects = [];
      }
      
      // Save updated users data back to JSONBin
      const updateResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${usersBinId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': jsonbinApiKey
        },
        body: JSON.stringify(users)
      });

      if (!updateResponse.ok) {
        console.warn('Failed to update lastLogin timestamp, but user exists');
      }

      console.log(`User ${googleUserId} already exists, updated lastLogin`);
      return {
        exists: true,
        user: users[googleUserId],
        isNew: false
      };
    }

    // User doesn't exist, create new user
    const internalId = `user_${Date.now()}`;
    const now = new Date().toISOString();
    
    const newUser = {
      internalId: internalId,
      name: name,
      email: email,
      createdAt: now,
      lastLogin: now,
      ownedProjects: [],
      sharedProjects: [],
      subscription: {
        plan: "Basic",
        status: "active",
        startDate: now
      }
    };

    // Add new user to users object
    users[googleUserId] = newUser;

    // Save updated users data back to JSONBin
    const updateResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${usersBinId}`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': jsonbinApiKey
      },
      body: JSON.stringify(users)
    });

    if (!updateResponse.ok) {
      throw new Error(`Failed to create user: ${updateResponse.status}`);
    }

    console.log(`Created new user ${googleUserId} with internal ID ${internalId}`);
    return {
      exists: false,
      user: newUser,
      isNew: true
    };

  } catch (error) {
    console.error('Error in verifyAndCreateUser:', error);
    throw error;
  }
};


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

// --- Google OAuth Endpoint ---
app.post('/api/auth/google', async (req, res) => {
  const { id_token } = req.body;
  
  if (!id_token) {
    return res.status(400).json({ 
      error: 'ID token required',
      message: 'Please provide Google ID token in request body'
    });
  }

  console.log(`Verifying Google ID token: ${id_token}`);
  try {
    // Verify the Google ID token using Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(id_token);
    
    if (!decodedToken) {
      throw new Error('Invalid token payload');
    }

    // Extract user information from Google token
    const googleUserId = decodedToken.uid; // Firebase UID (same as Google's sub)
    const email = decodedToken.email;
    const name = decodedToken.name;

    // Verify and create user using centralized user management
    const userResult = await verifyAndCreateUser(googleUserId, name, email);
    
    if (userResult.isNew) {
      console.log(`New user created via Google OAuth: ${name} (${email})`);
    } else {
      console.log(`Existing user logged in via Google OAuth: ${name} (${email})`);
    }

    // Generate our own JWT token using Google's user ID
    const token = generateToken(googleUserId);
    console.log(`Generated JWT token for Google user: ${googleUserId} (${email})`);
    
    res.json({
      success: true,
      data: {
        jwt: {
          token: token,
          userId: googleUserId,
          username: name,
          email: email,
          expiresIn: jwtExpiresIn
        },
        user: {
          internalId: userResult.user.internalId,
          subscription: userResult.user.subscription,
          createdAt: userResult.user.createdAt,
          lastLogin: userResult.user.lastLogin
        }
      },
      message: userResult.isNew ? 'New user created and authenticated' : 'User authenticated successfully'
    });

  } catch (error) {
    console.error('Google OAuth verification failed:', error);
    
    // Handle specific Firebase Auth errors
    if (error.code === 'auth/id-token-expired') {
      return res.status(400).json({
        error: 'Token expired',
        message: 'Google token has expired. Please sign in again.'
      });
    }
    
    if (error.code === 'auth/invalid-id-token') {
      return res.status(400).json({
        error: 'Invalid token',
        message: 'Google token is invalid. Please sign in again.'
      });
    }

    if (error.code === 'auth/id-token-revoked') {
      return res.status(400).json({
        error: 'Token revoked',
        message: 'Google token has been revoked. Please sign in again.'
      });
    }

    res.status(401).json({
      error: 'Google authentication failed',
      message: 'Invalid or expired Google token. Please sign in again.'
    });
  }
});

// --- User Creation Endpoint ---
app.post('/api/users', async (req, res) => {
  const { name, email, password } = req.body;
  
  if (!name || !email) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      message: 'Please provide name and email'
    });
  }

  if (!jsonbinApiKey) {
    return res.status(500).json({
      error: 'JSONBin not configured',
      message: 'JSONBIN_API_KEY not set in server configuration'
    });
  }

  try {
    // Create user in Firebase Auth
    let firebaseUser;
    if (password) {
      // Create user with email/password
      firebaseUser = await admin.auth().createUser({
        email: email,
        password: password,
        displayName: name
      });
    } else {
      // Create user without password (for OAuth users)
      firebaseUser = await admin.auth().createUser({
        email: email,
        displayName: name
      });
    }

    const userId = firebaseUser.uid;
    const createdAt = new Date().toISOString();

    // Create user data object
    const userData = {
      userId: userId,
      username: name,
      email: email,
      createdAt: createdAt,
      ownedProjects: [],
      sharedProjects: []
    };

    // Create new bin in JSONBin.io using userId as bin ID
    const createBinResponse = await fetch(JSONBIN_CONFIG.getUrl('/b'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': jsonbinApiKey,
        'X-Bin-Name': `user-${name}-${userId.substring(0, 8)}`,
        'X-Bin-Id': userId // Use Firebase UID as bin ID
      },
      body: JSON.stringify(userData)
    });

    if (!createBinResponse.ok) {
      // If bin creation fails, clean up Firebase user
      await admin.auth().deleteUser(userId);
      throw new Error(`Failed to create user data bin: ${createBinResponse.status}`);
    }

    const binData = await createBinResponse.json();
    console.log(`Created user: ${name} (${email}) with Firebase UID: ${userId}`);
    console.log(`Created JSONBin: ${binData.metadata.id}`);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        userId: userId,
        username: name,
        email: email,
        createdAt: createdAt,
        binId: binData.metadata.id
      }
    });

  } catch (error) {
    console.error('Error creating user:', error);
    
    // Handle Firebase Auth errors
    if (error.code === 'auth/email-already-exists') {
      return res.status(409).json({
        error: 'Email already exists',
        message: 'A user with this email already exists'
      });
    }
    
    if (error.code === 'auth/invalid-email') {
      return res.status(400).json({
        error: 'Invalid email',
        message: 'Please provide a valid email address'
      });
    }

    if (error.code === 'auth/weak-password') {
      return res.status(400).json({
        error: 'Weak password',
        message: 'Password should be at least 6 characters'
      });
    }

    res.status(500).json({
      error: 'User creation failed',
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
      const jsonbinResponse = await fetch(JSONBIN_CONFIG.getUrl('/b'), {
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
      const updateResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${projectId}`), {
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
        const userData = await getUserData(userId);
        if (userData) {
          const ownedProjects = userData.ownedProjects || [];
          
          // Add new project ID to the list
          ownedProjects.push(projectId);
          
          // Update user's owned projects list
          const updatedUserData = {
            ...userData,
            ownedProjects: ownedProjects
          };
          
          await updateUserData(userId, updatedUserData);
          console.log(`Added project ${projectId} to user ${userId}'s owned projects`);
        } else {
          console.warn(`User ${userId} not found in centralized users bin`);
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
      const deleteResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${projectId}`), {
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
      try {
        const userData = await getUserData(userId);
        if (userData) {
          const ownedProjects = userData.ownedProjects || [];
          const updatedOwnedProjects = ownedProjects.filter(id => id !== projectId);

          // Update user's owned projects list
          const updatedUserData = {
            ...userData,
            ownedProjects: updatedOwnedProjects
          };
          
          await updateUserData(userId, updatedUserData);
          console.log(`Removed project ${projectId} from user ${userId}'s owned projects`);
        } else {
          console.warn(`User ${userId} not found in centralized users bin`);
        }
      } catch (userUpdateError) {
        console.error('Failed to update user project list:', userUpdateError);
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
      const jsonbinResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${projectId}`), {
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

// --- Single Project API Endpoint ---
app.get('/api/users/projects/:id', async (req, res) => {
  const projectId = req.params.id;
  
  console.log(`Fetching project data for ID: ${projectId}`);
  
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
    
    console.log(`Authenticated user: ${userId} fetching project: ${projectId}`);
    
    try {
      // Fetch project data from JSONBin using project_id as bin ID
      const projectResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${projectId}/latest`), {
        method: 'GET',
        headers: {
          'X-Master-Key': process.env.JSONBIN_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      if (!projectResponse.ok) {
        const errorData = await projectResponse.json();
        console.error('JSONBin fetch failed:', errorData);
        return res.status(404).json({ 
          success: false, 
          error: 'Project not found',
          details: errorData
        });
      }

      const projectData = await projectResponse.json();
      console.log(`Successfully fetched project: ${projectId}`);
      
      res.json(projectData.record);

    } catch (error) {
      console.error('Error fetching project:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error while fetching project',
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
    
    // Use centralized USERS_BIN to get user data
    const usersBinUrl = JSONBIN_CONFIG.getUrl(`/b/${usersBinId}/latest`);
    
    console.log(`Fetching user data from centralized USERS_BIN: ${usersBinUrl}`);
    
    const response = await fetch(usersBinUrl, {
      method: 'GET',
      headers: {
        'X-Master-Key': jsonbinApiKey,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`JSONBin.io API error: ${response.status} ${response.statusText}`);
    }
    
    const usersData = await response.json();
    console.log('Centralized users data received');
    
    // Extract specific user data by userId key
    const userData = usersData.record[userId];
    if (!userData) {
      console.log(`User ${userId} not found in centralized users bin`);
      return []; // Return empty array if user not found
    }
    
    // Get the array of project IDs from the user data
    const ownedProjects = userData.ownedProjects || [];
    console.log(`Found ${ownedProjects.length} project IDs to fetch`);
    
    // Fetch details for each project
    const projects = [];
    for (const projectId of ownedProjects) {
      try {
        console.log(`Fetching project details for ID: ${projectId}`);
        
        const projectResponse = await fetch(JSONBIN_CONFIG.getUrl(`/b/${projectId}/latest`), {
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

