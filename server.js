require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose'); // NEW: The MongoDB connector

const app = express();
const PORT = 3000;

const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const MONGO_URI = process.env.MONGO_URI;

app.use(cors());
app.use(express.json()); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- NEW: Connect to MongoDB and Define the Schema ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Cloud!'))
    .catch(err => console.error('MongoDB connection error:', err));

// Tell MongoDB what our Quiz data looks like

// --- 1. Define All Three Database Schemas ---
const quizSchema = new mongoose.Schema({
    passage: String,
    questions: Array,
    createdAt: { type: Date, default: Date.now }
});
const Quiz = mongoose.model('Quiz', quizSchema);

const writingSchema = new mongoose.Schema({
    prompt: String,
    createdAt: { type: Date, default: Date.now }
});
const Writing = mongoose.model('Writing', writingSchema);

const resourceSchema = new mongoose.Schema({
    fileName: String,
    originalName: String,
    createdAt: { type: Date, default: Date.now }
});
const Resource = mongoose.model('Resource', resourceSchema);

// --- Multer Storage Setup (You need this back!) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) { 
        cb(null, 'uploads/') 
    },
    filename: function (req, file, cb) { 
        cb(null, Date.now() + '-' + file.originalname) 
    }
});

// Update your upload definition to handle > 100MB
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB Limit
});

// --- FIXED Traffic Controller Endpoint ---
// --- HEAVY DUTY Traffic Controller Endpoint ---
app.post('/upload', (req, res) => {
    // 1. Listen for the browser "giving up"
    req.on('aborted', () => {
        console.error('!! The browser closed the connection before upload finished !!');
    });

    // 2. Manually trigger the upload process
    upload.single('resourceFile')(req, res, async (err) => {
        if (err) {
            console.error("Multer Error:", err);
            return res.status(500).json({ message: "Upload Error: " + err.message });
        }

        try {
            if (!req.file) return res.status(400).send('No file uploaded.');

            const fileType = req.body.fileType; 
            console.log(`1. Received: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB). Type: ${fileType}`);

            // SCENARIO A: Audio / General (The 100MB+ files)
            const isAudio = req.file.mimetype.includes('audio') || req.file.originalname.toLowerCase().endsWith('.mp3');
            
            if (fileType === 'general' || isAudio) {
                const newResource = new Resource({
                    fileName: req.file.filename,
                    originalName: req.file.originalname
                });
                
                await newResource.save();
                console.log("Database entry created. Success!");
                return res.status(200).json({ message: 'Upload successful! File saved to library.' });
            }

            // SCENARIO B & C: PDF Processing (Must be < 20MB for Gemini API)
            const pdfPath = path.join(__dirname, 'uploads', req.file.filename);
            const base64Pdf = fs.readFileSync(pdfPath).toString('base64');
            
            let systemPrompt = "";
            if (fileType === 'reading') {
                systemPrompt = `
                    You are an expert OCR and data extraction tool. Extract the MUET Reading passages and questions from this PDF.
                    
                    CRITICAL INSTRUCTION TO AVOID RECITATION FILTERS: 
                    Do NOT output the passage text as one continuous copied block. You MUST insert a HTML <br> tag after every single sentence in the passage to break up the string matching. 
                    
                    The multiple-choice questions and options MUST be extracted exactly as they appear.
                    
                    Return ONLY a JSON ARRAY containing an object for each passage, in this exact format:
                    [
                    {
                        "passage": "Sentence one from the text.<br>Sentence two from the text.<br>Sentence three from the text.<br>",
                        "questions": [ { "id": "q1", "text": "...", "options": ["A) ...", "B) ...", "C) ..."], "correctAnswer": "A" } ]
                    }
                    ]
                `;
            } else if (fileType === 'writing') {
                systemPrompt = `
                    Act as an OCR tool. Extract BOTH Task 1 and Task 2.
                    Return ONLY a JSON ARRAY in this format:
                    [
                    { "type": "Task 1", "prompt": "..." },
                    { "type": "Task 2", "prompt": "..." }
                    ]
                `;
            }

            console.log(`2. Sending PDF to AI for OCR extraction...`);
        
            // FIX: We are back on the working 2.5-flash model!
            const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ 
                        parts: [
                            { text: systemPrompt }, 
                            { inlineData: { mimeType: "application/pdf", data: base64Pdf } }
                        ] 
                    }],
                    generationConfig: { 
                        responseMimeType: "application/json",
                        temperature: 0.2 // Slightly higher so it feels comfortable adding the <br> tags
                    },
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ]
                })
            });

            const data = await aiResponse.json();
            
            // FIX 2: Check if the AI actually gave us the 'parts' before trying to read them
            if (!data.candidates || !data.candidates[0].content || !data.candidates[0].content.parts) {
                console.error("AI blocked the PDF extraction! Full response:", JSON.stringify(data, null, 2));
                return res.status(500).json({ message: "AI refused to process the PDF. Check the terminal for the exact reason." });
            }

            const generatedJSON = JSON.parse(data.candidates[0].content.parts[0].text);
            
            if (fileType === 'reading') {
                await Quiz.insertMany(generatedJSON);
                console.log("Done update: Reading")
            } else if (fileType === 'writing') {
                await Writing.insertMany(generatedJSON);
                console.log("Done update: Writing")
            }

            res.json({ message: `${fileType.toUpperCase()} processed and saved!`, fileName: req.file.filename });

        } catch (error) {
            console.error("Detailed Server Error:", error);
            res.status(500).json({ message: "Server error: " + error.message });
        }
    });
});

