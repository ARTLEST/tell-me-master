import * as vscode from 'vscode';
import { GoogleGenAI } from "@google/genai";
import { spawn } from "child_process";
import * as path from "path";
import { TagStore } from './storage/tagStore.mjs';
import { StatsStore } from './storage/statsStore.mjs';

export class DiagnosticsViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'diagnosticsView';

    private _view?: vscode.WebviewView;
    private geminiOutput = "Click 'Compile & Run' to analyze your code";
    private compilationResult = "";
    private isLoading = false;
    private conversationHistory: Array<{role: string, content: string}> = [];
    private lastCallDuration = 0;
    private lastTokenCount = 0;
    private cachedSettings: any = null;
    private settingsDrawerOpen = false;
    private tagStore?: TagStore;
    private statsStore?: StatsStore;
    private sheetsSync?: any;

    constructor(private readonly _context: vscode.ExtensionContext) {
        // Invalidate settings cache when configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('tellMe') || e.affectsConfiguration('geminiApiKey')) {
                this.cachedSettings = null;
            }
        });
    }

    setStores(tagStore: TagStore, statsStore: StatsStore, sheetsSync?: any): void {
        this.tagStore = tagStore;
        this.statsStore = statsStore;
        this.sheetsSync = sheetsSync;
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === "runCompiler") {
                await this.runAnalysis();
            } else if (message.command === "openSettings") {
                // Open VS Code settings filtered to Tell-me extension settings
                await vscode.commands.executeCommand('workbench.action.openSettings', 'tellMe');
            } else if (message.command === "askFollowUp") {
                await this.handleFollowUp(message.question);
            } else if (message.command === "copyCode") {
                vscode.env.clipboard.writeText(message.code);
                vscode.window.showInformationMessage('Code copied to clipboard!');
            } else if (message.command === "clearHistory") {
                this.conversationHistory = [];
                this.geminiOutput = "Conversation history cleared. Click 'Compile & Run' to start a new analysis.";
                this.update();
            } else if (message.command === "toggleDrawer") {
                this.settingsDrawerOpen = !this.settingsDrawerOpen;
                this.update();
            } else if (message.command === "updateSettings") {
                await this.updateSettings(message.settings);
            } else if (message.command === "showTroubleshooting") {
                this.showTroubleshootingGuide();
            } else if (message.command === "showFeaturesGuide") {
                this.showFeaturesGuide();
            } else if (message.command === "resetSettings") {
                await this.resetToDefaults();
            } else if (message.command === "manageTagsCommand") {
                await vscode.commands.executeCommand('tellme.tag.add');
            } else if (message.command === "showStatsCommand") {
                await vscode.commands.executeCommand('tellme.stats.show');
            } else if (message.command === "syncSheetsCommand") {
                // Smart sync: check connection first
                if (!this.sheetsSync) {
                    vscode.window.showWarningMessage('Sync service is still initializing. Please wait a moment.');
                    return;
                }
                if (!this.sheetsSync.isConnected()) {
                    const connect = await vscode.window.showInformationMessage(
                        'Google Sheets is not connected. Would you like to connect now?',
                        'Connect',
                        'Cancel'
                    );
                    if (connect === 'Connect') {
                        await vscode.commands.executeCommand('tellme.sync.connect');
                    }
                } else {
                    await vscode.commands.executeCommand('tellme.sync.pushNow');
                }
            } else if (message.command === "exportDataCommand") {
                await vscode.commands.executeCommand('tellme.data.export');
            } else if (message.command === "clearDataCommand") {
                await vscode.commands.executeCommand('tellme.data.clearAll');
            }
        });

        this.update();
    }

    private getSettings() {
        if (this.cachedSettings) {
            return this.cachedSettings;
        }

        const config = vscode.workspace.getConfiguration();
        const tellMeConfig = vscode.workspace.getConfiguration('tellMe');
        
        this.cachedSettings = {
            apiKey: config.get<string>('geminiApiKey') ?? '',
            model: tellMeConfig.get<string>('model') ?? 'gemini-2.5-flash',
            temperature: tellMeConfig.get<number>('temperature') ?? 0.8,
            maxTokens: tellMeConfig.get<number>('maxTokens') ?? 2048,
            responseDepth: tellMeConfig.get<string>('responseDepth') ?? 'standard',
            responseStyle: tellMeConfig.get<string>('responseStyle') ?? 'balanced',
            tone: tellMeConfig.get<string>('tone') ?? 'friendly',
            responseFormat: tellMeConfig.get<string>('responseFormat') ?? 'markdown',
            includeExamples: tellMeConfig.get<boolean>('includeExamples') ?? true,
            includeBestPractices: tellMeConfig.get<boolean>('includeBestPractices') ?? true,
            showMetrics: tellMeConfig.get<boolean>('showMetrics') ?? true,
            costWarningThreshold: tellMeConfig.get<number>('costWarningThreshold') ?? 4096,
            language: tellMeConfig.get<string>('language') ?? 'en',
            maxHistoryItems: tellMeConfig.get<number>('maxHistoryItems') ?? 20,
            compilationTimeout: tellMeConfig.get<number>('compilationTimeout') ?? 30,
            executionTimeout: tellMeConfig.get<number>('executionTimeout') ?? 10,
            maxOutputSize: tellMeConfig.get<number>('maxOutputSize') ?? 5000
        };

        return this.cachedSettings;
    }

    private async updateSettings(settings: any) {
        const config = vscode.workspace.getConfiguration('tellMe');
        const globalConfig = vscode.workspace.getConfiguration();
        const updates: Thenable<void>[] = [];
        
        if (settings.apiKey !== undefined) {
            updates.push(globalConfig.update('geminiApiKey', settings.apiKey, vscode.ConfigurationTarget.Global));
            vscode.window.showInformationMessage('API Key saved successfully!');
        }
        
        const configMap: Record<string, any> = {
            model: settings.model,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            responseDepth: settings.responseDepth,
            responseStyle: settings.responseStyle,
            tone: settings.tone,
            responseFormat: settings.responseFormat,
            includeExamples: settings.includeExamples,
            includeBestPractices: settings.includeBestPractices,
            showMetrics: settings.showMetrics,
            costWarningThreshold: settings.costWarningThreshold,
            language: settings.language,
            maxHistoryItems: settings.maxHistoryItems,
            compilationTimeout: settings.compilationTimeout,
            executionTimeout: settings.executionTimeout,
            maxOutputSize: settings.maxOutputSize
        };
        
        for (const [key, value] of Object.entries(configMap)) {
            if (value !== undefined) {
                updates.push(config.update(key, value, vscode.ConfigurationTarget.Global));
            }
        }
        
        await Promise.all(updates);
        this.cachedSettings = null;
        this.update();
    }

    private showTroubleshootingGuide() {
        this.geminiOutput = `# 🔧 Common Troubleshooting Steps

## 💾 Before You Start - Save Your File!

**IMPORTANT:** The compiler needs a saved file on disk.

⚠️ If you see "Unsupported file type" or similar errors:
1. Press **Ctrl+S** (or **Cmd+S** on Mac)
2. Save with a **.c** or **.cpp** extension
3. Click **'Compile & Run'** again

---

## ✅ Requirements Checklist

### 1. 🔑 API Key Required
- You need a Google Gemini API key
- Get one free at: [Google AI Studio](https://aistudio.google.com/app/apikey)
- Add it in the Settings button above

### 2. 🛠️ Compiler Installation
- **Windows:** Install MinGW or MSYS2 (includes gcc/g++)
- **Mac:** Install Xcode Command Line Tools: \`xcode-select --install\`
- **Linux:** Install build-essential: \`sudo apt install build-essential\`

### 3. 📂 File Requirements
- File must be **saved** (not "Untitled")
- Must have **.c** or **.cpp** extension
- File should be open in the editor

---

## 🐞 Common Issues & Solutions

### ❌ "Compiler Not Found"
**Solution:**
- Install gcc (for C) or g++ (for C++)
- Make sure compiler is in your system PATH
- Restart VS Code after installation

### ❌ "API Key Not Found"
**Solution:**
1. Click the **Settings** button above
2. Enter your Gemini API key
3. Click **Save API Key**

### ❌ "Unsupported File Type"
**Solution:**
- Save your file first (Ctrl+S)
- Use .c or .cpp file extension
- Example: \`myprogram.cpp\` or \`test.c\`

### ❌ "No File is Currently Open"
**Solution:**
- Open a C/C++ file in the editor
- Make sure it's the active tab
- Click 'Compile & Run' again

### ⏱️ "Compilation/Execution Timed Out"
**Solution:**
- Increase timeout in Settings
- Check for infinite loops in your code
- Simplify complex computations

---

## 🚀 Quick Start Guide

**First Time Setup:**
1. Get API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click Settings button and add your API key
3. Install gcc/g++ compiler if not already installed
4. Create or open a .c or .cpp file
5. Write your code
6. **Save the file** (Ctrl+S)
7. Click 'Compile & Run'

---

## 👤 Still Having Issues?

1. Check the **Output** panel in VS Code for detailed errors
2. Verify your compiler works: Open terminal and type \`gcc --version\`
3. Make sure VS Code has permission to run commands
4. Try restarting VS Code

**Ready to try?** Save your file and click **'Compile & Run'** above!`;
        this.update();
    }

    private showFeaturesGuide() {
        this.geminiOutput = `# 📚 Welcome to Tell-me - Your C/C++ Learning Assistant!

## 🌟 What is Tell-me?

Tell-me is an **AI-powered learning tool** that helps you understand and fix your C/C++ code. Think of it as having a friendly tutor sitting next to you while you code!

---

## 🎯 Main Features (What Can It Do?)

### 1. 🤖 **Smart Code Analysis** 
**What it does:** Automatically finds errors in your code and explains them in simple terms.

**How to use:**
1. Write or open your C/C++ code
2. Save the file (Ctrl+S)
3. Click **"Compile & Run"** button
4. Tell-me will compile your code, run it, and explain any problems

**Example:** If you wrote \`cout << x\` but forgot to declare \`x\`, Tell-me will explain what "undeclared variable" means and show you how to fix it!

---

### 2. 🏷️ **Tag Your Errors** (Track Your Learning)
**What it does:** Let you mark and categorize the types of errors you encounter, so you can see patterns in what you're struggling with.

**How to use:**
- **Quick Way:** Hover over any error in your code → Click the 💡 lightbulb → Select **"Add Tag to this Error"**
- **Manual Way:** Click Menu (☰) → **"Manage Tags"** → Create custom tags like "pointers", "loops", "syntax"

**Why it's useful:** You can track which topics need more practice!

---

### 3. 💬 **Ask Follow-up Questions**
**What it does:** After getting an explanation, you can ask more questions to dig deeper.

**How to use:**
After running analysis, scroll down to see quick question buttons:
- "Explain simpler" - If you didn't understand
- "Show example" - Want to see a working example
- "What's next?" - What should you learn next

Or type your own question in the text box!

**Example:** After Tell-me explains pointers, ask "Can you show me a real-world example of when I'd use pointers?"

---

### 4. 📊 **Track Your Progress**
**What it does:** Keeps statistics on how many programs you've run, your success rate, and improvement over time.

**How to use:**
- Click Menu (☰) → **"Statistics"** to see your learning stats
- See total programs analyzed, average time, and success rate

---

### 5. ☁️ **Sync to Google Sheets** (Optional)
**What it does:** Saves your learning data to Google Sheets so you can visualize your progress over time with charts.

**How to use:**
1. Click Menu (☰) → **"Sync to Sheets"**
2. Follow the steps to connect your Google account
3. Your data gets saved to a spreadsheet automatically
4. Use Looker Studio (free) to create beautiful progress charts!

**Privacy Note:** Your actual code is never uploaded, only statistics like "had an error with loops" or "successfully compiled a program"

---

### 6. ⚙️ **Customize AI Responses**
**What it does:** Control how Tell-me explains things to you.

**How to use:**
1. Click **"Settings"** button (or Menu → Settings)
2. Choose your preferences:
   - **Model:** Flash (faster) vs Pro (more detailed)
   - **Style:** Concise (brief) vs Detailed (thorough)
   - **Examples:** Turn on/off code examples
   - **Best Practices:** Include tips for better coding

---

## 🚀 Complete Step-by-Step Tutorial

### **Your First Analysis (3 Easy Steps)**

**Step 1: Set Up Your API Key** (One-time only)
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Create API Key" (it's FREE!)
3. Copy the key
4. In Tell-me, click **"Settings"** → paste your key → click **"Save API Key"**

**Step 2: Write or Open Code**
1. Create a new file (Ctrl+N)
2. Write some C++ code, like:
\`\`\`cpp
#include <iostream>
int main() {
    std::cout << "Hello World!";
    return 0;
}
\`\`\`
3. **IMPORTANT:** Save the file as \`test.cpp\` (Ctrl+S)

**Step 3: Run Analysis**
1. Click the **"Compile & Run"** button
2. Wait a few seconds
3. Read the AI explanation below!

---

## 💡 Pro Tips for Best Results

### ✅ DO:
- **Always save your file first** (Ctrl+S)
- Start with small programs while learning
- Read the full explanation - Tell-me provides helpful context
- Use tags to organize errors you encounter often
- Ask follow-up questions if confused

### ❌ DON'T:
- Don't try to analyze unsaved files
- Don't ignore the compiler output - Tell-me uses it to help you
- Don't skip the examples - they show working code
- Don't be afraid to ask "silly" questions - Tell-me never judges!

---

## 🎓 Learning Journey Example

**Week 1:** 
- Write simple programs
- Use "Compile & Run" to check them
- Tag errors like "syntax" and "semicolons"

**Week 2:**
- Try more complex programs
- Use follow-up questions to understand concepts
- Check your statistics to see improvement!

**Week 3:**
- Connect Google Sheets sync
- View your progress charts
- Celebrate how much you've learned! 🎉

---

## 🔑 Keyboard Shortcuts

- **Ctrl+S** - Save file (always do this first!)
- **Ctrl+Shift+P** - Open command palette (access all Tell-me commands)
- Type "Tell-me" in command palette to see all available commands

---

## 📱 Where to Get Help

1. **Immediate help:** Click Menu (☰) → **"Help"** for troubleshooting
2. **Settings issues:** Click **"Settings"** button for configuration
3. **Understanding errors:** Use the "Ask follow-up question" feature

---

## 🎯 Quick Action Checklist

Ready to start? Here's your checklist:

- [ ] Install gcc/g++ compiler (if not already installed)
- [ ] Get free API key from Google AI Studio
- [ ] Add API key to Tell-me settings
- [ ] Create a .cpp file with some code
- [ ] Save the file (Ctrl+S)
- [ ] Click "Compile & Run"
- [ ] Read the AI explanation
- [ ] Try asking a follow-up question!

---

**You're all set!** Tell-me is here to help you become a better C/C++ programmer. Start coding and let the AI guide you! 🚀

*Remember: Making errors is part of learning. Tell-me is here to help you understand them, not judge you!*`;
        this.update();
    }

    private async resetToDefaults() {
        const confirmed = await vscode.window.showWarningMessage(
            'Reset all settings to default values?',
            { modal: true },
            'Reset',
            'Cancel'
        );
        
        if (confirmed !== 'Reset') {
            return;
        }

        const config = vscode.workspace.getConfiguration('tellMe');
        
        // Reset all settings to their default values
        const updates: Thenable<void>[] = [];
        
        updates.push(config.update('model', 'gemini-2.5-flash', vscode.ConfigurationTarget.Global));
        updates.push(config.update('temperature', 0.8, vscode.ConfigurationTarget.Global));
        updates.push(config.update('maxTokens', 2048, vscode.ConfigurationTarget.Global));
        updates.push(config.update('responseDepth', 'standard', vscode.ConfigurationTarget.Global));
        updates.push(config.update('responseStyle', 'balanced', vscode.ConfigurationTarget.Global));
        updates.push(config.update('tone', 'friendly', vscode.ConfigurationTarget.Global));
        updates.push(config.update('responseFormat', 'markdown', vscode.ConfigurationTarget.Global));
        updates.push(config.update('includeExamples', true, vscode.ConfigurationTarget.Global));
        updates.push(config.update('includeBestPractices', true, vscode.ConfigurationTarget.Global));
        updates.push(config.update('showMetrics', true, vscode.ConfigurationTarget.Global));
        updates.push(config.update('costWarningThreshold', 4096, vscode.ConfigurationTarget.Global));
        updates.push(config.update('language', 'en', vscode.ConfigurationTarget.Global));
        updates.push(config.update('maxHistoryItems', 20, vscode.ConfigurationTarget.Global));
        updates.push(config.update('compilationTimeout', 30, vscode.ConfigurationTarget.Global));
        updates.push(config.update('executionTimeout', 10, vscode.ConfigurationTarget.Global));
        updates.push(config.update('maxOutputSize', 5000, vscode.ConfigurationTarget.Global));
        
        await Promise.all(updates);
        this.cachedSettings = null;
        
        vscode.window.showInformationMessage('✅ All settings have been reset to default values!');
        this.update();
    }

    private getPromptModifier(): string {
        const settings = this.getSettings();
        
        const styleModifiers: Record<string, string> = {
            'concise': '\nBe brief and direct.',
            'balanced': '',
            'detailed': '\nProvide thorough explanations with examples.'
        };
        
        return styleModifiers[settings.responseStyle] || '';
    }

    private update() {
        if (this._view && this._view.visible) {
            this._view.webview.html = this.getHtml();
        }
    }

    private async handleFollowUp(question: string) {
        if (!question?.trim()) return;
        
        const settings = this.getSettings();
        if (!settings.apiKey?.trim()) {
            this.geminiOutput = "⚠️ API Key not found. Please add your Google Gemini API key in the settings to ask follow-up questions.";
            this.update();
            return;
        }

        this.isLoading = true;
        this.update();

        try {
            const ai = new GoogleGenAI({ apiKey: settings.apiKey });
            
            // Add user question to history
            this.conversationHistory.push({
                role: "user",
                content: question
            });

            const startTime = Date.now();

            const response = await ai.models.generateContent({
                model: settings.model,
                config: {
                    temperature: settings.temperature,
                    maxOutputTokens: settings.maxTokens,
                    topK: 40,
                    topP: 0.95
                },
                contents: [
                    {
                        role: "user",
                        parts: [{ text: `Original compilation result: ${this.compilationResult}` }]
                    },
                    ...this.conversationHistory.map(msg => ({
                        role: msg.role === "user" ? "user" : "model",
                        parts: [{ text: msg.content }]
                    }))
                ]
            });

            this.lastCallDuration = (Date.now() - startTime) / 1000;
            this.lastTokenCount = response.usageMetadata?.totalTokenCount ?? 0;

            const assistantResponse = response.text ?? "No response from Gemini.";
            
            this.conversationHistory.push({
                role: "assistant",
                content: assistantResponse
            });
            
            if (this.conversationHistory.length > settings.maxHistoryItems) {
                this.conversationHistory = this.conversationHistory.slice(-settings.maxHistoryItems);
            }

            this.geminiOutput = this.formatConversation();
        } catch (err: any) {
            this.geminiOutput = `❌ Error: ${err?.message ?? String(err)}`;
        }

        this.isLoading = false;
        this.update();
    }

    private formatConversation(): string {
        const settings = this.getSettings();
        const parts: string[] = [this.conversationHistory[0].content];
        
        for (let i = 1; i < this.conversationHistory.length; i++) {
            const msg = this.conversationHistory[i];
            if (msg.role === "user") {
                parts.push(`\n\n---\n\n**🤔 You asked:** ${msg.content}`);
            } else {
                parts.push(`\n\n**💡 Answer:**\n\n${msg.content}`);
            }
        }
        
        if (settings.showMetrics && this.lastCallDuration > 0) {
            parts.push(`\n\n---\n\n⏱️ ${this.lastCallDuration.toFixed(1)}s · 🔢 ${this.lastTokenCount} tokens`);
        }
        
        return parts.join('');
    }

    private async runAnalysis() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.geminiOutput = "⚠️ No file is currently open. Please open a C or C++ file to analyze.";
            this.update();
            return;
        }

        // Check if file is saved
        if (editor.document.isUntitled || editor.document.uri.scheme === 'untitled') {
            this.geminiOutput = "⚠️ **Please save your file first!**\n\nThe compiler needs a saved file with a .c or .cpp extension.\n\n**Steps:**\n1. Press Ctrl+S (or Cmd+S on Mac)\n2. Save with a .c or .cpp extension\n3. Click 'Compile & Run' again";
            this.update();
            vscode.window.showWarningMessage('Please save your file with a .c or .cpp extension before compiling.');
            return;
        }

        const settings = this.getSettings();
        if (!settings.apiKey?.trim()) {
            this.geminiOutput = "⚠️ API Key not found. Please add your Google Gemini API key in the settings.";
            this.update();
            return;
        }

        const filePath = editor.document.uri.fsPath;
        const fileName = path.basename(filePath);
        const fileContent = editor.document.getText();

        this.isLoading = true;
        this.update();

        const analysisStartTime = Date.now();
        const result = await this.compileAndRun(filePath);
        this.compilationResult = result;
        
        // Get file statistics and add line numbers
        const fileLines = fileContent.split('\n');
        const lines = fileLines.length;
        const chars = fileContent.length;
        
        // Create numbered code for context
        const numberedCode = fileLines.map((line, index) => `${(index + 1).toString().padStart(3, ' ')} | ${line}`).join('\n');
        
        try {
            const ai = new GoogleGenAI({ apiKey: settings.apiKey });
            
            // Build prompt with style modifier
            const basePrompt = `You are an educational programming tutor helping students learn C/C++.

Context: File '${fileName}' (${lines} lines, ${chars} chars)

**IMPORTANT: When explaining errors or issues, ALWAYS reference the specific line number(s) from the code below.**

## Your Code (with line numbers):
\`\`\`
${numberedCode}
\`\`\`

## Compilation/Execution Result:
${result}

---

Now analyze the code and provide:

## 🎯 Quick Summary
[One sentence: success, compile error, runtime error, or logic issue]

## 🔍 What's Happening
[Explain issues with specific line references like "On **line 15**" or "At **lines 20-22**"]

## 💡 Key Concepts
[Bullet points of programming concepts]

## 🛠️ Hints to Fix This
[Give hints with specific line numbers. Example: "Check **line 15** where you declare..." or "Look at **line 8** and consider..."]

## ✅ What You're Doing Right
[At least one positive aspect with line references if applicable]

**Remember: Always mention line numbers when discussing specific code!**`;
            const promptModifier = this.getPromptModifier();
            const fullPrompt = basePrompt + promptModifier;

            const startTime = Date.now();
            
            const response = await ai.models.generateContent({
                model: settings.model,
                config: {
                    temperature: settings.temperature,
                    maxOutputTokens: settings.maxTokens,
                    topK: 40,
                    topP: 0.95
                },
                contents: fullPrompt.trim()
            });

            this.lastCallDuration = (Date.now() - startTime) / 1000;
            this.lastTokenCount = response.usageMetadata?.totalTokenCount ?? 0;

            const analysisResponse = response.text ?? "No response from Gemini.";
            
            // Initialize conversation history with the first analysis
            this.conversationHistory = [
                {
                    role: "assistant",
                    content: analysisResponse
                }
            ];

            this.geminiOutput = this.formatConversation();

            // Record analysis stats (non-blocking)
            if (this.statsStore) {
                const duration = Date.now() - analysisStartTime;
                const hasErrors = result.includes('error:') || result.includes('❌');
                const ext = path.extname(filePath).toLowerCase();
                const language = ext === ".c" ? "c" : "cpp";
                
                this.statsStore.recordAnalysis({
                    filePath,
                    language,
                    diagnosticCount: 1,
                    resultType: hasErrors ? 'error' : 'success',
                    tokenCount: this.lastTokenCount,
                    durationMs: duration,
                    model: settings.model
                }).catch(err => {
                    console.error('Failed to record analysis:', err);
                    vscode.window.showErrorMessage(`Failed to save analysis stats: ${err.message}`, 'Dismiss');
                });
            }
        } catch (err: any) {
            if (err?.message?.includes('API key')) {
                this.geminiOutput = "❌ Invalid API Key. Please check your Google Gemini API key in the settings.";
            } else {
                this.geminiOutput = `❌ Error: ${err?.message ?? String(err)}`;
            }
        }

        this.isLoading = false;
        this.update();
    }

    private compileAndRun(filePath: string): Promise<string> {
        return new Promise((resolve) => {
            const settings = this.getSettings();
            const ext = path.extname(filePath).toLowerCase();
            const compiler = ext === ".c" ? "gcc" : [".cpp", ".cc", ".cxx"].includes(ext) ? "g++" : null;

            if (!compiler) {
                resolve(`⚠️ Unsupported file type '${ext}'. Please use a C (.c) or C++ (.cpp, .cc, .cxx) file.`);
                return;
            }

            const outputBinary = process.platform === "win32" ? "a.exe" : "./a.out";
            const compile = spawn(compiler, [filePath, "-o", outputBinary]);
            const MAX_BUFFER = 10 * 1024 * 1024;
            let compileErrors = "";
            let bufferSize = 0;

            const compileTimeout = setTimeout(() => {
                compile.kill();
                resolve(`Compilation timed out after ${settings.compilationTimeout} seconds.`);
            }, settings.compilationTimeout * 1000);

            compile.stderr.on("data", (d) => {
                const chunk = d.toString();
                bufferSize += chunk.length;
                if (bufferSize < MAX_BUFFER) {
                    compileErrors += chunk;
                }
            });

            compile.on("close", () => {
                clearTimeout(compileTimeout);
                if (compileErrors.trim()) {
                    resolve(`❌ **Compilation Failed**\n\n\`\`\`\n${compileErrors.slice(0, settings.maxOutputSize)}\n\`\`\``);
                    return;
                }

                const run = spawn(outputBinary, [], { shell: true });
                let runtimeOutput = "";
                let runBufferSize = 0;

                const runTimeout = setTimeout(() => {
                    run.kill();
                    resolve(`Execution timed out after ${settings.executionTimeout} seconds.`);
                }, settings.executionTimeout * 1000);

                run.stdout.on("data", (d) => {
                    const chunk = d.toString();
                    runBufferSize += chunk.length;
                    if (runBufferSize < MAX_BUFFER) {
                        runtimeOutput += chunk;
                    }
                });
                
                run.stderr.on("data", (d) => {
                    const chunk = d.toString();
                    runBufferSize += chunk.length;
                    if (runBufferSize < MAX_BUFFER) {
                        runtimeOutput += chunk;
                    }
                });

                run.on("close", (code) => {
                    clearTimeout(runTimeout);
                    if (runtimeOutput.trim()) {
                        resolve(`✅ **Compiled & Executed Successfully**\n\n**Output:**\n\`\`\`\n${runtimeOutput.slice(0, settings.maxOutputSize)}\n\`\`\``);
                    } else {
                        resolve(`✅ **Compiled & Executed Successfully** (exit code: ${code?.toString() ?? '0'})\n\nNo output produced.`);
                    }
                });

                run.on("error", (err) => {
                    clearTimeout(runTimeout);
                    resolve(`❌ **Execution Failed:** ${err.message}`);
                });
            });

            compile.on("error", (err) => {
                clearTimeout(compileTimeout);
                resolve(`❌ **Compiler Not Found:** ${compiler} is not installed or not in PATH.\n\nError: ${err.message}`);
            });
        });
    }

    private getHtml(): string {
        const settings = this.getSettings();
        
        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
:root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --panel: var(--vscode-sideBar-background, #252526);
    --border: var(--vscode-panel-border, #3c3c3c);
    --text: var(--vscode-foreground, #cccccc);
    --text-muted: var(--vscode-descriptionForeground, #999999);
    --accent: var(--vscode-button-background, #0e639c);
    --accent-hover: var(--vscode-button-hoverBackground, #1177bb);
    --success: var(--vscode-testing-iconPassed, #89d185);
    --warning: var(--vscode-editorWarning-foreground, #cca700);
    --error: var(--vscode-errorForeground, #f48771);
    --code-bg: var(--vscode-textCodeBlock-background, #1e1e1e);
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
}

.button-group {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
}

button {
    flex: 1;
    background: var(--accent);
    color: var(--vscode-button-foreground, white);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    padding: 8px 14px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 400;
    transition: background 0.1s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
}

button:hover {
    background: var(--accent-hover);
}

button:active {
    opacity: 0.9;
}

button.secondary {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #cccccc);
    flex: 0 0 auto;
    padding: 8px 14px;
}

button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
}

button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
}

.output-container {
    background: var(--vscode-editor-background, var(--panel));
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    overflow: hidden;
    animation: fadeUp 0.3s ease forwards;
}

.output-header {
    padding: 8px 12px;
    background: var(--vscode-editorWidget-background, rgba(55, 148, 255, 0.1));
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.output-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--accent);
}

.output {
    padding: 16px;
    min-height: 150px;
    max-height: 70vh;
    overflow-y: auto;
    font-size: 14px;
}

.output h2 {
    font-size: 18px;
    margin: 20px 0 12px 0;
    color: var(--text);
    font-weight: 700;
}

.output h2:first-child {
    margin-top: 0;
}

.output h3 {
    font-size: 16px;
    margin: 16px 0 10px 0;
    color: var(--text);
    font-weight: 600;
}

.output p {
    margin: 10px 0;
    color: var(--text);
}

.output ul, .output ol {
    margin: 10px 0;
    padding-left: 24px;
}

.output li {
    margin: 6px 0;
    color: var(--text);
}

.output code {
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 13px;
    color: #10b981;
}

.output pre {
    background: var(--code-bg);
    padding: 14px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 12px 0;
    border: 1px solid var(--border);
    position: relative;
}

.output pre code {
    background: none;
    padding: 0;
    color: var(--text);
}

.output blockquote {
    border-left: 3px solid var(--warning);
    background: rgba(245, 158, 11, 0.1);
    padding: 12px 16px;
    margin: 12px 0;
    border-radius: 6px;
    color: var(--text);
}

.output hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 20px 0;
}

.output strong {
    color: var(--accent);
    font-weight: 600;
}

.output::-webkit-scrollbar {
    width: 8px;
}

.output::-webkit-scrollbar-track {
    background: var(--code-bg);
    border-radius: 4px;
}

.output::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
}

.output::-webkit-scrollbar-thumb:hover {
    background: #3a3f4a;
}

.follow-up-section {
    padding: 16px;
    border-top: 1px solid var(--border);
    background: rgba(55, 148, 255, 0.05);
}

.follow-up-input {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}

.follow-up-input input {
    flex: 1;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
}

.follow-up-input input:focus {
    outline: none;
    border-color: var(--accent);
}

.follow-up-input button {
    flex: 0 0 auto;
    padding: 10px 20px;
}

.quick-questions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
}

.quick-question {
    background: var(--code-bg);
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.quick-question:hover {
    border-color: var(--accent);
    color: var(--accent);
}

.loading {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 3px solid rgba(255,255,255,0.3);
    border-top: 3px solid var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

@keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
}

.empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-muted);
}

.empty-state-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.5;
}

.settings-drawer {
    background: var(--vscode-sideBar-background, var(--panel));
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 16px;
    animation: slideDown 0.2s ease-out;
    max-height: 60vh;
    overflow-y: auto;
}

.settings-drawer::-webkit-scrollbar {
    width: 8px;
}

.settings-drawer::-webkit-scrollbar-track {
    background: var(--code-bg);
    border-radius: 4px;
}

.settings-drawer::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
}

@keyframes slideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}

