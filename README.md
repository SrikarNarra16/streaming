# AI-Thinking Simulator

A Next.js application that provides an interactive learning experience through AI-generated content with real-time streaming, fill-in-the-blank exercises, and contextual Q&A support.

## 🎯 Overview

This project creates an interactive learning experience where AI explanations are streamed character-by-character, with periodic fill-in-the-blank questions and contextual chat support. Students can ask questions about any part of the explanation through expandable accordions.

The current implementation focuses on coding explanations (specifically a Python function example), but the system is designed to be flexible for various educational content.

## ✨ Features

- **Real-time Text Streaming**: AI explanations appear with typewriter effect
- **Interactive Blanks**: Students fill in missing information during explanations
- **Contextual Q&A**: Chat system that understands the current explanation context
- **Performance Tracking**: Monitors student responses and provides feedback
- **User Authentication**: Secure login system with session management
- **Activity Logging**: Comprehensive logging of user interactions and AI responses
- **Responsive Design**: Clean, dark-themed interface optimized for learning

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- PostgreSQL database
- DeepSeek API key

### Setup Instructions

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   Create `.env.local` in the root directory:

   ```env
   DEEPSEEK_API_KEY=your_deepseek_api_key_here
   DATABASE_URL=postgresql://username:password@localhost:5432/database_name
   ```

3. **Database Setup:**

   #### Option A: Local PostgreSQL Setup

   Install PostgreSQL locally and create a database:

   ```bash

   # Update DATABASE_URL in .env.local
   DATABASE_URL=postgresql://username:password@localhost:5432/streaming_app
   ```

   #### Option B: Cloud Database (Recommended)

   Use a cloud provider like:

   - **Supabase** (free tier available)
   - **Neon** (serverless postgres)

   Example with Supabase:

   1. Create account at [supabase.com](https://supabase.com)
   2. Create new project
   3. Copy connection string from Settings > Database
   4. Update `.env.local`:

   ```env
   DATABASE_URL=postgresql://postgres:[password]@[host].supabase.co:5432/postgres
   ```

4. **Initialize Database:**

   ```bash
   # Generate and run migrations
   npx drizzle-kit generate
   npx drizzle-kit push

   # Or use the migration command
   pnpm db:migrate
   ```

5. **Seed Database (Optional):**

   Add sample questions to your database:

   ```bash
   # You can manually insert data or create a seed script
   # Example questions are provided in the schema comments
   ```

6. **Start development server:**

   ```bash
   pnpm dev
   ```

7. **Access the application:**
   - Main app: [http://localhost:3000/streaming](http://localhost:3000/streaming)
   - Authentication: [http://localhost:3000/auth/login](http://localhost:3000/auth/login)

## 🗄️ Database Schema

The application uses the following database tables:

### Users Table

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
```

### Questions Table

```sql
CREATE TABLE questions (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
```

### Logs Table

```sql
CREATE TABLE logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  level TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

### Sample Data

Example question entry:

```sql
INSERT INTO questions (question, content) VALUES (
  'Explain the identical function',
  'Let me walk you through this step by step...\n\nThe `identical` function takes two parameters: a dictionary `d` and a value `val`...'
);
```

## 🔧 Database Management

### Drizzle ORM Configuration

The project uses Drizzle ORM with the following configuration:

- **Schema**: [`schema.ts`](schema.ts) - Database schema definitions
- **Database client**: [`lib/db.ts`](lib/db.ts) - Database connection
- **Migrations**: [`drizzle/`](drizzle/) - Auto-generated migration files

### Available Commands

```bash
# Generate new migration
pnpm db:generate

# Push schema changes to database
pnpm db:push

# Run migrations
pnpm db:migrate

# View database in Drizzle Studio
pnpm db:studio
```

### Switching Databases

To use a different database:

1. **Update environment variables:**

   ```env
   DATABASE_URL=postgresql://new_username:new_password@new_host:5432/new_database
   ```

2. **Run migrations:**

   ```bash
   npx drizzle-kit push
   ```

3. **Seed with sample data** (if needed)

## 📁 Key File Locations

### Core Application Files

- **Main streaming interface**: [`app/streaming/page.tsx`](app/streaming/page.tsx) - Contains all main logic
- **AI API endpoint**: [`app/api/generate/route.ts`](app/api/generate/route.ts) - Handles DeepSeek integration
- **Authentication routes**: [`app/api/auth/`](app/api/auth/) - Login/logout endpoints
- **Questions API**: [`app/api/questions/`](app/api/questions/) - Database queries
- **Logging API**: [`app/api/logs/`](app/api/logs/) - Activity logging
- **Database schema**: [`schema.ts`](schema.ts) - Drizzle ORM schema
- **Database connection**: [`lib/db.ts`](lib/db.ts) - PostgreSQL connection
- **Logger utility**: [`lib/logger.ts`](lib/logger.ts) - Logging functions

### Component Structure

```
components/
├── streaming/          # Streaming-specific components
│   ├── BlankInput      # Fill-in-the-blank interactions
│   ├── ChatAccordion   # Q&A chat interface
│   ├── ParagraphFeedback # Feedback collection
│   ├── PerformanceSummary # Student progress tracking
│   └── TextRenderer   # Markdown text display
└── ui/                # Reusable UI components (shadcn/ui)
    └── accordion.tsx  # Base accordion component
```

## 🔧 Key Implementation Details

### Main Logic Location

All core functionality is in [`app/streaming/page.tsx`](app/streaming/page.tsx):

- Text streaming with typewriter effect
- Blank detection and handling (`BLANK(answer)` format)
- Chat accordion management
- Performance tracking
- User authentication checks
- Activity logging

### API Integration

The [`app/api/generate/route.ts`](app/api/generate/route.ts) file handles:

- DeepSeek API integration
- Context-aware chat responses
- User authentication verification
- Request/response logging
- Error handling and fallbacks

### Authentication System

- **Login**: [`app/api/auth/login/route.ts`](app/api/auth/login/route.ts)
- **Logout**: [`app/api/auth/logout/route.ts`](app/api/auth/logout/route.ts)
- **Session management**: HTTP-only cookies
- **Password hashing**: bcryptjs

### Logging System

The application logs all user interactions:

- **User actions**: Question navigation, feedback, responses
- **AI interactions**: Requests, responses, errors
- **Authentication**: Login attempts, successes, failures
- **Performance**: Response times, error rates

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

## 🚀 Deployment

### Environment Variables for Production

```env
DEEPSEEK_API_KEY=your_production_api_key
DATABASE_URL=your_production_database_url
NEXTAUTH_SECRET=your_secure_random_string
NODE_ENV=production
```

## 🔍 Development Notes

### Adding New Questions

1. Insert into database:

   ```sql
   INSERT INTO questions (question, content) VALUES (
     'Your question title',
     'Your explanation content with BLANK(answer) placeholders...'
   );
   ```

2. Questions automatically appear in the application

### Customizing Logging

Modify [`lib/logger.ts`](lib/logger.ts) to:

- Add new log levels
- Change log format
- Add custom fields
- Integrate with external services

### Performance Monitoring

Check the logs table for:

- User engagement metrics
- AI response performance
- Error patterns
- Feature usage statistics

---

**Note**: This project was developed by [Avval Halani](https://github.com/aahalani). Please feel free to contact me for any questions.
