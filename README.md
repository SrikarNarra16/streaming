# AI-Powered Interactive Learning Platform

A Next.js application that provides an interactive learning experience through AI-generated content with real-time streaming, fill-in-the-blank exercises, and contextual Q&A support.

## 🎯 Overview

This project creates an interactive learning experience where AI explanations are streamed character-by-character, with periodic fill-in-the-blank questions and contextual chat support. Students can ask questions about any part of the explanation through expandable accordions.

The current implementation focuses on coding explanations (specifically a Python function example), but the system is designed to be flexible for various educational content.

## ✨ Features

- **Real-time Text Streaming**: AI explanations appear with typewriter effect
- **Interactive Blanks**: Students fill in missing information during explanations
- **Contextual Q&A**: Chat system that understands the current explanation context
- **Performance Tracking**: Monitors student responses and provides feedback
- **Responsive Design**: Clean, dark-themed interface optimized for learning

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- DeepSeek API key

### Setup Instructions

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   Create `.env.local` in the root directory:

   ```
   DEEPSEEK_API_KEY=your_deepseek_api_key_here
   ```

3. **Start development server:**

   ```bash
   pnpm dev
   ```

4. **Access the application:**
   - Main app: [http://localhost:3000/streaming](http://localhost:3000/streaming)
   - Root redirects automatically to `/streaming`

## 📁 Key File Locations

### Core Application Files

- **Main streaming interface**: [`app/streaming/page.tsx`](app/streaming/page.tsx) - Contains all main logic
- **AI API endpoint**: [`app/api/generate/route.ts`](app/api/generate/route.ts) - Handles DeepSeek integration
- **Root redirect**: [`app/page.tsx`](app/page.tsx) - Auto-redirects to streaming page
- **Layout & fonts**: [`app/layout.tsx`](app/layout.tsx)
- **Global styles**: [`app/globals.css`](app/globals.css)

### Component Structure

```
components/
├── streaming/          # Streaming-specific components
│   ├── BlankInput      # Fill-in-the-blank interactions
│   ├── ParagraphFeedback # Q&A accordion system
│   ├── PerformanceSummary # Student progress tracking
│   └── TextRenderer   # Markdown text display
└── ui/                # Reusable UI components (shadcn/ui)
    └── accordion.tsx  # Base accordion component
```

### Configuration Files

- **Package management**: [`package.json`](package.json), [`pnpm-lock.yaml`](pnpm-lock.yaml)
- **TypeScript**: [`tsconfig.json`](tsconfig.json)
- **Next.js**: [`next.config.ts`](next.config.ts)
- **Styling**: [`postcss.config.mjs`](postcss.config.mjs), [`components.json`](components.json)
- **Linting**: [`eslint.config.mjs`](eslint.config.mjs)

## 🔧 Key Implementation Details

### Main Logic Location

All core functionality is in [`app/streaming/page.tsx`](app/streaming/page.tsx):

- Text streaming with typewriter effect
- Blank detection and handling (`BLANK(answer)` format)
- Chat accordion management
- Performance tracking
- Animation system using Framer Motion

### API Integration

The [`app/api/generate/route.ts`](app/api/generate/route.ts) file handles:

- DeepSeek API integration
- Context-aware chat responses
- Error handling and fallbacks

### Content Format

AI explanations use `BLANK(answer)` placeholders for interactive elements:

```
The function should return BLANK(-1) if val is not found...
The difference between max and min keys is BLANK(6)...
```

### Animation Configuration

Key timing constants in [`app/streaming/page.tsx`](app/streaming/page.tsx):

```typescript
const TYPING_INTERVAL_MS = 100; // Speed between typing intervals
const CHARS_PER_TYPE_INTERVAL = 30; // Characters per interval
const ANIMATION_CHARS_PER_SECOND = 30; // Animation speed
const FEEDBACK_DURATION_MS = 1500; // Feedback display time
```

## 🔍 Development Notes

### State Management

The application uses React's built-in state with coordination between:

- Text streaming state
- Blank interaction state
- Chat/accordion state
- Performance tracking state

### Current Limitations

- No user authentication or persistent storage
- Chat accordions don't maintain conversation history
- Content is hardcoded in the component (no CMS)

## 🐛 Troubleshooting

**API not working**: Check `DEEPSEEK_API_KEY` in `.env.local`

**Streaming stops unexpectedly**: Look for malformed `BLANK()` placeholders in console

**Animation issues**: Clear browser cache and restart dev server

**Console errors**: Check browser dev tools - the app logs context and debugging info

## 📋 Future Improvements

### High Priority

- [ ] User authentication & progress persistence
- [ ] Database integration for content and user data
- [ ] Content management system

### Medium Priority

- [ ] Mobile responsiveness improvements
- [ ] Analytics dashboard for educators
- [ ] Accessibility enhancements

### Low Priority

- [ ] Multi-language support
- [ ] Theme customization
- [ ] Export/print functionality

---

**Note**: This is an internal FLAME internship project. The core streaming and interaction system is functional and ready for production use with the improvements listed above.