.settings-section {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
}

.settings-section:last-child {
    border-bottom: none;
    margin-bottom: 0;
}

.settings-section-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
}

.setting-item {
    margin-bottom: 16px;
}

.setting-item:last-child {
    margin-bottom: 0;
}

.setting-item label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 6px;
}

.setting-item small {
    display: block;
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
}

.setting-item select,
.setting-item input[type="range"],
.setting-item input[type="number"],
.setting-item input[type="password"],
.setting-item input[type="text"] {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    padding: 6px 8px;
    font-size: 13px;
}

.setting-item input[type="password"]:focus,
.setting-item input[type="text"]:focus {
    outline: none;
    border-color: var(--accent);
}

.setting-item input[type="range"] {
    padding: 0;
    height: 24px;
}

.preset-buttons {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.preset-btn {
    flex: 1;
    min-width: 70px;
    padding: 6px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
}

.preset-btn:hover {
    background: var(--border);
}

.preset-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
}

.checkbox-item {
    display: flex;
    align-items: center;
    gap: 8px;
}

.checkbox-item input[type="checkbox"] {
    width: 16px;
    height: 16px;
    cursor: pointer;
}

.checkbox-item label {
    margin: 0 !important;
    cursor: pointer;
}

/* Dropdown Menu Styles */
.dropdown {
    position: relative;
    display: inline-block;
}

