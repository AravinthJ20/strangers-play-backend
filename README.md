# Green Lynk Backend

## Setup

1. Copy `.env` to `.env` and update values.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start backend:
   ```bash
   npm run dev
   ```

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users`
- `GET /api/chat/chats`
- `GET /api/chat/messages/:userId`
- `GET /api/groups`
- `GET /api/groups/:groupId/messages`

Socket.IO uses the backend server URL and respects `FRONTEND_URL` / `CORS_ORIGIN` from `.env`.
