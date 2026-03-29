# Zupiq Backend

## Tech Stack
- **Framework**: Express.js (TypeScript)
- **Runtime**: Node.js
- **Development Tool**: `tsx` (for running TypeScript directly)
- **AI Engine**: Google Gemini (`@google/genai`)
- **Database**: Supabase (Postgres)
- **Authentication**: JWT (JSON Web Tokens) with Refresh Tokens
- **Payments**: Stripe
- **Push Notifications**: Firebase Admin SDK

## Development Workflow
- **Start Dev Server**: `npm run dev` (runs `tsx server.ts`)
- **Type Check**: `npm run lint` (runs `tsc --noEmit`)
- **Build**: `npm run build`
- **Start Production**: `npm run start`

## Architectural Mandates

### 1. Entitlement-Driven Access
- **Logic**: Use the helpers in `billing/entitlements.ts` to check if a user can access a feature.
- **Source of Truth**: The `PLAN_CATALOG` in `billing/catalog.ts` defines what each plan tier can do.
- **Normalization**: Always normalize subscription data from Stripe into the internal `NormalizedSubscription` format.

### 2. AI Integration
- **Model**: Prefer Gemini Flash for speed and Pro for complex reasoning.
- **Validation**: Rigorously validate AI-generated JSON before persisting it to the database.
- **Logging**: Keep track of AI usage (tokens) for quota enforcement.

### 3. Authentication & Security
- **JWT**: Access tokens should be short-lived; use Refresh Tokens for persistent sessions.
- **Passwords**: Use `bcryptjs` with 12 rounds for hashing.
- **Middleware**: Use `auth.middleware.ts` for protected routes.

### 4. Data Modeling
- **Relational Integrity**: Use `subject_id` and `topic_id` in new tables (like Quizzes) rather than just free-text names.
- **JSONB**: Use `JSONB` for flexible data like AI prompts, grading rubrics, and metadata.

## Coding Standards
- **Modules**: Use ESM (`import/export`).
- **Typing**: Define core models in `models/` and shared types in `types.ts`.
- **Services**: Encapsulate business logic in `services/` (e.g., `auth.service.ts`, `quiz.service.ts`).
- **Middlewares**: Centralize cross-cutting concerns (Auth, Errors, Rate Limiting) in `api/middlewares/`.

## Key Directories
- `api/`: Routes and middlewares.
- `billing/`: Plan definitions, entitlement logic, and payment provider integrations.
- `config/`: Environment variables and service initializations (Supabase, Firebase, Gemini).
- `models/`: Database record definitions and types.
- `services/`: Core business logic and external API wrappers.
- `utils/`: Reusable helper functions and loggers.