.dropdown-toggle {
    padding: 8px 16px;
    font-size: 13px;
}

.dropdown-content {
    display: none;
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 4px;
    background: var(--vscode-dropdown-background, var(--panel));
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 200px;
    z-index: 1000;
    overflow: hidden;
}

.dropdown-content.show {
    display: block;
    animation: slideDown 0.15s ease-out;
}

.dropdown-item {
    width: 100%;
    padding: 10px 16px;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
    display: flex;
    align-items: center;
    gap: 10px;
}

.dropdown-item span {
    font-size: 16px;
    width: 20px;
    text-align: center;
}

.dropdown-item:hover {
    background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.1));
}

.dropdown-item:active {
    background: var(--vscode-list-activeSelectionBackground, rgba(255, 255, 255, 0.15));
}

.dropdown-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
}
</style>
</head>

<body>

<div class="button-group">
    <button id="run" ${this.isLoading ? 'disabled' : ''}>
        ${this.isLoading ? '<span class="loading"></span>' : '▶️'} 
        ${this.isLoading ? 'Analyzing...' : 'Compile & Run'}
    </button>
    <div class="dropdown">
        <button class="secondary dropdown-toggle" id="menuButton" title="More Options">
            ☰ Menu
        </button>
        <div class="dropdown-content" id="dropdownMenu">
            <button id="settings" class="dropdown-item">
                <span>⚙️</span> Settings
            </button>
            <button id="featuresGuide" class="dropdown-item">
                <span>📚</span> Features & How to Use
            </button>
            <button id="troubleshooting" class="dropdown-item">
                <span>🔧</span> Help
            </button>
            <div class="dropdown-divider"></div>
            <button id="tagManagement" class="dropdown-item">
                <span>🏷️</span> Manage Tags
            </button>
            <button id="viewStats" class="dropdown-item">
                <span>📊</span> Statistics
            </button>
            <button id="syncNow" class="dropdown-item">
                <span>🔄</span> Sync to Sheets
            </button>
            <div class="dropdown-divider"></div>
            <button id="exportData" class="dropdown-item">
                <span>📤</span> Export Data
            </button>
            <button id="clearData" class="dropdown-item">
                <span>🗑️</span> Clear All Data
            </button>
        </div>
    </div>