// --- NEW: Endpoint to fetch the latest quiz from the database ---
app.get('/latest-quiz', async (req, res) => {
    try {
        // Find the most recently created quiz in the database
        const latestQuiz = await Quiz.findOne().sort({ createdAt: -1 });
        if (!latestQuiz) return res.status(404).json({ message: "No quizzes found." });
        
        res.json(latestQuiz);
    } catch (error) {
        res.status(500).json({ message: "Error fetching from database." });
    }
});

// --- NEW: Endpoint to fetch ALL quizzes ---
app.get('/all-quizzes', async (req, res) => {
    try {
        // .find() with no filter grabs everything. We sort by newest first.
        const quizzes = await Quiz.find().sort({ createdAt: -1 });
        
        if (!quizzes || quizzes.length === 0) {
            return res.status(404).json({ message: "No quizzes found." });
        }
        
        res.json(quizzes); // Sends the whole array!
    } catch (error) {
        res.status(500).json({ message: "Error fetching from database." });
    }
});

// --- NEW: Endpoint to fetch ALL General Resources from MongoDB ---
app.get('/all-resources', async (req, res) => {
    try {
        const resources = await Resource.find().sort({ createdAt: -1 });
        res.json(resources);
    } catch (error) {
        res.status(500).json({ message: "Error fetching resources from database." });
    }
});

// --- NEW: Endpoint to fetch the latest Writing Prompt ---
app.get('/latest-writing', async (req, res) => {
    try {
        const latestWriting = await Writing.findOne().sort({ createdAt: -1 });
        if (!latestWriting) return res.status(404).json({ message: "No writing prompts found." });
        
        res.json(latestWriting);
    } catch (error) {
        res.status(500).json({ message: "Error fetching writing prompt from database." });
    }
});

app.get('/all-writing', async (req, res) => {
    try {
        const tasks = await Writing.find().sort({ createdAt: -1 });
        res.json(tasks);
    } catch (error) {
        res.status(500).send("Error fetching tasks.");
    }
});

app.post('/grade-writing', async (req, res) => {
    try {
        const { answer, taskType, prompt } = req.body;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ 
                    parts: [{ text: `Grade this MUET ${taskType}. Prompt: ${prompt}. Student Answer: ${answer}. Return JSON with keys: band, strengths, improvements, suggestion.` }] 
                }],
                generationConfig: { responseMimeType: "application/json" },
                // Safety Settings: This prevents the AI from blocking school essays
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });

        const data = await response.json();

        // --- PREVENT THE CRASH ---
        if (!data.candidates || data.candidates.length === 0) {
            console.log("AI blocked the request. Full response:", JSON.stringify(data, null, 2));
            return res.status(500).json({ 
                band: "N/A", 
                strengths: "The AI refused to grade this content.", 
                improvements: "Ensure your essay is appropriate.", 
                suggestion: "Check your console for the Safety Rating." 
            });
        }

        const rawText = data.candidates[0].content.parts[0].text;
        res.json(JSON.parse(rawText));

    } catch (error) {
        console.error("Grading Error:", error);
        res.status(500).json({ error: "Server failed to communicate with AI." });
    }
});

// --- NEW: Sync Folder with Database (Avoids Upload Errors) ---
app.post('/sync-resources', async (req, res) => {
    try {
        const uploadsDir = path.join(__dirname, 'uploads');
        const files = fs.readdirSync(uploadsDir);
        
        let addedCount = 0;
        for (const file of files) {
            // Check if this file is already in our Database
            const exists = await Resource.findOne({ fileName: file });
            
            if (!exists) {
                const newRes = new Resource({
                    fileName: file,
                    originalName: file.split('-').slice(1).join('-') || file // Attempt to recover name
                });
                await newRes.save();
                addedCount++;
            }
        }
        res.json({ message: `Sync complete! Found ${addedCount} new files.` });
    } catch (error) {
        console.error("Sync Error:", error);
        res.status(500).send("Failed to sync folder.");
    }
});

const server = app.listen(PORT, () => console.log(`Admin Server is running on http://localhost:${PORT}`));

// NEW: Force the socket to stay open for massive file chunks
server.on('connection', (socket) => {
    socket.setTimeout(600000); // 10 minutes
    socket.on('timeout', () => {
        console.log('Socket timed out - closing connection');
        socket.destroy();
    });
});

server.timeout = 600000;
server.keepAliveTimeout = 600000;