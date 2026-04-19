require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- IN-MEMORY DATABASE (Use MongoDB/Postgres for true production) ---
const users = [];
const chats = [];
let adminConfig = {
    model: 'mistralai/Mistral-7B-Instruct-v0.2',
    isAiEnabled: true,
    maxTokens: 800,
    systemPrompt: "You are Bikash Claude, a smart, powerful, and helpful AI assistant. You speak in a friendly, confident tone. You help with coding, learning, and general questions. Never say you are ChatGPT. Always say you are Bikash Claude."
};

// --- SECURITY: Rate Limiting ---
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: { error: 'Too many requests, please try again later.' }
});

// --- AUTH ENDPOINTS ---
app.post('/api/auth/register', (req, res) => {
    const { email, password } = req.body;
    if (users.find(u => u.email === email)) return res.status(400).json({ error: "User exists" });
    const user = { id: Date.now().toString(), email, password, blocked: false };
    users.push(user);
    res.json({ success: true, user: { id: user.id, email: user.email } });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    if (user.blocked) return res.status(403).json({ error: "Account blocked by admin" });
    res.json({ success: true, user: { id: user.id, email: user.email } });
});

// --- AI CHAT ENDPOINT ---
app.post('/api/chat', apiLimiter, async (req, res) => {
    if (!adminConfig.isAiEnabled) return res.status(503).json({ error: "AI is currently under maintenance." });
    
    const { message, userId, personality, history } = req.body;
    
    // Personality modifier
    let currentSystemPrompt = adminConfig.systemPrompt;
    if (personality === 'hacker') currentSystemPrompt += " You speak like an elite cyberpunk hacker. Use terminal terminology.";
    if (personality === 'teacher') currentSystemPrompt += " You are an extremely patient teacher. Explain things step by step simply.";

    // Format for Mistral-Instruct
    let prompt = `<s>[INST] ${currentSystemPrompt} [/INST] Understood. </s>`;
    
    // Keep last 10 messages for memory
    const recentHistory = history.slice(-10);
    recentHistory.forEach(msg => {
        if (msg.role === 'user') prompt += `[INST] ${msg.content} [/INST]`;
        else prompt += ` ${msg.content} </s>`;
    });
    prompt += `[INST] ${message} [/INST]`;

    try {
        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${adminConfig.model}`,
            {
                inputs: prompt,
                parameters: { max_new_tokens: adminConfig.maxTokens, return_full_text: false, temperature: 0.7 }
            },
            {
                headers: { 
                    'Authorization': `Bearer ${process.env.HF_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        let aiText = response.data[0].generated_text.trim();
        
        // Log chat to DB
        chats.push({ userId, message, response: aiText, timestamp: new Date() });

        res.json({ reply: aiText });
    } catch (error) {
        console.error("AI API Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Bikash Claude is experiencing heavy load. Please try again." });
    }
});

// --- ADMIN ENDPOINTS ---
app.post('/api/admin/login', (req, res) => {
    if (req.body.password === process.env.ADMIN_PASSWORD) res.json({ success: true, token: 'admin_token_xyz' });
    else res.status(401).json({ error: "Invalid admin password" });
});

app.get('/api/admin/stats', (req, res) => {
    res.json({ totalUsers: users.length, totalChats: chats.length, config: adminConfig, users });
});

app.post('/api/admin/config', (req, res) => {
    adminConfig = { ...adminConfig, ...req.body };
    res.json({ success: true, adminConfig });
});

app.post('/api/admin/users/block', (req, res) => {
    const user = users.find(u => u.id === req.body.userId);
    if(user) user.blocked = !user.blocked;
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bikash Claude running on http://localhost:${PORT}`));