</div>

${this.settingsDrawerOpen ? `
<div class="settings-drawer" id="settingsDrawer">
    <div class="settings-section">
        <div class="settings-section-title">🔑 API Configuration</div>
        
        <div class="setting-item">
            <label>Google Gemini API Key</label>
            <input type="password" id="apiKeyInput" placeholder="${settings.apiKey ? '••••••••' : 'Enter your API key'}" value="">
            <small>Get your API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: var(--accent);">Google AI Studio</a></small>
            <button id="saveApiKey" style="margin-top: 8px; width: 100%; background: var(--success);">Save API Key</button>
        </div>
        
        <div class="setting-item" style="text-align: center; padding: 12px; background: var(--code-bg); border-radius: 6px; margin-top: 12px;">
            <button id="openFullSettings" style="width: 100%; background: linear-gradient(135deg, #374151, #1f2937);">
                ⚙️ Open Full VS Code Settings
            </button>
            <small style="margin-top: 6px; display: block; color: var(--text-muted);">Access all extension settings</small>
        </div>
    </div>
    <div class="settings-section">
        <div class="settings-section-title">🚀 Model & Performance</div>
        
        <div class="setting-item">
            <label>Model</label>
            <select id="modelSelect">
                <option value="gemini-2.5-flash" ${settings.model === 'gemini-2.5-flash' ? 'selected' : ''}>Flash (Fast & Efficient)</option>
                <option value="gemini-2.5-pro" ${settings.model === 'gemini-2.5-pro' ? 'selected' : ''}>Pro (Best Quality)</option>
            </select>
            <small>Flash is recommended for quick responses</small>
        </div>
        
        <div class="setting-item">
            <label>Creativity Level <span id="tempValue">${settings.temperature}</span></label>
            <input type="range" id="tempSlider" min="0" max="2" step="0.1" value="${settings.temperature}">
            <small>Low = Precise answers, Medium = Balanced, High = Creative responses</small>
        </div>
        
        <div class="setting-item">
            <label>Response Length</label>
            <select id="lengthSelect">
                <option value="512" ${settings.maxTokens === 512 ? 'selected' : ''}>Brief</option>
                <option value="1024" ${settings.maxTokens === 1024 ? 'selected' : ''}>Short</option>
                <option value="2048" ${settings.maxTokens === 2048 ? 'selected' : ''}>Medium</option>
                <option value="4096" ${settings.maxTokens === 4096 ? 'selected' : ''}>Long</option>
                <option value="8192" ${settings.maxTokens === 8192 ? 'selected' : ''}>Very Detailed</option>
            </select>
        </div>
    </div>
    <div class="settings-section">
        <div class="settings-section-title">📚 Teaching Style</div>
        
        <div class="setting-item">
            <label>Response Depth</label>
            <select id="depthSelect">
                <option value="quick-fix" ${settings.responseDepth === 'quick-fix' ? 'selected' : ''}>Quick Fix Only</option>
                <option value="standard" ${settings.responseDepth === 'standard' ? 'selected' : ''}>Standard (Fix + Explanation)</option>
                <option value="comprehensive" ${settings.responseDepth === 'comprehensive' ? 'selected' : ''}>Comprehensive (With Examples)</option>
                <option value="tutorial" ${settings.responseDepth === 'tutorial' ? 'selected' : ''}>Full Tutorial</option>
            </select>
            <small>How detailed the explanations should be</small>
        </div>
        
        <div class="setting-item">
            <label>Tone</label>
            <select id="toneSelect">
                <option value="professional" ${settings.tone === 'professional' ? 'selected' : ''}>Professional</option>
                <option value="friendly" ${settings.tone === 'friendly' ? 'selected' : ''}>Friendly</option>
                <option value="casual" ${settings.tone === 'casual' ? 'selected' : ''}>Casual</option>
                <option value="academic" ${settings.tone === 'academic' ? 'selected' : ''}>Academic</option>
            </select>
        </div>
        
        <div class="setting-item">
            <label>Response Format</label>
            <select id="formatSelect">
                <option value="markdown" ${settings.responseFormat === 'markdown' ? 'selected' : ''}>Rich Markdown</option>
                <option value="plain-text" ${settings.responseFormat === 'plain-text' ? 'selected' : ''}>Plain Text</option>
                <option value="structured" ${settings.responseFormat === 'structured' ? 'selected' : ''}>Structured Sections</option>
            </select>
        </div>
        
        <div class="setting-item">
            <label>Language</label>
            <select id="languageSelect">
                <option value="en" ${settings.language === 'en' ? 'selected' : ''}>English</option>
                <option value="es" ${settings.language === 'es' ? 'selected' : ''}>Español</option>
                <option value="fr" ${settings.language === 'fr' ? 'selected' : ''}>Français</option>
                <option value="de" ${settings.language === 'de' ? 'selected' : ''}>Deutsch</option>
                <option value="auto" ${settings.language === 'auto' ? 'selected' : ''}>Auto-detect</option>
            </select>
        </div>
    </div>
    <div class="settings-section">
        <div class="settings-section-title">📝 Content Options</div>
        
        <div class="setting-item checkbox-item">
            <input type="checkbox" id="examplesCheckbox" ${settings.includeExamples ? 'checked' : ''}>
            <label for="examplesCheckbox">Include Code Examples</label>
        </div>
        
        <div class="setting-item checkbox-item">
            <input type="checkbox" id="bestPracticesCheckbox" ${settings.includeBestPractices ? 'checked' : ''}>
            <label for="bestPracticesCheckbox">Include Best Practices</label>
        </div>
    </div>
    <div class="settings-section">
        <div class="settings-section-title">💰 Resource Monitoring</div>
        
        <div class="setting-item checkbox-item">
            <input type="checkbox" id="metricsCheckbox" ${settings.showMetrics ? 'checked' : ''}>
            <label for="metricsCheckbox">Show Response Metrics</label>
        </div>
        
        <div class="setting-item">
            <label>Response Length Warning</label>
            <input type="number" id="thresholdInput" min="512" max="8192" step="512" value="${settings.costWarningThreshold}">
            <small>Get notified when responses are too long</small>
        </div>
    </div>
    <div class="settings-section">
        <div class="settings-section-title">⚡ Performance Settings</div>
        
        <div class="setting-item">
            <label>Conversation Memory (messages)</label>
            <input type="number" id="historyInput" min="5" max="100" step="5" value="${settings.maxHistoryItems}">
            <small>Number of conversation messages to remember</small>
        </div>
        
        <div class="setting-item">
            <label>Compilation Timeout (seconds)</label>
            <input type="number" id="compileTimeoutInput" min="10" max="300" step="10" value="${settings.compilationTimeout}">
            <small>Maximum time to wait for compilation</small>
        </div>
        
        <div class="setting-item">
            <label>Execution Timeout (seconds)</label>
            <input type="number" id="execTimeoutInput" min="5" max="120" step="5" value="${settings.executionTimeout}">
            <small>Maximum time to let programs run</small>
        </div>
        
        <div class="setting-item">
            <label>Max Output Display (characters)</label>
            <input type="number" id="outputSizeInput" min="1000" max="50000" step="1000" value="${settings.maxOutputSize}">
            <small>How much output to show from compiler/program</small>
        </div>
    </div>
    <div class="settings-section">
        <div class="settings-section-title">⚡ Quick Presets</div>
        <div class="setting-item">
            <div class="preset-buttons">
                <button class="preset-btn ${settings.responseStyle === 'concise' ? 'active' : ''}" data-style="concise">Concise</button>
                <button class="preset-btn ${settings.responseStyle === 'balanced' ? 'active' : ''}" data-style="balanced">Balanced</button>
                <button class="preset-btn ${settings.responseStyle === 'detailed' ? 'active' : ''}" data-style="detailed">Detailed</button>
            </div>
            <small>Quick style presets that adjust multiple settings</small>
        </div>
    </div>
    
    <div class="settings-section" style="border-bottom: none;">
        <div class="setting-item" style="text-align: center; padding: 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px;">
            <button id="resetSettings" style="width: 100%; background: var(--error); color: white; border: none;">
                🔄 Reset All Settings to Default
            </button>
            <small style="margin-top: 6px; display: block; color: var(--text-muted);">This will restore all settings to their original values</small>
        </div>
    </div>
    
</div>
` : ''}

