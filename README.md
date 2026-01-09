# Tell-me - AI-Powered C/C++ Learning Assistant 🚀

An educational VS Code extension that uses Google Gemini AI to help you understand compiler errors and improve your C/C++ programming skills.


## ✨ Features

- 🔍 **Compile & Analyze**: Instantly compile C/C++ code and get AI-powered explanations
- 🤖 **Educational AI**: Get hints and guidance without spoiling the solution
- 💬 **Interactive Q&A**: Ask follow-up questions to deepen your understanding
- 📝 **Beautiful Interface**: Easy-to-read markdown formatting with syntax highlighting
- 📋 **Quick Copy**: Click any code block to copy to clipboard
- 🎯 **Context-Aware**: AI considers your file size, language, and error patterns


## 📦 Installation

1. Install from the VS Code Marketplace
2. Get a free Google Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
3. Open VS Code Settings (Ctrl+, or Cmd+,)
4. Search for "gemini"
5. Enter your API key
6. Or open extension and add it from there

## 🚀 Usage

1. Open any `.c` or `.cpp` file
2. Click the Tell-me icon in the sidebar (📝)
3. Click "Compile & Run"
4. Read the AI analysis and ask follow-up questions!

## ⚙️ Requirements

- **GCC** or **G++** compiler installed on your system
- **Google Gemini API key** (free at [Google AI Studio](https://aistudio.google.com/app/apikey))
- **VS Code 1.107.0+** for full feature support
- **Internet** (optional - only for Google Sheets sync and AI features)

### Installing GCC/G++ (Multi-Platform)

**Windows:**
```bash
# Option 1: MinGW (Recommended)
# Download from: https://sourceforge.net/projects/mingw-w64/
# Add to PATH

# Option 2: WSL (Windows Subsystem for Linux)
wsl --install
wsl
sudo apt-get update && sudo apt-get install g++
```

**macOS:**
```bash
# Option 1: Command Line Tools
xcode-select --install

# Option 2: Via Homebrew
brew install gcc
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install g++

# Fedora/RHEL
sudo dnf install gcc-c++

# Arch
sudo pacman -S gcc
```

### Compiler Verification

After installation, verify the compiler is in your PATH:
```bash
g++ --version    # or clang++ --version
```

---

## 🌍 Cross-Environment Support

Tell-me is designed to work seamlessly across **Windows, macOS, and Linux**. All features work on any platform:

✅ **Tested & Working On:**
- Windows 10/11 with MinGW
- macOS 12+ (Intel & Apple Silicon)
- Linux (Ubuntu 20.04+, Fedora, Arch, etc.)

📊 See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for:
- Multi-computer setup instructions
- Platform-specific configurations
- Troubleshooting guide
- Performance benchmarks

---

## 🔧 Setup & Configuration

### Quick Start
```bash
# Clone the repository
git clone <repository-url>
cd tell-me-master

# Install dependencies
npm install

# Compile TypeScript to JavaScript
npm run compile

# Verify setup (optional)
bash verify-setup.sh
```

### VS Code Setup
1. Press `F5` to open extension in debug mode
2. Or package for deployment: `vsce package`
3. Or install directly: Extensions → Install from VSIX
sudo apt install gcc g++  # Ubuntu/Debian
sudo dnf install gcc g++  # Fedora
```

## 📖 How It Works

Tell-me analyzes your code in a educational way:

1. **🎯 Quick Summary** - What happened in one sentence
2. **🔍 What's Happening** - Plain English explanation
3. **💡 Key Concepts** - Programming concepts involved
4. **🛠️ Hints to Fix** - Actionable guidance without solutions
5. **✅ What You're Doing Right** - Positive reinforcement

## 🎓 Perfect For

- Students learning C/C++ programming
- Self-taught programmers
- Anyone who wants to understand their errors better
- Teachers looking for automated feedback tools

## ⚙️ Extension Settings

This extension contributes the following settings:

* `geminiApiKey`: Your Google Gemini API key for AI-powered diagnostics


## 📝 Release Notes

### 1.0.0 (Initial Release)

- ✅ Compile and run C/C++ files
- ✅ AI-powered error analysis with Google Gemini
- ✅ Interactive follow-up questions
- ✅ Beautiful markdown-formatted responses
- ✅ Click-to-copy code blocks
- ✅ Educational hints without giving away solutions


## 🙏 Acknowledgments

- Powered by [Google Gemini AI](https://ai.google.dev/)
- Built with ❤️ for programming students

---

**Enjoy learning C/C++ with Tell-me!** 🎉

---
Made by:
<a href="https://github.com/Googoochadwick" target="_blank">Arush Anand Singh</a>,
<a href="https://github.com/shresalix2006" target="_blank">Shrestha Chatterjee</a>,
<a href="https://github.com/PerseusKyogre09" target="_blank">Pradeepto Pal</a>,
<a href="https://github.com/ARTLEST" target="_blank">Atharva Kumar</a>
