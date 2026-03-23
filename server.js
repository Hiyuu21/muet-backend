require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isAudio = file.mimetype.includes('audio') || file.originalname.toLowerCase().endsWith('.mp3');
    return {
      folder: 'muet-hub-resources', 
      resource_type: isAudio ? 'video' : 'raw',
      public_id: Date.now() + '-' + file.originalname 
    };
  },
});

const app = express();
const PORT = 3000;

const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const MONGO_URI = process.env.MONGO_URI;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.use(cors({
    origin: [
        'https://tubular-unicorn-b6a4fe.netlify.app', // Your live Netlify site
        'http://localhost:3000' // Keeps your local testing working
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));app.use(express.json()); 

mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Cloud!'))
    .catch(err => console.error('MongoDB connection error:', err));


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
    fileUrl: String,
    createdAt: { type: Date, default: Date.now }
});
const Resource = mongoose.model('Resource', resourceSchema);

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB Limit
});


app.post('/upload', (req, res) => {
    req.on('aborted', () => {
        console.error('!! The browser closed the connection before upload finished !!');
    });

    upload.single('resourceFile')(req, res, async (err) => {
        if (err) {
            console.error("Multer Error:", err);
            return res.status(500).json({ message: "Upload Error: " + err.message });
        }

        try {
            if (!req.file) return res.status(400).send('No file uploaded.');

            const fileType = req.body.fileType; 
            // req.file.path is now the permanent Cloudinary URL!
            const cloudUrl = req.file.path; 
            
            console.log(`1. Uploaded to Cloudinary! URL: ${cloudUrl}`);

            // SCENARIO A: Audio / General Files
            const isAudio = req.file.mimetype.includes('audio') || req.file.originalname.toLowerCase().endsWith('.mp3');
            
            if (fileType === 'general' || isAudio) {
                const newResource = new Resource({
                    fileName: req.file.filename,
                    originalName: req.file.originalname,
                    fileUrl: cloudUrl // Save the live URL to the database
                });
                
                await newResource.save();
                console.log("Database entry created. Success!");
                return res.status(200).json({ message: 'Upload successful! File saved to library.', resource: newResource });
            }

            // SCENARIO B & C: PDF Processing for Gemini
            console.log("2. Fetching PDF from Cloudinary for Gemini OCR...");
            
            // Because the file is in the cloud, we fetch it via URL to convert to Base64
            const pdfResponse = await fetch(cloudUrl);
            const pdfBuffer = await pdfResponse.arrayBuffer();
            const base64Pdf = Buffer.from(pdfBuffer).toString('base64');
            
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

            console.log(`3. Sending PDF to Gemini...`);
        
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
                        temperature: 0.2
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
            
            if (!data.candidates || !data.candidates[0].content || !data.candidates[0].content.parts) {
                console.error("AI blocked the PDF extraction! Full response:", JSON.stringify(data, null, 2));
                return res.status(500).json({ message: "AI refused to process the PDF. Check the terminal for the exact reason." });
            }

            const generatedJSON = JSON.parse(data.candidates[0].content.parts[0].text);
            
            if (fileType === 'reading') {
                await Quiz.insertMany(generatedJSON);
                console.log("Done update: Reading");
            } else if (fileType === 'writing') {
                await Writing.insertMany(generatedJSON);
                console.log("Done update: Writing");
            }

            res.json({ message: `${fileType.toUpperCase()} processed and saved!`, fileUrl: cloudUrl });

        } catch (error) {
            console.error("Detailed Server Error:", error);
            res.status(500).json({ message: "Server error: " + error.message });
        }
    });
});

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

app.get('/all-resources', async (req, res) => {
    try {
        const resources = await Resource.find().sort({ createdAt: -1 });
        res.json(resources);
    } catch (error) {
        res.status(500).json({ message: "Error fetching resources from database." });
    }
});

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

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://tubular-unicorn-b6a4fe.netlify.app', 
                'X-Title': 'MUET Hub'
            },
            body: JSON.stringify({
                model: "openrouter/free",
                messages: [
                    {
                        role: "system",
                        // NEW: Explicitly defining the MUET scale and rules
                        content: `You are an expert examiner for the Malaysian University English Test (MUET). 
                        You MUST grade the essay strictly using the MUET grading scale, which ranges from Band 1.0 to Band 5.0+ (e.g., 2.5, 3.0, 4.5, 5.0+). 
                        Do NOT use IELTS bands (1-9) or any other scale. 
                        Return ONLY a valid JSON object with the exact keys: band, strengths, improvements, suggestion.`
                    },
                    {
                        role: "user",
                        content: `Grade this MUET ${taskType}. Prompt: ${prompt}. Student Answer: ${answer}.`
                    }
                ],
                response_format: { type: "json_object" } 
            })
        });

        const data = await response.json();

        // --- PREVENT THE CRASH ---
        if (!data.choices || data.choices.length === 0 || data.error) {
            console.log("OpenRouter blocked/failed the request. Full response:", JSON.stringify(data, null, 2));
            return res.status(500).json({ 
                band: "N/A", 
                strengths: "The AI refused or failed to grade this content.", 
                improvements: "Ensure your essay is appropriate or try again later.", 
                suggestion: data.error?.message || "Check your console for the error details." 
            });
        }

        let rawText = data.choices[0].message.content;
        
        // Strip out markdown formatting if the AI includes it
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        res.json(JSON.parse(rawText));

    } catch (error) {
        console.error("Grading Error:", error);
        res.status(500).json({ error: "Server failed to communicate with AI." });
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