<div class="output-container">
    <div class="output-header">
        <span class="output-title">Analysis Results</span>
    </div>
    <div class="output" id="output"></div>
    
    ${this.conversationHistory.length > 0 && !this.isLoading ? `
    <div class="follow-up-section">
        <div style="font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">
            💬 Follow-up Questions
        </div>
        <div class="quick-questions">
            <span class="quick-question" data-q="Can you explain this in simpler terms?">Explain simpler</span>
            <span class="quick-question" data-q="What should I learn next?">What's next?</span>
            <span class="quick-question" data-q="Can you give me an example?">Show example</span>
        </div>
        <div class="follow-up-input">
            <input type="text" id="followUpInput" placeholder="Ask a follow-up question..." />
            <button id="askBtn">Ask</button>
        </div>
    </div>
    ` : ''}
</div>

<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

<script>
const vscode = acquireVsCodeApi();
const output = document.getElementById("output");

function renderOutput() {
    const content = ${JSON.stringify(this.geminiOutput)};
    if (typeof marked !== "undefined") {
        marked.setOptions({
            breaks: true,
            gfm: true
        });
        output.innerHTML = marked.parse(content);
    } else {
        output.textContent = content;
    }
}

renderOutput();

document.getElementById("run")?.addEventListener("click", () => {
    vscode.postMessage({ command: "runCompiler" });
});

// Dropdown menu handling
const menuButton = document.getElementById("menuButton");
const dropdownMenu = document.getElementById("dropdownMenu");

menuButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownMenu?.classList.toggle("show");
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
    if (!menuButton?.contains(e.target) && !dropdownMenu?.contains(e.target)) {
        dropdownMenu?.classList.remove("show");
    }
});

// Dropdown menu items
document.getElementById("settings")?.addEventListener("click", () => {
    dropdownMenu?.classList.remove("show");
    vscode.postMessage({ command: "toggleDrawer" });
});

document.getElementById("featuresGuide")?.addEventListener("click", () => {
    dropdownMenu?.classList.remove("show");
    vscode.postMessage({ command: "showFeaturesGuide" });
});

document.getElementById("troubleshooting")?.addEventListener("click", () => {
    dropdownMenu?.classList.remove("show");
    vscode.postMessage({ command: "showTroubleshooting" });
});

document.getElementById("tagManagement")?.addEventListener("click", () => {
    dropdownMenu?.classList.remove("show");
    vscode.postMessage({ command: "manageTagsCommand" });
});

document.getElementById("viewStats")?.addEventListener("click", () => {
    dropdownMenu?.classList.remove("show");
    vscode.postMessage({ command: "showStatsCommand" });
});

document.getElementById("syncNow")?.addEventListener("click", () => {
    dropdownMenu?.classList.remove("show");
    vscode.postMessage({ command: "syncSheetsCommand" });
});

document.getElementById("exportData")?.addEventListener("click", () => {
    dropdownMenu?.classList.remove("show");
    vscode.postMessage({ command: "exportDataCommand" });
});

document.getElementById("clearData")?.addEventListener("click", () => {
    dropdownMenu?.classList.remove("show");
    vscode.postMessage({ command: "clearDataCommand" });
});

document.getElementById("openFullSettings")?.addEventListener("click", () => {
    vscode.postMessage({ command: "openSettings" });
});

document.getElementById("saveApiKey")?.addEventListener("click", () => {
    const input = document.getElementById("apiKeyInput");
    const apiKey = input.value.trim();
    if (apiKey) {
        vscode.postMessage({ 
            command: "updateSettings", 
            settings: { apiKey: apiKey }
        });
        input.value = "";
        input.placeholder = "••••••••";
    }
});

// Settings drawer handlers
document.getElementById("tempSlider")?.addEventListener("input", (e) => {
    document.getElementById("tempValue").textContent = e.target.value;
});

document.getElementById("modelSelect")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { model: e.target.value }
    });
});

document.getElementById("tempSlider")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { temperature: parseFloat(e.target.value) }
    });
});

document.getElementById("lengthSelect")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { maxTokens: parseInt(e.target.value) }
    });
});

document.getElementById("depthSelect")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { responseDepth: e.target.value }
    });
});

document.getElementById("toneSelect")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { tone: e.target.value }
    });
});

document.getElementById("formatSelect")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { responseFormat: e.target.value }
    });
});

document.getElementById("languageSelect")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { language: e.target.value }
    });
});

document.getElementById("examplesCheckbox")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { includeExamples: e.target.checked }
    });
});

document.getElementById("bestPracticesCheckbox")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { includeBestPractices: e.target.checked }
    });
});

document.getElementById("metricsCheckbox")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { showMetrics: e.target.checked }
    });
});

document.getElementById("thresholdInput")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { costWarningThreshold: parseInt(e.target.value) }
    });
});

document.getElementById("historyInput")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { maxHistoryItems: parseInt(e.target.value) }
    });
});

document.getElementById("compileTimeoutInput")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { compilationTimeout: parseInt(e.target.value) }
    });
});

document.getElementById("execTimeoutInput")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { executionTimeout: parseInt(e.target.value) }
    });
});

document.getElementById("outputSizeInput")?.addEventListener("change", (e) => {
    vscode.postMessage({ 
        command: "updateSettings", 
        settings: { maxOutputSize: parseInt(e.target.value) }
    });
});

document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const style = btn.getAttribute("data-style");
        const presets = {
            concise: { temperature: 0.5, maxTokens: 1024, responseStyle: 'concise', responseDepth: 'quick-fix' },
            balanced: { temperature: 0.8, maxTokens: 2048, responseStyle: 'balanced', responseDepth: 'standard' },
            detailed: { temperature: 1.0, maxTokens: 4096, responseStyle: 'detailed', responseDepth: 'comprehensive' }
        };
        vscode.postMessage({ 
            command: "updateSettings", 
            settings: presets[style]
        });
    });
});

document.getElementById("resetSettings")?.addEventListener("click", () => {
    vscode.postMessage({ command: "resetSettings" });
});

document.getElementById("clear")?.addEventListener("click", () => {
    if (confirm("Clear conversation history?")) {
        vscode.postMessage({ command: "clearHistory" });
    }
});

document.getElementById("askBtn")?.addEventListener("click", () => {
    const input = document.getElementById("followUpInput");
    const question = input.value.trim();
    if (question) {
        vscode.postMessage({ command: "askFollowUp", question: question });
        input.value = "";
    }
});

document.getElementById("followUpInput")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        document.getElementById("askBtn").click();
    }
});

document.querySelectorAll(".quick-question").forEach(btn => {
    btn.addEventListener("click", () => {
        const question = btn.getAttribute("data-q");
        vscode.postMessage({ command: "askFollowUp", question: question });
    });
});

// Copy code blocks on click
output.addEventListener("click", (e) => {
    if (e.target.tagName === "CODE" && e.target.parentElement.tagName === "PRE") {
        const code = e.target.textContent;
        vscode.postMessage({ command: "copyCode", code: code });
    }
});
</script>

</body>
</html>
        `;
    }
}